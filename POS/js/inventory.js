'use strict';

const Inventory = (() => {
  function render(container) {
    const settings = Data.getSettings();
    const threshold = settings.lowStockThreshold || CONFIG.LOW_STOCK_THRESHOLD;
    const products  = Data.getProducts();

    container.innerHTML = `
      <div class="content-inner">
        ${UI.panel('INVENTORY', `
          <div class="inv-actions">
            <button class="btn btn-primary btn-sm" id="btn-add-product">+ ADD PRODUCT</button>
            <button class="btn btn-sm" id="btn-restock">RESTOCK</button>
          </div>
          <div id="inv-table">${buildTable(products, threshold)}</div>
        `)}
        <div id="inv-form-area"></div>
        <div id="restock-history-panel">${buildRestockHistory()}</div>
      </div>
    `;

    document.getElementById('btn-add-product').addEventListener('click', () => showAddForm());
    document.getElementById('btn-restock').addEventListener('click', () => showRestockForm());
  }

  function buildTable(products, threshold) {
    return UI.table(
      ['NAME','CATEGORY','UNIT','PRICE','STOCK','SOLD','STATUS','ACTIONS'],
      products.map(p => [
        UI.esc(p.name),
        UI.esc(p.category),
        p.unit,
        UI.fmtCurrency(p.price),
        p.stock,
        p.sold || 0,
        UI.statusBadge(p.stock, threshold) + (!p.active ? ' <span class="badge badge-dim">INACTIVE</span>' : ''),
        `<button class="btn btn-xs" onclick="Inventory.editProduct('${p.id}')">EDIT</button>
         <button class="btn btn-xs" onclick="Inventory.quickRestock('${p.id}')">RESTOCK</button>
         <button class="btn btn-xs ${p.active ? 'btn-warn' : 'btn-ok'}" onclick="Inventory.toggleActive('${p.id}')">
           ${p.active ? 'DEACTIVATE' : 'ACTIVATE'}
         </button>`,
      ]),
      'No products. Click ADD PRODUCT to get started.'
    );
  }

  function buildRestockHistory() {
    const restocks = Data.getRestocks().slice(0, 20);
    return UI.panel('RESTOCK HISTORY', UI.table(
      ['DATE','PRODUCT','QTY','SUPPLIER','STAFF'],
      restocks.map(r => [
        Data.fmtDate(r.createdAt),
        UI.esc(r.productName),
        r.qty,
        UI.esc(r.supplier),
        r.staff,
      ]),
      'No restocks recorded'
    ));
  }

  function refreshTable() {
    const settings = Data.getSettings();
    const threshold = settings.lowStockThreshold || CONFIG.LOW_STOCK_THRESHOLD;
    const el = document.getElementById('inv-table');
    if (el) el.innerHTML = buildTable(Data.getProducts(), threshold);
    const rh = document.getElementById('restock-history-panel');
    if (rh) rh.innerHTML = buildRestockHistory();
  }

  function showAddForm(existing) {
    const area = document.getElementById('inv-form-area');
    const isEdit = !!existing;
    const p = existing || {};

    area.innerHTML = UI.panel(isEdit ? `EDIT: ${UI.esc(p.name)}` : 'ADD PRODUCT', `
      <form id="prod-form" class="form-grid">
        <div class="form-group">
          <label for="pf-name">PRODUCT NAME *</label>
          <input type="text" id="pf-name" value="${UI.esc(p.name||'')}" required>
        </div>
        <div class="form-group">
          <label for="pf-category">CATEGORY</label>
          <input type="text" id="pf-category" value="${UI.esc(p.category||'')}" list="cat-list" placeholder="Prerolls, Flower, Edibles...">
          <datalist id="cat-list">
            ${[...new Set(Data.getProducts().map(x=>x.category))].filter(Boolean).map(c=>`<option value="${UI.esc(c)}">`).join('')}
          </datalist>
        </div>
        <div class="form-group">
          <label for="pf-unit">UNIT TYPE</label>
          <select id="pf-unit">
            <option value="each" ${(p.unit||'each')==='each'?'selected':''}>Each</option>
            <option value="gram" ${p.unit==='gram'?'selected':''}>Gram</option>
          </select>
        </div>
        <div class="form-group">
          <label for="pf-price">PRICE (${Data.getSettings().currency||'R'})</label>
          <input type="number" id="pf-price" value="${p.price||''}" min="0" step="0.01" required>
        </div>
        <div class="form-group">
          <label for="pf-stock">${isEdit ? 'ADJUST STOCK BY' : 'OPENING STOCK'}</label>
          <input type="number" id="pf-stock" value="${isEdit ? 0 : (p.stock||0)}" step="0.1">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">${isEdit ? 'SAVE CHANGES' : 'ADD PRODUCT'}</button>
          <button type="button" class="btn btn-secondary" onclick="Inventory.cancelForm()">CANCEL</button>
        </div>
      </form>
    `);

    document.getElementById('prod-form').addEventListener('submit', e => {
      e.preventDefault();
      saveProduct(existing);
    });
    document.getElementById('pf-name').focus();
  }

  function saveProduct(existing) {
    const name  = document.getElementById('pf-name').value.trim();
    const cat   = document.getElementById('pf-category').value.trim();
    const unit  = document.getElementById('pf-unit').value;
    const price = parseFloat(document.getElementById('pf-price').value);
    const stockInput = parseFloat(document.getElementById('pf-stock').value) || 0;

    if (!name)           { UI.toast('Product name required', 'error'); return; }
    if (isNaN(price))    { UI.toast('Valid price required', 'error'); return; }

    const s = Auth.getSession();
    if (existing) {
      const updated = {
        ...existing,
        name, category: cat, unit, price,
        stock: Math.max(0, (existing.stock || 0) + stockInput),
      };
      Data.saveProductRecord(updated);
      Data.addAudit('PRODUCT_EDITED', `${existing.name} → ${name} | price R${price}`, s?.staffId);
      UI.toast('Product updated', 'success');
    } else {
      Data.saveProductRecord({ name, category: cat, unit, price, stock: stockInput, sold: 0, active: true });
      Data.addAudit('PRODUCT_ADDED', `${name} (${unit}) @ R${price}, stock ${stockInput}`, s?.staffId);
      UI.toast('Product added', 'success');
    }

    cancelForm();
    refreshTable();
    Data.processQueue();
  }

  function editProduct(id) {
    const p = Data.getProductById(id);
    if (p) showAddForm(p);
  }

  function cancelForm() {
    const area = document.getElementById('inv-form-area');
    if (area) area.innerHTML = '';
  }

  function toggleActive(id) {
    const p = Data.getProductById(id);
    if (!p) return;
    const s = Auth.getSession();
    Data.saveProductRecord({ ...p, active: !p.active });
    Data.addAudit('PRODUCT_TOGGLED', `${p.name} set to ${!p.active ? 'ACTIVE' : 'INACTIVE'}`, s?.staffId);
    UI.toast(`${p.name} ${!p.active ? 'activated' : 'deactivated'}`, 'info');
    refreshTable();
    Data.processQueue();
  }

  function showRestockForm(preselect) {
    const area = document.getElementById('inv-form-area');
    const products = Data.getProducts().filter(p => p.active);

    area.innerHTML = UI.panel('RESTOCK', `
      <form id="restock-form" class="form-grid">
        <div class="form-group">
          <label for="rs-product">PRODUCT *</label>
          <select id="rs-product">
            <option value="">-- SELECT --</option>
            ${products.map(p => `<option value="${p.id}" ${p.id===preselect?'selected':''}>${UI.esc(p.name)} (${p.stock} in stock)</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label for="rs-qty">QTY RECEIVED *</label>
          <input type="number" id="rs-qty" min="1" step="1" placeholder="0">
        </div>
        <div class="form-group">
          <label for="rs-supplier">SUPPLIER</label>
          <input type="text" id="rs-supplier" placeholder="Supplier name">
        </div>
        <div class="form-group">
          <label for="rs-date">DATE</label>
          <input type="date" id="rs-date" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">CONFIRM RESTOCK</button>
          <button type="button" class="btn btn-secondary" onclick="Inventory.cancelForm()">CANCEL</button>
        </div>
      </form>
    `);

    document.getElementById('restock-form').addEventListener('submit', e => {
      e.preventDefault();
      processRestock();
    });
  }

  function quickRestock(id) { showRestockForm(id); }

  function processRestock() {
    const productId = document.getElementById('rs-product').value;
    const qty       = parseFloat(document.getElementById('rs-qty').value);
    const supplier  = document.getElementById('rs-supplier').value.trim();
    const date      = document.getElementById('rs-date').value;

    if (!productId)     { UI.toast('Select a product', 'error'); return; }
    if (!qty || qty <=0){ UI.toast('Enter a valid quantity', 'error'); return; }

    const s = Auth.getSession();
    const product = Data.getProductById(productId);

    Data.addRestock({
      productId,
      productName: product.name,
      qty,
      supplier: supplier || 'Unknown',
      date: date || Data.fmtDate(new Date()),
      staff: s?.staffName,
    });

    Data.addAudit('RESTOCK', `${product.name} +${qty} from ${supplier||'Unknown'}`, s?.staffId);
    UI.toast(`Restocked ${product.name} +${qty}`, 'success');
    cancelForm();
    refreshTable();
    Data.processQueue();
  }

  return {
    render,
    editProduct,
    cancelForm,
    toggleActive,
    quickRestock,
  };
})();
