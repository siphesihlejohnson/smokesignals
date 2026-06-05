'use strict';

const Customers = (() => {
  let _allCustomers = [];
  let _filtered = [];

  function render(container) {
    _allCustomers = Data.getCustomers();
    _filtered = [..._allCustomers].sort((a,b) => (b.totalSpent||0) - (a.totalSpent||0));

    container.innerHTML = `
      <div class="content-inner">
        ${UI.panel('CUSTOMERS', `
          <div class="filter-row">
            <div class="form-group">
              <label>SEARCH</label>
              <input type="text" id="cust-search" placeholder="Name or phone...">
            </div>
            <button class="btn btn-primary btn-sm" id="btn-add-cust">+ ADD CUSTOMER</button>
            <button class="btn btn-sm" id="btn-export-cust">EXPORT CSV</button>
          </div>
          <div id="cust-table"></div>
          <div id="cust-total" class="log-total"></div>
        `)}
        <div id="cust-form-area"></div>
      </div>
    `;

    document.getElementById('cust-search').addEventListener('input', e => filterCustomers(e.target.value));
    document.getElementById('btn-add-cust').addEventListener('click', showAddForm);
    document.getElementById('btn-export-cust').addEventListener('click', exportCSV);

    renderTable(_filtered);
  }

  function filterCustomers(query) {
    const q = query.toLowerCase();
    _filtered = q
      ? _allCustomers.filter(c => (c.name||'').toLowerCase().includes(q) || (c.phone||'').includes(q))
      : [..._allCustomers].sort((a,b) => (b.totalSpent||0) - (a.totalSpent||0));
    renderTable(_filtered);
  }

  function renderTable(customers) {
    const el = document.getElementById('cust-table');
    if (!el) return;
    el.innerHTML = UI.table(
      ['NAME','PHONE','SPENT','VISITS','FAV PRODUCT','LAST SEEN','NOTES','ACTIONS'],
      customers.map(c => [
        UI.esc(c.name),
        c.phone,
        UI.fmtCurrency(c.totalSpent||0),
        c.visits||0,
        UI.esc(c.favProduct||'N/A'),
        c.lastPurchase ? Data.fmtDate(c.lastPurchase) : 'Never',
        UI.esc(c.notes||''),
        `<button class="btn btn-xs" onclick="Customers.showEditForm('${c.phone.replace(/'/g,"\\'")}')">EDIT</button>
         <button class="btn btn-xs btn-danger" onclick="Customers.deleteCustomer('${c.phone.replace(/'/g,"\\'")}')">DEL</button>`,
      ]),
      'No customers found'
    );

    const totalEl = document.getElementById('cust-total');
    if (totalEl) {
      const totalSpent = customers.reduce((a,c) => a + (c.totalSpent||0), 0);
      totalEl.innerHTML = `<span>CUSTOMERS: <strong>${customers.length}</strong></span> <span>TOTAL SPENT: <strong>${UI.fmtCurrency(totalSpent)}</strong></span>`;
    }
  }

  function showAddForm() {
    const area = document.getElementById('cust-form-area');
    area.innerHTML = UI.panel('ADD CUSTOMER', `
      <form id="cust-form" class="form-grid">
        <div class="form-group">
          <label>NAME *</label>
          <input type="text" id="cf-name" required>
        </div>
        <div class="form-group">
          <label>PHONE *</label>
          <input type="tel" id="cf-phone" maxlength="10" required>
        </div>
        <div class="form-group">
          <label>NOTES</label>
          <textarea id="cf-notes" rows="2"></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">SAVE CUSTOMER</button>
          <button type="button" class="btn btn-secondary" onclick="Customers.cancelForm()">CANCEL</button>
        </div>
      </form>
    `);
    document.getElementById('cust-form').addEventListener('submit', e => { e.preventDefault(); saveCustomer(); });
    document.getElementById('cf-name').focus();
  }

  function showEditForm(phone) {
    const customer = Data.getCustomerByPhone(phone);
    if (!customer) { UI.toast('Customer not found', 'error'); return; }
    const area = document.getElementById('cust-form-area');

    area.innerHTML = UI.panel(`EDIT: ${UI.esc(customer.name)}`, `
      <form id="cust-edit-form" class="form-grid">
        <div class="form-group">
          <label>NAME *</label>
          <input type="text" id="ef-name" value="${UI.esc(customer.name)}" required>
        </div>
        <div class="form-group">
          <label>PHONE *</label>
          <input type="tel" id="ef-phone" value="${UI.esc(customer.phone)}" maxlength="10" required>
        </div>
        <div class="form-group">
          <label>NOTES</label>
          <textarea id="ef-notes" rows="2">${UI.esc(customer.notes||'')}</textarea>
        </div>
        <div class="cust-stats">
          <span>TOTAL SPENT: ${UI.fmtCurrency(customer.totalSpent||0)}</span>
          <span>VISITS: ${customer.visits||0}</span>
          <span>FIRST PURCHASE: ${customer.firstPurchase ? Data.fmtDate(customer.firstPurchase) : 'Unknown'}</span>
          <span>FAV PRODUCT: ${UI.esc(customer.favProduct||'N/A')}</span>
          <span>ADDED BY: ${customer.addedBy||'Unknown'}</span>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">SAVE CHANGES</button>
          <button type="button" class="btn btn-secondary" onclick="Customers.cancelForm()">CANCEL</button>
          <button type="button" class="btn btn-danger" onclick="Customers.deleteCustomer('${UI.esc(phone)}')">DELETE CUSTOMER</button>
        </div>
      </form>
    `);

    document.getElementById('cust-edit-form').addEventListener('submit', e => {
      e.preventDefault();
      updateCustomer(phone);
    });
  }

  function saveCustomer() {
    const name  = document.getElementById('cf-name').value.trim();
    const phone = document.getElementById('cf-phone').value.trim();
    const notes = document.getElementById('cf-notes').value.trim();

    if (!name)  { UI.toast('Name required', 'error'); return; }
    if (!phone) { UI.toast('Phone required', 'error'); return; }
    if (Data.getCustomerByPhone(phone)) { UI.toast('Phone already exists', 'error'); return; }

    const s = Auth.getSession();
    Data.upsertCustomer({ phone, name, notes, totalSpent: 0, visits: 0, favProduct: '', addedBy: s?.staffId });
    Data.addAudit('CUSTOMER_ADDED', `${name} (${phone})`, s?.staffId);
    UI.toast('Customer added', 'success');
    cancelForm();
    _allCustomers = Data.getCustomers();
    _filtered = [..._allCustomers].sort((a,b) => (b.totalSpent||0) - (a.totalSpent||0));
    renderTable(_filtered);
    Data.processQueue();
  }

  function updateCustomer(oldPhone) {
    const name  = document.getElementById('ef-name').value.trim();
    const phone = document.getElementById('ef-phone').value.trim();
    const notes = document.getElementById('ef-notes').value.trim();

    if (!name)  { UI.toast('Name required', 'error'); return; }
    if (!phone) { UI.toast('Phone required', 'error'); return; }

    const existing = Data.getCustomerByPhone(oldPhone);
    if (!existing) { UI.toast('Customer not found', 'error'); return; }

    if (phone !== oldPhone && Data.getCustomerByPhone(phone)) {
      UI.toast('Phone already used by another customer', 'error'); return;
    }

    // If phone changed, we need to update all sales records
    const s = Auth.getSession();
    if (phone !== oldPhone) {
      const sales = Data.getSales().map(sale =>
        sale.phone === oldPhone ? { ...sale, customer: name, phone } : sale
      );
      Data.lsSet(CONFIG.KEYS.SALES, sales);
      Data.deleteCustomer(oldPhone);
      Data.upsertCustomer({ ...existing, phone, name, notes });
    } else {
      Data.upsertCustomer({ ...existing, name, notes });
      // Cascade name change to sales
      const sales = Data.getSales().map(sale =>
        sale.phone === phone ? { ...sale, customer: name } : sale
      );
      Data.lsSet(CONFIG.KEYS.SALES, sales);
    }

    Data.addAudit('CUSTOMER_EDITED', `${existing.name} → ${name} (${phone})`, s?.staffId);
    UI.toast('Customer updated', 'success');
    cancelForm();
    _allCustomers = Data.getCustomers();
    _filtered = [..._allCustomers].sort((a,b) => (b.totalSpent||0) - (a.totalSpent||0));
    renderTable(_filtered);
    Data.processQueue();
  }

  async function deleteCustomer(phone) {
    const customer = Data.getCustomerByPhone(phone);
    if (!customer) { UI.toast('Customer not found', 'error'); return; }

    const ok = await UI.confirm(`Delete ${customer.name} (${phone})? This cannot be undone.`);
    if (!ok) return;

    const s = Auth.getSession();
    Data.deleteCustomer(phone);
    Data.addAudit('CUSTOMER_DELETED', `${customer.name} (${phone})`, s?.staffId);
    UI.toast('Customer deleted', 'info');
    cancelForm();
    _allCustomers = Data.getCustomers();
    _filtered = [..._allCustomers].sort((a,b) => (b.totalSpent||0) - (a.totalSpent||0));
    renderTable(_filtered);
    Data.processQueue();
  }

  function cancelForm() {
    const area = document.getElementById('cust-form-area');
    if (area) area.innerHTML = '';
  }

  function exportCSV() {
    const s = Auth.getSession();
    Data.addAudit('EXPORT_CSV', `Customer list exported (${_filtered.length} records)`, s?.staffId);
    const header = 'Phone,Name,Notes,First Purchase,Last Purchase,Total Spent,Visits,Fav Product,Added By\n';
    const rows = _filtered.map(c =>
      [c.phone, `"${c.name||''}"`, `"${c.notes||''}"`,
       c.firstPurchase ? Data.fmtDate(c.firstPurchase) : '',
       c.lastPurchase  ? Data.fmtDate(c.lastPurchase)  : '',
       c.totalSpent||0, c.visits||0, `"${c.favProduct||''}"`, c.addedBy||''].join(',')
    ).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(header + rows);
    a.download = 'customers_export.csv';
    a.click();
  }

  return { render, showEditForm, deleteCustomer, cancelForm };
})();
