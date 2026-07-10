'use strict';

const Data = (() => {
  const K = CONFIG.KEYS;

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.error('LS write fail', e); }
  }
  function ts() { return new Date().toISOString(); }
  function genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
  function fmtDate(d) {
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
  }
  function fmtTime(d) {
    const dt = new Date(d);
    return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
  }

  // ─── Settings ────────────────────────────────────────────────────────────────
  function getSettings() {
    return Object.assign({
      appName:           CONFIG.APP_NAME,
      branch:            CONFIG.BRANCH,
      currency:          CONFIG.CURRENCY,
      lowStockThreshold: CONFIG.LOW_STOCK_THRESHOLD,
      sessionTimeout:    CONFIG.SESSION_TIMEOUT_MINUTES,
      appsScriptUrl:     CONFIG.DEFAULT_APPS_SCRIPT_URL,
    }, lsGet(K.SETTINGS) || {});
  }
  function saveSettings(s) { lsSet(K.SETTINGS, s); }

  // ─── Staff ───────────────────────────────────────────────────────────────────
  function getStaff() { return lsGet(K.STAFF) || []; }
  function saveStaff(arr) { lsSet(K.STAFF, arr); }
  function getStaffById(id) { return getStaff().find(s => s.id === id); }
  function updateStaffMember(updated) {
    lsSet(K.STAFF, getStaff().map(s => s.id === updated.id ? { ...s, ...updated } : s));
  }
  function addStaffMember(member) {
    const arr = getStaff();
    arr.push(member);
    lsSet(K.STAFF, arr);
  }

  // ─── Sales ───────────────────────────────────────────────────────────────────
  function getSales() { return lsGet(K.SALES) || []; }
  function addSale(sale) {
    const sales = getSales();
    sale.id = sale.id || genId('SALE');
    sale.synced = false;
    sale.createdAt = ts();
    sales.push(sale);
    lsSet(K.SALES, sales);
    queueSync({ action: 'SALE', data: sale });
    return sale;
  }
  function updateSale(updated) {
    lsSet(K.SALES, getSales().map(s => s.id === updated.id ? { ...s, ...updated } : s));
  }
  function deleteSale(id) { lsSet(K.SALES, getSales().filter(s => s.id !== id)); }
  function getSalesByStaff(staffId) { return getSales().filter(s => s.staff === staffId); }
  function markCreditPaid(saleId) {
    const sales = getSales();
    const idx = sales.findIndex(s => s.id === saleId);
    if (idx < 0) return false;
    sales[idx].creditPaid = true;
    sales[idx].creditPaidAt = ts();
    lsSet(K.SALES, sales);
    queueSync({ action: 'SALE_UPDATE', data: sales[idx] });
    return sales[idx];
  }

  // ─── Products ────────────────────────────────────────────────────────────────
  function getProducts() { return lsGet(K.PRODUCTS) || []; }
  function getActiveProducts() { return getProducts().filter(p => p.active); }
  function getProductById(id) { return getProducts().find(p => p.id === id); }
  function saveProductRecord(product) {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === product.id);
    if (idx >= 0) {
      products[idx] = { ...products[idx], ...product, lastUpdated: ts() };
    } else {
      product.id = product.id || genId('PROD');
      product.lastUpdated = ts();
      product.sold = product.sold || 0;
      products.push(product);
    }
    lsSet(K.PRODUCTS, products);
    queueSync({ action: 'PRODUCT_UPDATE', data: product });
    return product;
  }
  function deductStock(productId, qty) {
    const products = getProducts();
    const idx = products.findIndex(p => p.id === productId);
    if (idx >= 0) {
      products[idx].stock = Math.max(0, (products[idx].stock || 0) - qty);
      products[idx].sold = (products[idx].sold || 0) + qty;
      products[idx].lastUpdated = ts();
      lsSet(K.PRODUCTS, products);
      queueSync({ action: 'PRODUCT_UPDATE', data: products[idx] });
    }
  }

  // ─── Customers ───────────────────────────────────────────────────────────────
  function getCustomers() { return lsGet(K.CUSTOMERS) || []; }
  function getCustomerByPhone(phone) { return getCustomers().find(c => c.phone === phone); }
  function upsertCustomer(customer) {
    const customers = getCustomers();
    const idx = customers.findIndex(c => c.phone === customer.phone);
    const now = ts();
    if (idx >= 0) {
      customers[idx] = { ...customers[idx], ...customer, lastUpdated: now };
    } else {
      customer.firstPurchase = customer.firstPurchase || now;
      customer.totalSpent = customer.totalSpent || 0;
      customer.visits = customer.visits || 0;
      customer.lastUpdated = now;
      customers.push(customer);
    }
    lsSet(K.CUSTOMERS, customers);
    queueSync({ action: 'CUSTOMER_UPSERT', data: customer });
    return customer;
  }
  function deleteCustomer(phone) {
    lsSet(K.CUSTOMERS, getCustomers().filter(c => c.phone !== phone));
    queueSync({ action: 'CUSTOMER_DELETE', data: { phone } });
  }
  function updateCustomerAfterSale(phone, name, amount, product) {
    const c = getCustomerByPhone(phone);
    if (!c) return;
    upsertCustomer({
      ...c,
      name: name || c.name,
      lastPurchase: ts(),
      totalSpent: (c.totalSpent || 0) + amount,
      visits: (c.visits || 0) + 1,
      favProduct: product,
    });
  }
  function createCustomerFromSale(phone, name, staffId) {
    const now = ts();
    return upsertCustomer({
      phone, name,
      notes: '',
      firstPurchase: now,
      lastPurchase: now,
      totalSpent: 0,
      visits: 0,
      favProduct: '',
      addedBy: staffId,
    });
  }

  // ─── Audit Log ───────────────────────────────────────────────────────────────
  function getAuditLog() { return lsGet(K.AUDIT) || []; }
  function addAudit(action, details, staffId) {
    const log = getAuditLog();
    const entry = { id: genId('AUDIT'), timestamp: ts(), staff: staffId || 'SYSTEM', action, details };
    log.unshift(entry);
    if (log.length > 2000) log.splice(2000);
    lsSet(K.AUDIT, log);
    return entry;
  }

  // ─── Restocks ────────────────────────────────────────────────────────────────
  function getRestocks() { return lsGet(K.RESTOCKS) || []; }
  function addRestock(restock) {
    const restocks = getRestocks();
    restock.id = restock.id || genId('RESTOCK');
    restock.createdAt = ts();
    restocks.unshift(restock);
    lsSet(K.RESTOCKS, restocks);

    const products = getProducts();
    const idx = products.findIndex(p => p.id === restock.productId);
    if (idx >= 0) {
      products[idx].stock = (products[idx].stock || 0) + parseInt(restock.qty, 10);
      products[idx].lastUpdated = ts();
      lsSet(K.PRODUCTS, products);
    }
    queueSync({ action: 'RESTOCK', data: restock });
    return restock;
  }

  // ─── Sync Queue ──────────────────────────────────────────────────────────────
  function getQueue() { return lsGet(K.SYNC_QUEUE) || []; }
  function queueSync(item) {
    const queue = getQueue();
    item.queueId = genId('Q');
    item.queuedAt = ts();
    item.retries = 0;
    queue.push(item);
    lsSet(K.SYNC_QUEUE, queue);
  }

  async function processQueue() {
    const settings = getSettings();
    if (!settings.appsScriptUrl) {
      App.syncStatus = 'OFFLINE';
      if (typeof UI !== 'undefined') UI.updateBottomBar();
      return;
    }
    const queue = getQueue();
    if (queue.length === 0) {
      App.syncStatus = 'SYNCED';
      if (typeof UI !== 'undefined') UI.updateBottomBar();
      return;
    }

    App.syncStatus = 'SYNCING';
    if (typeof UI !== 'undefined') UI.updateBottomBar();

    const remaining = [];
    for (const item of queue) {
      try {
        await _postToSheets(item, settings.appsScriptUrl);
      } catch {
        item.retries = (item.retries || 0) + 1;
        if (item.retries < 5) remaining.push(item);
      }
    }

    lsSet(K.SYNC_QUEUE, remaining);
    const now = ts();
    lsSet(K.LAST_SYNC, now);
    App.lastSyncTime = now;
    App.syncStatus = remaining.length === 0 ? 'SYNCED' : 'OFFLINE';

    const history = lsGet(K.SYNC_HISTORY) || [];
    history.unshift({ timestamp: now, status: App.syncStatus, sent: queue.length - remaining.length });
    if (history.length > 10) history.splice(10);
    lsSet(K.SYNC_HISTORY, history);

    if (typeof UI !== 'undefined') UI.updateBottomBar();
  }

  async function fetchFromSheets() {
    const settings = getSettings();
    if (!settings.appsScriptUrl) {
      App.syncStatus = 'OFFLINE';
      if (typeof UI !== 'undefined') UI.updateBottomBar();
      return false;
    }
    App.syncStatus = 'SYNCING';
    if (typeof UI !== 'undefined') UI.updateBottomBar();
    try {
      const resp = await fetch(`${settings.appsScriptUrl}?action=getAllData`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      _mergeFromSheets(data);
      const now = ts();
      lsSet(K.LAST_SYNC, now);
      App.lastSyncTime = now;
      App.syncStatus = 'SYNCED';
      if (typeof UI !== 'undefined') UI.updateBottomBar();
      return true;
    } catch (e) {
      console.warn('fetchFromSheets failed:', e.message);
      App.syncStatus = 'OFFLINE';
      if (typeof UI !== 'undefined') UI.updateBottomBar();
      return false;
    }
  }

  async function _postToSheets(item, url) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(item),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  }

  function _mergeFromSheets(data) {
    if (data.sales && Array.isArray(data.sales)) {
      const local = getSales();
      const localById = {};
      local.forEach((s, i) => { localById[s.id] = i; });
      let changed = false;
      const incoming = [];
      data.sales.forEach(s => {
        if (localById[s.id] !== undefined) {
          const idx = localById[s.id];
          if (s.creditPaid && !local[idx].creditPaid) {
            local[idx].creditPaid = true;
            local[idx].creditPaidAt = s.creditPaidAt || ts();
            changed = true;
          }
        } else {
          incoming.push(s);
        }
      });
      if (incoming.length || changed) lsSet(K.SALES, [...local, ...incoming]);
    }
    if (data.inventory && Array.isArray(data.inventory)) {
      const local = getProducts();
      data.inventory.forEach(sp => {
        if (!local.find(p => p.id === sp.id || p.name === sp.name)) {
          local.push({ ...sp, lastUpdated: ts() });
        }
      });
      lsSet(K.PRODUCTS, local);
    }
    if (data.customers && Array.isArray(data.customers)) {
      const local = getCustomers();
      data.customers.forEach(sc => {
        if (!local.find(c => c.phone === sc.phone)) local.push({ ...sc });
      });
      lsSet(K.CUSTOMERS, local);
    }
  }

  function getSyncHistory() { return lsGet(K.SYNC_HISTORY) || []; }

  // ─── Staff PIN sync ──────────────────────────────────────────────────────────
  function syncStaffPIN(member) {
    queueSync({
      action: 'STAFF_PIN_UPDATE',
      data: { id: member.id, name: member.name, role: member.role, pinHash: member.pinHash, active: member.active },
    });
    processQueue();
  }

  async function fetchStaffFromSheets() {
    const settings = getSettings();
    if (!settings.appsScriptUrl) return;
    try {
      const resp = await fetch(`${settings.appsScriptUrl}?action=getStaff`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.staff && Array.isArray(data.staff)) _mergeStaffFromSheets(data.staff);
    } catch (e) {
      console.warn('fetchStaffFromSheets failed:', e.message);
    }
  }

  function _mergeStaffFromSheets(sheetsStaff) {
    const local = getStaff();
    sheetsStaff.forEach(ss => {
      const idx = local.findIndex(s => s.id === ss.id);
      if (idx >= 0) {
        if (ss.pinHash)          local[idx].pinHash = ss.pinHash;
        if (ss.role)             local[idx].role    = ss.role;
        if (ss.active !== undefined) local[idx].active = ss.active === true || ss.active === 'true';
      } else {
        local.push({ id: ss.id, name: ss.name, role: ss.role, pinHash: ss.pinHash,
          active: ss.active === true || ss.active === 'true',
          failedAttempts: 0, lockedUntil: null, lastLogin: null });
      }
    });
    lsSet(K.STAFF, local);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    if (lsGet(K.INITIALIZED)) return;

    lsSet(K.STAFF, CONFIG.SEED_STAFF.map(s => ({ ...s })));
    lsSet(K.PRODUCTS, CONFIG.SEED_PRODUCTS.map(p => ({ ...p, lastUpdated: ts() })));

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = fmtDate(yesterday);

    lsSet(K.CUSTOMERS, [
      { phone: '0821110001', name: 'Nyama', notes: '', firstPurchase: yesterday.toISOString(),
        lastPurchase: yesterday.toISOString(), totalSpent: 350, visits: 1,
        favProduct: 'Indoor Prerolls', addedBy: 'GHST', lastUpdated: yesterday.toISOString() },
      { phone: '0829990002', name: 'Aishah Anyvan', notes: '', firstPurchase: yesterday.toISOString(),
        lastPurchase: yesterday.toISOString(), totalSpent: 200, visits: 1,
        favProduct: 'Gummies', addedBy: 'GHST', lastUpdated: yesterday.toISOString() },
    ]);

    lsSet(K.SALES, [
      { id: 'SALE_SEED_001', date: yDate, time: '10:30', product: 'Indoor Prerolls',
        productId: 'PROD_001', category: 'Prerolls', unit: 'each', qty: 5, amount: 350,
        payment: 'CASH', customer: 'Nyama', phone: '0821110001', staff: 'GHST',
        synced: false, createdAt: yesterday.toISOString() },
      { id: 'SALE_SEED_002', date: yDate, time: '11:45', product: 'Gummies',
        productId: 'PROD_002', category: 'Edibles', unit: 'each', qty: 8, amount: 200,
        payment: 'EFT', customer: 'Aishah Anyvan', phone: '0829990002', staff: 'GHST',
        synced: false, createdAt: yesterday.toISOString() },
    ]);

    lsSet(K.INITIALIZED, true);
  }

  return {
    lsGet, lsSet, genId, fmtDate, fmtTime,
    getSettings, saveSettings,
    getStaff, saveStaff, getStaffById, updateStaffMember, addStaffMember,
    getSales, addSale, updateSale, deleteSale, getSalesByStaff, markCreditPaid,
    getProducts, getActiveProducts, getProductById, saveProductRecord, deductStock,
    getCustomers, getCustomerByPhone, upsertCustomer, deleteCustomer,
    updateCustomerAfterSale, createCustomerFromSale,
    getAuditLog, addAudit,
    getRestocks, addRestock,
    getQueue, queueSync, processQueue,
    fetchFromSheets, fetchStaffFromSheets, syncStaffPIN, getSyncHistory,
    init,
  };
})();
