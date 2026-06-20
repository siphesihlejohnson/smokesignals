'use strict';

const Admin = (() => {
  const SUB_TABS = [
    { id: 'staff',    label: 'STAFF MANAGEMENT' },
    { id: 'audit',    label: 'AUDIT LOG' },
    { id: 'stock',    label: 'STOCK MANAGEMENT' },
    { id: 'data',     label: 'DATA MANAGEMENT' },
    { id: 'settings', label: 'SETTINGS' },
  ];
  let _subTab = 'staff';

  function render(container) {
    container.innerHTML = `
      <div class="content-inner">
        <div class="sub-tab-nav" id="admin-sub-nav">
          ${SUB_TABS.map(t => `
            <button class="sub-tab-btn${t.id===_subTab?' active':''}" onclick="Admin.subNavigate('${t.id}')">${t.label}</button>
          `).join('')}
        </div>
        <div id="admin-sub-content"></div>
      </div>
    `;
    renderSubTab(_subTab);
  }

  function subNavigate(id) {
    _subTab = id;
    document.querySelectorAll('.sub-tab-btn').forEach(b =>
      b.classList.toggle('active', b.textContent === SUB_TABS.find(t=>t.id===id)?.label)
    );
    renderSubTab(id);
  }

  function renderSubTab(id) {
    const area = document.getElementById('admin-sub-content');
    if (!area) return;
    switch (id) {
      case 'staff':    renderStaff(area); break;
      case 'audit':    renderAudit(area); break;
      case 'stock':    renderStock(area); break;
      case 'data':     renderData(area); break;
      case 'settings': renderSettings(area); break;
    }
  }

  // ─── Staff Management ────────────────────────────────────────────────────────
  function renderStaff(area) {
    const staff = Data.getStaff();
    area.innerHTML = `
      ${UI.panel('STAFF MANAGEMENT', `
        <div class="inv-actions">
          <button class="btn btn-primary btn-sm" onclick="Admin.showAddStaffForm()">+ ADD STAFF</button>
        </div>
        ${UI.table(
          ['ID','NAME','ROLE','STATUS','LAST LOGIN','ACTIONS'],
          staff.map(s => [
            s.id,
            UI.esc(s.name),
            `<span class="badge ${s.role==='admin'?'badge-ok':'badge-dim'}">${s.role.toUpperCase()}</span>`,
            s.active
              ? `<span class="badge badge-ok">ACTIVE</span>`
              : `<span class="badge badge-out">INACTIVE</span>`,
            s.lastLogin ? Data.fmtDate(s.lastLogin) : 'Never',
            `<button class="btn btn-xs" onclick="Admin.editStaff('${s.id}')">EDIT</button>
             <button class="btn btn-xs" onclick="Admin.doResetPIN('${s.id}')">RESET PIN</button>
             <button class="btn btn-xs ${s.active?'btn-warn':'btn-ok'}" onclick="Admin.toggleStaff('${s.id}')">
               ${s.active ? 'DEACTIVATE' : 'ACTIVATE'}
             </button>`,
          ])
        )}
      `)}
      <div id="staff-form-area"></div>
    `;
  }

  function showAddStaffForm(existing) {
    const area = document.getElementById('staff-form-area');
    const isEdit = !!existing;
    const m = existing || {};
    area.innerHTML = UI.panel(isEdit ? `EDIT: ${UI.esc(m.name)}` : 'ADD STAFF MEMBER', `
      <form id="staff-form" class="form-grid">
        <div class="form-group">
          <label>STAFF ID (no spaces) *</label>
          <input type="text" id="sf-id" value="${UI.esc(m.id||'')}" ${isEdit?'readonly':''} placeholder="e.g. STAFF4" style="text-transform:uppercase">
        </div>
        <div class="form-group">
          <label>DISPLAY NAME *</label>
          <input type="text" id="sf-name" value="${UI.esc(m.name||'')}" required>
        </div>
        <div class="form-group">
          <label>ROLE</label>
          <select id="sf-role">
            <option value="staff" ${(m.role||'staff')==='staff'?'selected':''}>Staff</option>
            <option value="admin" ${m.role==='admin'?'selected':''}>Admin</option>
          </select>
        </div>
        ${!isEdit ? `
        <div class="form-group">
          <label>PIN will be set by the staff member on first login</label>
          <div class="form-note">Leave PIN as "not set". The staff member will be prompted to set their own PIN on first login.</div>
        </div>` : ''}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${isEdit ? 'SAVE' : 'ADD STAFF'}</button>
          <button type="button" class="btn btn-secondary" onclick="Admin.cancelStaffForm()">CANCEL</button>
        </div>
      </form>
    `);

    document.getElementById('staff-form').addEventListener('submit', e => {
      e.preventDefault();
      saveStaff(existing);
    });
  }

  function saveStaff(existing) {
    const id   = document.getElementById('sf-id').value.trim().toUpperCase().replace(/\s+/g,'');
    const name = document.getElementById('sf-name').value.trim();
    const role = document.getElementById('sf-role').value;

    if (!id)   { UI.toast('ID required', 'error'); return; }
    if (!name) { UI.toast('Name required', 'error'); return; }
    if (!existing && Data.getStaffById(id)) { UI.toast('ID already exists', 'error'); return; }

    const s = Auth.getSession();
    if (existing) {
      Data.updateStaffMember({ ...existing, name, role });
      Data.addAudit('STAFF_EDITED', `${existing.name} → ${name} (${role})`, s?.staffId);
    } else {
      Data.addStaffMember({ id, name, role, pinHash: null, active: true, failedAttempts: 0, lockedUntil: null, lastLogin: null });
      Data.addAudit('STAFF_ADDED', `${name} (${id}) as ${role}`, s?.staffId);
    }
    UI.toast(existing ? 'Staff updated' : 'Staff added', 'success');
    cancelStaffForm();
    render(document.getElementById('content'));
  }

  function editStaff(id) {
    const member = Data.getStaffById(id);
    if (member) showAddStaffForm(member);
  }

  async function doResetPIN(staffId) {
    const ok = await Auth.resetStaffPIN(staffId);
    if (ok) { UI.toast('PIN reset successfully', 'success'); }
  }

  async function toggleStaff(id) {
    const m = Data.getStaffById(id);
    if (!m) return;
    const ok = await UI.confirm(`${m.active ? 'Deactivate' : 'Activate'} ${m.name}?`);
    if (!ok) return;
    const s = Auth.getSession();
    Data.updateStaffMember({ ...m, active: !m.active });
    Data.addAudit('STAFF_TOGGLED', `${m.name} set to ${!m.active?'ACTIVE':'INACTIVE'}`, s?.staffId);
    UI.toast(`${m.name} ${!m.active?'activated':'deactivated'}`, 'info');
    render(document.getElementById('content'));
  }

  function cancelStaffForm() {
    const area = document.getElementById('staff-form-area');
    if (area) area.innerHTML = '';
  }

  // ─── Audit Log ───────────────────────────────────────────────────────────────
  function renderAudit(area) {
    const log   = Data.getAuditLog();
    const staff = Data.getStaff();

    area.innerHTML = UI.panel('AUDIT LOG (READ ONLY)', `
      <div class="filter-row">
        <div class="form-group">
          <label>STAFF</label>
          <select id="audit-staff">
            <option value="">ALL</option>
            ${staff.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>FROM</label>
          <input type="date" id="audit-from">
        </div>
        <div class="form-group">
          <label>TO</label>
          <input type="date" id="audit-to">
        </div>
        <div class="form-group">
          <label>ACTION</label>
          <input type="text" id="audit-action" placeholder="e.g. SALE">
        </div>
      </div>
      <div id="audit-table"></div>
    `);

    function applyAuditFilters() {
      const sf  = document.getElementById('audit-staff').value;
      const from = document.getElementById('audit-from').value;
      const to   = document.getElementById('audit-to').value;
      const act  = document.getElementById('audit-action').value.toLowerCase();

      let filtered = log;
      if (sf)  filtered = filtered.filter(e => e.staff === sf);
      if (from) filtered = filtered.filter(e => e.timestamp >= new Date(from).toISOString());
      if (to)   filtered = filtered.filter(e => e.timestamp <= new Date(to + 'T23:59:59').toISOString());
      if (act)  filtered = filtered.filter(e => (e.action||'').toLowerCase().includes(act));

      document.getElementById('audit-table').innerHTML = UI.table(
        ['TIMESTAMP','STAFF','ACTION','DETAILS'],
        filtered.slice(0, 200).map(e => [
          Data.fmtDate(e.timestamp) + ' ' + Data.fmtTime(e.timestamp),
          e.staff,
          `<span class="badge badge-dim">${e.action}</span>`,
          UI.esc(e.details),
        ]),
        'No audit entries match filter'
      );
    }

    ['audit-staff','audit-from','audit-to','audit-action'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', applyAuditFilters);
    });
    applyAuditFilters();
  }

  // ─── Stock Management ────────────────────────────────────────────────────────
  function renderStock(area) {
    const products = Data.getProducts();
    const settings = Data.getSettings();
    const threshold = settings.lowStockThreshold || CONFIG.LOW_STOCK_THRESHOLD;

    area.innerHTML = `
      ${UI.panel('BULK RESTOCK', `
        <form id="bulk-restock-form">
          <div class="table-wrap">
            <table>
              <thead><tr><th>PRODUCT</th><th>IN STOCK</th><th>STATUS</th><th>ADD QTY</th></tr></thead>
              <tbody>
                ${products.filter(p=>p.active).map(p => `
                  <tr>
                    <td>${UI.esc(p.name)}</td>
                    <td>${p.stock}</td>
                    <td>${UI.statusBadge(p.stock, threshold)}</td>
                    <td><input type="number" class="restock-qty" data-id="${p.id}" data-name="${UI.esc(p.name)}"
                               min="0" step="1" value="0" style="width:80px"></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="form-group" style="margin-top:12px">
            <label>SUPPLIER</label>
            <input type="text" id="bulk-supplier" placeholder="Supplier name">
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary">APPLY RESTOCKS</button>
          </div>
        </form>
      `)}
      ${UI.panel('RESTOCK HISTORY', UI.table(
        ['DATE','PRODUCT','QTY','SUPPLIER','STAFF'],
        Data.getRestocks().slice(0,30).map(r => [
          Data.fmtDate(r.createdAt), UI.esc(r.productName), r.qty,
          UI.esc(r.supplier), r.staff
        ]),
        'No restocks recorded'
      ))}
    `;

    document.getElementById('bulk-restock-form').addEventListener('submit', async e => {
      e.preventDefault();
      const supplier = document.getElementById('bulk-supplier').value.trim() || 'Unknown';
      const inputs = document.querySelectorAll('.restock-qty');
      const s = Auth.getSession();
      let count = 0;
      inputs.forEach(inp => {
        const qty = parseFloat(inp.value) || 0;
        if (qty > 0) {
          Data.addRestock({ productId: inp.dataset.id, productName: inp.dataset.name, qty, supplier, date: Data.fmtDate(new Date()), staff: s?.staffName });
          Data.addAudit('RESTOCK', `${inp.dataset.name} +${qty}`, s?.staffId);
          count++;
        }
      });
      if (count === 0) { UI.toast('Enter at least one qty > 0', 'error'); return; }
      UI.toast(`${count} product(s) restocked`, 'success');
      Data.processQueue();
      render(document.getElementById('content'));
    });
  }

  // ─── Data Management ─────────────────────────────────────────────────────────
  function renderData(area) {
    const history = Data.getSyncHistory();
    area.innerHTML = `
      ${UI.panel('DATA MANAGEMENT', `
        <div class="data-actions">
          <button class="btn btn-primary" onclick="Admin.exportAll()">EXPORT ALL DATA (CSV)</button>
          <button class="btn" onclick="Admin.manualSync()">MANUAL SYNC TO SHEETS</button>
          <button class="btn btn-danger" onclick="Admin.clearData()">CLEAR ALL DATA</button>
        </div>
      `)}
      ${UI.panel('SYNC HISTORY (LAST 10)', UI.table(
        ['TIMESTAMP','STATUS','RECORDS SENT'],
        history.map(h => [
          Data.fmtDate(h.timestamp) + ' ' + Data.fmtTime(h.timestamp),
          `<span class="badge ${h.status==='SYNCED'?'badge-ok':'badge-out'}">${h.status}</span>`,
          h.sent || 0
        ]),
        'No sync history'
      ))}
    `;
  }

  async function exportAll() {
    const s = Auth.getSession();
    Data.addAudit('EXPORT_ALL', 'Full data export', s?.staffId);

    const exportData = (name, data, header) => {
      const a = document.createElement('a');
      a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(header + '\n' + data);
      a.download = `ssignals_${name}_${Data.fmtDate(new Date()).replace(/\//g,'-')}.csv`;
      a.click();
    };

    const sales = Data.getSales();
    exportData('sales',
      sales.map(s=>[s.date,s.time,s.product,s.category,s.unit,s.qty,s.amount,s.payment,`"${s.customer||''}"`,s.phone,s.staff,s.id].join(',')).join('\n'),
      'Date,Time,Product,Category,Unit,Qty,Amount,Payment,Customer,Phone,Staff,SaleID'
    );

    setTimeout(() => {
      const prods = Data.getProducts();
      exportData('inventory',
        prods.map(p=>[`"${p.name}"`,p.category,p.unit,p.price,p.stock,p.sold,p.active].join(',')).join('\n'),
        'Product,Category,Unit,Price,Stock,Sold,Active'
      );
    }, 500);

    setTimeout(() => {
      const custs = Data.getCustomers();
      exportData('customers',
        custs.map(c=>[c.phone,`"${c.name||''}"`,c.totalSpent,c.visits,`"${c.favProduct||''}"`,c.lastPurchase?Data.fmtDate(c.lastPurchase):''].join(',')).join('\n'),
        'Phone,Name,TotalSpent,Visits,FavProduct,LastPurchase'
      );
    }, 1000);

    UI.toast('Exporting all data...', 'info', 4000);
  }

  async function manualSync() {
    UI.toast('Syncing to Google Sheets...', 'info');
    await Data.fetchFromSheets();
    await Data.processQueue();
    UI.toast('Sync complete', 'success');
    render(document.getElementById('content'));
  }

  async function clearData() {
    const ok1 = await UI.confirm('This will delete ALL local data (sales, customers, inventory). Are you sure?');
    if (!ok1) return;
    const ok2 = await UI.confirm('FINAL WARNING: This cannot be undone. Type YES by clicking confirm.');
    if (!ok2) return;
    const s = Auth.getSession();
    Data.addAudit('DATA_CLEARED', 'All local data cleared', s?.staffId);
    Object.values(CONFIG.KEYS).forEach(k => {
      if (k !== CONFIG.KEYS.SESSION && k !== CONFIG.KEYS.SETTINGS) {
        localStorage.removeItem(k);
      }
    });
    Data.init();
    UI.toast('Data cleared and re-seeded', 'info');
    render(document.getElementById('content'));
  }

  // ─── Settings ────────────────────────────────────────────────────────────────
  function renderSettings(area) {
    const settings = Data.getSettings();
    area.innerHTML = UI.panel('SYSTEM SETTINGS', `
      <form id="settings-form" class="form-grid">
        <div class="form-group">
          <label>BUSINESS NAME</label>
          <input type="text" id="cfg-name" value="${UI.esc(settings.appName)}">
        </div>
        <div class="form-group">
          <label>BRANCH NAME</label>
          <input type="text" id="cfg-branch" value="${UI.esc(settings.branch)}">
        </div>
        <div class="form-group">
          <label>CURRENCY SYMBOL</label>
          <input type="text" id="cfg-currency" value="${UI.esc(settings.currency)}" maxlength="3">
        </div>
        <div class="form-group">
          <label>LOW STOCK THRESHOLD</label>
          <input type="number" id="cfg-threshold" value="${settings.lowStockThreshold}" min="1">
        </div>
        <div class="form-group">
          <label>SESSION TIMEOUT (minutes)</label>
          <input type="number" id="cfg-timeout" value="${settings.sessionTimeout}" min="5" max="480">
        </div>
        <div class="form-group">
          <label>GOOGLE APPS SCRIPT URL</label>
          <input type="url" id="cfg-url" value="${UI.esc(settings.appsScriptUrl||'')}" placeholder="https://script.google.com/macros/s/...">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">SAVE SETTINGS</button>
          <button type="button" class="btn btn-sm" id="btn-test-conn">TEST CONNECTION</button>
        </div>
      </form>
    `);

    document.getElementById('settings-form').addEventListener('submit', e => {
      e.preventDefault();
      saveSettings();
    });

    document.getElementById('btn-test-conn').addEventListener('click', testConnection);
  }

  function saveSettings() {
    const s = Auth.getSession();
    const settings = {
      appName:           document.getElementById('cfg-name').value.trim() || 'Smoke Signals',
      branch:            document.getElementById('cfg-branch').value.trim() || 'Cape Town',
      currency:          document.getElementById('cfg-currency').value.trim() || 'R',
      lowStockThreshold: parseInt(document.getElementById('cfg-threshold').value, 10) || 10,
      sessionTimeout:    parseInt(document.getElementById('cfg-timeout').value, 10) || 30,
      appsScriptUrl:     document.getElementById('cfg-url').value.trim(),
    };
    Data.saveSettings(settings);
    Data.addAudit('SETTINGS_SAVED', 'System settings updated', s?.staffId);
    UI.toast('Settings saved', 'success');
    UI.renderTopBar();
  }

  async function testConnection() {
    const url = document.getElementById('cfg-url').value.trim();
    if (!url) { UI.toast('Enter the Apps Script URL first', 'error'); return; }
    UI.toast('Testing connection...', 'info');
    try {
      const resp = await fetch(`${url}?action=ping`);
      if (resp.ok) {
        UI.toast('Connection successful!', 'success');
      } else {
        UI.toast(`Connection failed: HTTP ${resp.status}`, 'error');
      }
    } catch (e) {
      UI.toast(`Connection failed: ${e.message}`, 'error');
    }
  }

  return {
    render, subNavigate,
    showAddStaffForm, cancelStaffForm, editStaff, doResetPIN, toggleStaff, saveStaff,
    exportAll, manualSync, clearData,
  };
})();

// ─── Setup Tab ────────────────────────────────────────────────────────────────
const Setup = (() => {
  function render(container) {
    const settings = Data.getSettings();
    const hasUrl = !!settings.appsScriptUrl;

    container.innerHTML = `
      <div class="content-inner">
        ${UI.panel('GOOGLE SHEETS SETUP', `
          <div class="setup-steps">
            <div class="setup-step">
              <div class="step-num">1</div>
              <div class="step-body">
                <strong>Create a Google Spreadsheet</strong><br>
                Go to sheets.google.com → New spreadsheet. Name it "Smoke Signals".
              </div>
            </div>
            <div class="setup-step">
              <div class="step-num">2</div>
              <div class="step-body">
                <strong>Open Apps Script editor</strong><br>
                In the spreadsheet: Extensions → Apps Script.
                Delete all existing code.
              </div>
            </div>
            <div class="setup-step">
              <div class="step-num">3</div>
              <div class="step-body">
                <strong>Paste the Apps Script code</strong><br>
                Copy the complete code from the section below. Paste it into the editor. Save (Ctrl+S).
              </div>
            </div>
            <div class="setup-step">
              <div class="step-num">4</div>
              <div class="step-body">
                <strong>Deploy as Web App</strong><br>
                Click Deploy → New deployment → Web app.<br>
                Execute as: <em>Me</em> &nbsp;|&nbsp; Who has access: <em>Anyone</em>.<br>
                Click Deploy. Authorise when prompted. Copy the Web App URL.
              </div>
            </div>
            <div class="setup-step">
              <div class="step-num">5</div>
              <div class="step-body">
                <strong>Enter the URL below</strong><br>
                Paste the Web App URL into the field below and click Save.
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-top:20px">
            <label>APPS SCRIPT WEB APP URL</label>
            <div class="input-with-btn">
              <input type="url" id="setup-url" value="${UI.esc(settings.appsScriptUrl||'')}" placeholder="https://script.google.com/macros/s/...">
              <button class="btn btn-primary btn-sm" id="btn-save-url">SAVE</button>
            </div>
          </div>
          <div style="margin-top:8px">
            <button class="btn btn-sm" id="btn-test-url">TEST CONNECTION</button>
            <span id="conn-status" style="margin-left:12px;font-size:0.8rem;color:${hasUrl?'var(--accent)':'var(--text-dim)'}">
              ${hasUrl ? '● CONFIGURED' : '○ NOT CONFIGURED'}
            </span>
          </div>
        `)}

        ${UI.panel('APPS SCRIPT CODE', `
          <div class="code-header">
            <button class="btn btn-sm" id="btn-copy-code">COPY CODE</button>
            <span style="font-size:0.75rem;color:var(--text-dim);margin-left:8px">Copy and paste into Google Apps Script editor</span>
          </div>
          <div class="code-area" id="appsscript-code-area">Loading...</div>
        `)}
      </div>
    `;

    document.getElementById('btn-save-url').addEventListener('click', () => {
      const url = document.getElementById('setup-url').value.trim();
      const s = Data.getSettings();
      Data.saveSettings({ ...s, appsScriptUrl: url });
      Data.addAudit('SETTINGS_SAVED', 'Apps Script URL updated', Auth.getSession()?.staffId);
      UI.toast('URL saved', 'success');
      document.getElementById('conn-status').textContent = url ? '● CONFIGURED' : '○ NOT CONFIGURED';
      document.getElementById('conn-status').style.color = url ? 'var(--accent)' : 'var(--text-dim)';
    });

    document.getElementById('btn-test-url').addEventListener('click', async () => {
      const url = document.getElementById('setup-url').value.trim();
      if (!url) { UI.toast('Enter URL first', 'error'); return; }
      UI.toast('Testing...', 'info');
      try {
        const r = await fetch(`${url}?action=ping`);
        if (r.ok) UI.toast('Connection OK!', 'success');
        else UI.toast(`Failed: HTTP ${r.status}`, 'error');
      } catch (e) { UI.toast(`Failed: ${e.message}`, 'error'); }
    });

    // Load APPSSCRIPT.js content for display
    fetch('APPSSCRIPT.js')
      .then(r => r.text())
      .then(code => {
        const area = document.getElementById('appsscript-code-area');
        if (area) {
          area.innerHTML = `<pre class="code-block">${UI.esc(code)}</pre>`;
        }
        document.getElementById('btn-copy-code').addEventListener('click', () => {
          navigator.clipboard.writeText(code).then(() => UI.toast('Code copied!', 'success'));
        });
      })
      .catch(() => {
        const area = document.getElementById('appsscript-code-area');
        if (area) area.textContent = 'Could not load APPSSCRIPT.js. View the file directly in the project folder.';
      });
  }

  return { render };
})();
