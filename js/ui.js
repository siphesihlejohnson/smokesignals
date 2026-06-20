'use strict';

const App = {
  syncStatus: 'OFFLINE',
  lastSyncTime: null,
  currentTab: null,
};

const UI = (() => {
  let _clockInterval = null;

  const TABS_ADMIN = [
    { id: 'dashboard', label: 'DASHBOARD',    fn: 1 },
    { id: 'sale',      label: 'CAPTURE SALE', fn: 2 },
    { id: 'log',       label: 'SALES LOG',    fn: 3 },
    { id: 'inventory', label: 'INVENTORY',    fn: 4 },
    { id: 'customers', label: 'CUSTOMERS',    fn: 5 },
    { id: 'reports',   label: 'REPORTS',      fn: 6 },
    { id: 'cashup',    label: 'CASH-UP',      fn: 7 },
    { id: 'credit',    label: 'CREDIT',       fn: 8 },
    { id: 'admin',     label: 'ADMIN'              },
    { id: 'setup',     label: 'SETUP'              },
  ];
  const TABS_STAFF = [
    { id: 'sale',   label: 'CAPTURE SALE', fn: 2 },
    { id: 'log',    label: 'SALES LOG',    fn: 3 },
    { id: 'cashup', label: 'CASH-UP',      fn: 4 },
    { id: 'credit', label: 'CREDIT',       fn: 5 },
    { id: 'setup',  label: 'SETUP'              },
  ];

  function init() {
    document.addEventListener('keydown', (e) => {
      if (!Auth.isLoggedIn()) return;
      const n = parseInt(e.key.replace('F', ''), 10);
      if (e.key.startsWith('F') && n >= 1 && n <= 8) {
        e.preventDefault();
        handleFnKey(n);
      }
    });
    startClock();
  }

  function showApp() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    renderTopBar();
    renderTabNav();
    renderFnBar();
    updateBottomBar();

    const saved = Data.lsGet(CONFIG.KEYS.ACTIVE_TAB);
    const s = Auth.getSession();
    const tabs = s?.role === 'admin' ? TABS_ADMIN : TABS_STAFF;
    const startTab = (saved && tabs.find(t => t.id === saved)) ? saved
      : (s?.role === 'admin' ? 'dashboard' : 'sale');
    navigate(startTab);

    Data.fetchFromSheets().then(() => {
      Data.processQueue();
      // Re-render the current tab with fresh Sheets data so staff see all synced sales
      if (App.currentTab === 'sale') {
        Sales.renderOwnSales();
      } else {
        navigate(App.currentTab);
      }
    });
  }

  function showLogin() {
    document.getElementById('app-screen').classList.add('hidden');
    Auth.showLoginScreen();
  }

  // ─── Navigation ───────────────────────────────────────────────────────────────
  function navigate(tabId) {
    const s = Auth.getSession();
    const tabs = s?.role === 'admin' ? TABS_ADMIN : TABS_STAFF;
    if (!tabs.find(t => t.id === tabId)) return;

    App.currentTab = tabId;
    Data.lsSet(CONFIG.KEYS.ACTIVE_TAB, tabId);

    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));

    const content = document.getElementById('content');
    content.innerHTML = '';

    Auth.extendSession();

    switch (tabId) {
      case 'dashboard': Dashboard.render(content); break;
      case 'sale':      Sales.render(content); break;
      case 'log':       SalesLog.render(content); break;
      case 'inventory': Inventory.render(content); break;
      case 'customers': Customers.render(content); break;
      case 'reports':   Reports.render(content); break;
      case 'cashup':    CashUp.render(content); break;
      case 'credit':    Credit.render(content); break;
      case 'admin':     Admin.render(content); break;
      case 'setup':     Setup.render(content); break;
    }
  }

  function handleFnKey(n) {
    const s = Auth.getSession();
    const tabs = s?.role === 'admin' ? TABS_ADMIN : TABS_STAFF;
    const tab = tabs.find(t => t.fn === n);
    if (tab) navigate(tab.id);
  }

  // ─── Top Bar ──────────────────────────────────────────────────────────────────
  function renderTopBar() {
    const s = Auth.getSession();
    const settings = Data.getSettings();
    document.getElementById('top-bar').innerHTML = `
      <span class="top-brand">${settings.appName || 'SMOKE SIGNALS'}</span>
      <span class="top-sep">|</span>
      <span class="top-branch">${settings.branch || 'CAPE TOWN'}</span>
      <span class="top-sep">|</span>
      <span class="top-staff">${s ? s.staffName : '---'}</span>
      <span class="top-sep">|</span>
      <span id="top-date" class="top-date"></span>
      <span class="top-sep">|</span>
      <span id="top-time" class="top-time"></span>
      <button class="btn btn-sm btn-logout" onclick="Auth.logout()">LOGOUT</button>
    `;
    updateClock();
  }

  // ─── Tab Nav ──────────────────────────────────────────────────────────────────
  function renderTabNav() {
    const s = Auth.getSession();
    const tabs = s?.role === 'admin' ? TABS_ADMIN : TABS_STAFF;
    document.getElementById('tab-nav').innerHTML = tabs.map(t => `
      <button class="tab-btn" data-tab="${t.id}" onclick="UI.navigate('${t.id}')">${t.label}</button>
    `).join('');
  }

  // ─── Fn Bar ───────────────────────────────────────────────────────────────────
  function renderFnBar() {
    const s = Auth.getSession();
    const tabs = s?.role === 'admin' ? TABS_ADMIN : TABS_STAFF;
    document.getElementById('fn-bar').innerHTML = tabs.filter(t => t.fn).map(t => `
      <button class="fn-btn" onclick="UI.navigate('${t.id}')">
        <span class="fn-key">F${t.fn}</span>
        <span class="fn-label">${t.label.length > 8 ? t.label.substr(0,8) : t.label}</span>
      </button>
    `).join('');
  }

  // ─── Bottom Bar ───────────────────────────────────────────────────────────────
  function updateBottomBar() {
    const syncEl = document.getElementById('sync-status');
    const sessionEl = document.getElementById('session-info');
    const lastEl = document.getElementById('last-sync-time');
    if (!syncEl) return;

    const statusClass = App.syncStatus === 'SYNCED' ? 'ok' : App.syncStatus === 'SYNCING' ? 'amber' : 'dim';
    syncEl.innerHTML = `<span class="status-dot ${statusClass}">●</span> ${App.syncStatus}`;

    const s = Auth.getSession();
    if (s && sessionEl) {
      const minsLeft = Math.max(0, Math.round((s.expiresAt - Date.now()) / 60000));
      sessionEl.textContent = `${s.staffName} | ${minsLeft}m`;
    }

    if (lastEl) {
      lastEl.textContent = App.lastSyncTime
        ? `SYNC: ${Data.fmtTime(App.lastSyncTime)}`
        : 'NOT SYNCED';
    }
  }

  // ─── Clock ────────────────────────────────────────────────────────────────────
  function startClock() {
    if (_clockInterval) clearInterval(_clockInterval);
    _clockInterval = setInterval(() => { updateClock(); updateBottomBar(); }, 1000);
    updateClock();
  }

  function updateClock() {
    const now = new Date();
    const dateEl = document.getElementById('top-date');
    const timeEl = document.getElementById('top-time');
    if (dateEl) dateEl.textContent = Data.fmtDate(now);
    if (timeEl) timeEl.textContent = Data.fmtTime(now);
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────
  function toast(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  // ─── Modal ────────────────────────────────────────────────────────────────────
  function modal(html, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box">${html}</div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); }
    });
    return overlay;
  }

  function confirm(msg) {
    return new Promise((resolve) => {
      const overlay = modal(`
        <div class="modal-title">[ CONFIRM ]</div>
        <div class="modal-body">${msg}</div>
        <div class="modal-actions">
          <button class="btn btn-danger" id="conf-yes">YES, CONFIRM</button>
          <button class="btn btn-secondary" id="conf-no">CANCEL</button>
        </div>
      `);
      overlay.querySelector('#conf-yes').addEventListener('click', () => { overlay.remove(); resolve(true); });
      overlay.querySelector('#conf-no').addEventListener('click', () => { overlay.remove(); resolve(false); });
    });
  }

  function prompt(msg, placeholder = '') {
    return new Promise((resolve) => {
      const overlay = modal(`
        <div class="modal-title">[ INPUT ]</div>
        <div class="modal-body">${msg}</div>
        <input type="text" id="prompt-input" placeholder="${placeholder}" class="w-full" />
        <div class="modal-actions">
          <button class="btn btn-primary" id="prompt-ok">OK</button>
          <button class="btn btn-secondary" id="prompt-cancel">CANCEL</button>
        </div>
      `);
      const inp = overlay.querySelector('#prompt-input');
      inp.focus();
      overlay.querySelector('#prompt-ok').addEventListener('click', () => { overlay.remove(); resolve(inp.value); });
      overlay.querySelector('#prompt-cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { overlay.remove(); resolve(inp.value); } });
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function fmtCurrency(n) {
    const s = Auth.getSession();
    const settings = Data.getSettings();
    const c = settings.currency || 'R';
    return `${c}${Number(n).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  function statusBadge(stock, threshold) {
    if (stock <= 0) return '<span class="badge badge-out">OUT</span>';
    if (stock <= threshold) return '<span class="badge badge-low">LOW</span>';
    return '<span class="badge badge-ok">OK</span>';
  }

  function panel(title, body) {
    return `<div class="panel"><div class="panel-title">[ ${title} ]</div>${body}</div>`;
  }

  function table(cols, rows, noData = 'No data.') {
    if (!rows.length) return `<div class="no-data">${noData}</div>`;
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
  }

  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return {
    init, showApp, showLogin, navigate, handleFnKey,
    renderTopBar, renderTabNav, renderFnBar, updateBottomBar,
    startClock, toast, modal, confirm, prompt,
    fmtCurrency, statusBadge, panel, table, esc,
  };
})();

// ─── Dashboard Module ─────────────────────────────────────────────────────────
const Dashboard = (() => {
  function render(container) {
    const sales = Data.getSales();
    const settings = Data.getSettings();
    const threshold = settings.lowStockThreshold || CONFIG.LOW_STOCK_THRESHOLD;
    const today = Data.fmtDate(new Date());

    const todaySales = sales.filter(s => s.date === today);
    const todayRev = todaySales.reduce((a, s) => a + (s.amount || 0), 0);
    const totalRev = sales.reduce((a, s) => a + (s.amount || 0), 0);
    const todayCash = todaySales.filter(s => s.payment === 'CASH').reduce((a, s) => a + s.amount, 0);
    const todayEFT  = todaySales.filter(s => s.payment === 'EFT').reduce((a, s) => a + s.amount, 0);
    const customers = Data.getCustomers();
    const products = Data.getProducts();
    const alerts = products.filter(p => p.active && p.stock <= threshold);

    // Per-staff today
    const staffToday = {};
    todaySales.forEach(s => {
      if (!staffToday[s.staff]) staffToday[s.staff] = { name: s.staff, count: 0, rev: 0 };
      staffToday[s.staff].count++;
      staffToday[s.staff].rev += s.amount;
    });

    // Top customers
    const topCust = [...customers].sort((a,b) => (b.totalSpent||0) - (a.totalSpent||0)).slice(0,5);

    container.innerHTML = `
      <div class="content-inner">
        <div class="stats-row">
          ${stat("TODAY'S REVENUE", UI.fmtCurrency(todayRev))}
          ${stat('TOTAL REVENUE', UI.fmtCurrency(totalRev))}
          ${stat('UNITS TODAY', todaySales.reduce((a,s)=>a+(s.qty||0),0))}
          ${stat('CUSTOMERS', customers.length)}
          ${stat('CASH TODAY', UI.fmtCurrency(todayCash))}
          ${stat('EFT TODAY', UI.fmtCurrency(todayEFT))}
        </div>
        <div class="dash-grid">
          ${UI.panel('RECENT SALES', UI.table(
            ['DATE','TIME','PRODUCT','QTY','CUSTOMER','PAY','AMOUNT','STAFF'],
            [...sales].reverse().slice(0,10).map(s => [
              s.date, s.time, UI.esc(s.product), s.qty,
              UI.esc(s.customer), s.payment, UI.fmtCurrency(s.amount), s.staff
            ])
          ))}
          ${UI.panel('STOCK ALERTS', alerts.length === 0
            ? '<div class="no-data">All stock levels OK</div>'
            : UI.table(
              ['PRODUCT','CATEGORY','STOCK','STATUS'],
              alerts.map(p => [UI.esc(p.name), p.category, p.stock, UI.statusBadge(p.stock, threshold)])
            )
          )}
          ${UI.panel('TOP CUSTOMERS', UI.table(
            ['NAME','PHONE','SPENT','VISITS'],
            topCust.map(c => [UI.esc(c.name), c.phone, UI.fmtCurrency(c.totalSpent||0), c.visits||0])
          ))}
          ${UI.panel('STAFF TODAY', Object.values(staffToday).length === 0
            ? '<div class="no-data">No sales today</div>'
            : UI.table(
              ['STAFF','SALES','REVENUE'],
              Object.values(staffToday).sort((a,b)=>b.rev-a.rev).map(s => [s.name, s.count, UI.fmtCurrency(s.rev)])
            )
          )}
        </div>
      </div>
    `;
  }

  function stat(label, value) {
    return `<div class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
  }

  return { render };
})();
