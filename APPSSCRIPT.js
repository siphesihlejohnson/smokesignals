// ============================================================================
// Smoke Signals — Google Apps Script
// Paste this ENTIRE file into the Apps Script editor (Extensions → Apps Script)
// Deploy as Web App: Execute as Me, Anyone can access
// ============================================================================

const SHEET_NAME_SALES     = 'Sales';
const SHEET_NAME_INVENTORY = 'Inventory';
const SHEET_NAME_CUSTOMERS = 'Customers';
const SHEET_NAME_SUMMARY   = 'Summary';
const SHEET_NAME_STAFF     = 'Staff';

// ── Entry Points ─────────────────────────────────────────────────────────────

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';

  if (action === 'ping') {
    return respond({ status: 'ok', version: '1.0' });
  }

  if (action === 'getStaff') {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const staff = sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_STAFF, getStaffHeaders()));
      return respond({ staff });
    } catch (err) {
      return respond({ error: err.message }, 500);
    }
  }

  // Default: return all data
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = {
      sales:     sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_SALES,     getSalesHeaders())),
      inventory: sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_INVENTORY, getInventoryHeaders())),
      customers: sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_CUSTOMERS, getCustomerHeaders())),
      summary:   sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_SUMMARY,   getSummaryHeaders())),
      staff:     sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_STAFF,     getStaffHeaders())),
    };
    return respond(result);
  } catch (err) {
    return respond({ error: err.message }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const data   = body.data;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    switch (action) {
      case 'SALE':
        appendSale(ss, data);
        updateSummary(ss);
        break;
      case 'PRODUCT_UPDATE':
        upsertInventory(ss, data);
        break;
      case 'CUSTOMER_UPSERT':
        upsertCustomer(ss, data);
        break;
      case 'CUSTOMER_DELETE':
        deleteCustomerRow(ss, data.phone);
        break;
      case 'SALE_UPDATE':
        updateSaleRow(ss, data);
        break;
      case 'RESTOCK':
        processRestock(ss, data);
        updateSummary(ss);
        break;
      case 'STAFF_PIN_UPDATE':
        upsertStaff(ss, data);
        break;
      default:
        return respond({ status: 'unknown_action', action });
    }

    return respond({ status: 'ok', action });
  } catch (err) {
    return respond({ error: err.message }, 500);
  }
}

// ── Sheet Helpers ─────────────────────────────────────────────────────────────

function respond(data, code) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects(sheet) {
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h).trim());
  return rows.slice(1).filter(r => r.some(c => c !== '')).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function findRowByColumn(sheet, colIndex, value) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) return i + 1; // 1-indexed
  }
  return -1;
}

// ── Headers ────────────────────────────────────────────────────────────────

function getSalesHeaders() {
  return ['id','date','time','product','productId','category','unit','qty','amount','payment','customer','phone','staff','createdAt','creditPaid','creditPaidAt'];
}
function getInventoryHeaders() {
  return ['id','name','category','unit','price','stock','sold','active','lastUpdated'];
}
function getStaffHeaders() {
  return ['id','name','role','pinHash','active'];
}
function getCustomerHeaders() {
  return ['phone','name','notes','firstPurchase','lastPurchase','totalSpent','visits','favProduct','addedBy','lastUpdated'];
}
function getSummaryHeaders() {
  return ['month','revenue','cash','eft','unitsSold','newCustomers','returningCustomers','salesCount'];
}

// ── Sales ─────────────────────────────────────────────────────────────────────

function updateSaleRow(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_SALES, getSalesHeaders());
  const rowNum = findRowByColumn(sheet, 0, data.id);
  if (rowNum < 0) return;
  const headers = getSalesHeaders();
  headers.forEach((h, i) => {
    if (data[h] !== undefined) sheet.getRange(rowNum, i + 1).setValue(data[h]);
  });
}

function appendSale(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_SALES, getSalesHeaders());
  const headers = getSalesHeaders();
  const row = headers.map(h => data[h] !== undefined ? data[h] : '');
  sheet.appendRow(row);
}

// ── Inventory ─────────────────────────────────────────────────────────────────

function upsertInventory(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_INVENTORY, getInventoryHeaders());
  const headers = getInventoryHeaders();

  // Find by id first, then by name
  let rowNum = findRowByColumn(sheet, 0, data.id);
  if (rowNum < 0) rowNum = findRowByColumn(sheet, 1, data.name);

  const row = headers.map(h => data[h] !== undefined ? data[h] : '');
  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function processRestock(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_INVENTORY, getInventoryHeaders());

  let rowNum = findRowByColumn(sheet, 0, data.productId);
  if (rowNum < 0) rowNum = findRowByColumn(sheet, 1, data.productName);
  if (rowNum < 0) return;

  const headers = getInventoryHeaders();
  const stockCol = headers.indexOf('stock') + 1;
  const soldCol  = headers.indexOf('sold') + 1;
  const updCol   = headers.indexOf('lastUpdated') + 1;

  const currentStock = sheet.getRange(rowNum, stockCol).getValue() || 0;
  sheet.getRange(rowNum, stockCol).setValue(Number(currentStock) + Number(data.qty));
  sheet.getRange(rowNum, updCol).setValue(new Date().toISOString());
}

// ── Staff ─────────────────────────────────────────────────────────────────────

function upsertStaff(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_STAFF, getStaffHeaders());
  const headers = getStaffHeaders();
  const rowNum = findRowByColumn(sheet, 0, data.id);
  const row = headers.map(h => data[h] !== undefined ? data[h] : '');
  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// ── Customers ─────────────────────────────────────────────────────────────────

function upsertCustomer(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_CUSTOMERS, getCustomerHeaders());
  const headers = getCustomerHeaders();
  const rowNum = findRowByColumn(sheet, 0, data.phone);
  const row = headers.map(h => data[h] !== undefined ? data[h] : '');

  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deleteCustomerRow(ss, phone) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_CUSTOMERS, getCustomerHeaders());
  const rowNum = findRowByColumn(sheet, 0, phone);
  if (rowNum > 0) sheet.deleteRow(rowNum);
}

// ── Summary (auto-calculated) ─────────────────────────────────────────────────

function updateSummary(ss) {
  const salesSheet = getOrCreateSheet(ss, SHEET_NAME_SALES, getSalesHeaders());
  const custSheet  = getOrCreateSheet(ss, SHEET_NAME_CUSTOMERS, getCustomerHeaders());
  const sumSheet   = getOrCreateSheet(ss, SHEET_NAME_SUMMARY, getSummaryHeaders());

  const sales = sheetToObjects(salesSheet);
  const customers = sheetToObjects(custSheet);

  // Group sales by month (YYYY-MM from date DD/MM/YYYY)
  const monthly = {};
  sales.forEach(sale => {
    const parts = String(sale.date || '').split('/');
    if (parts.length < 3) return;
    const key = `${parts[2]}-${parts[1]}`;
    if (!monthly[key]) {
      monthly[key] = { month: key, revenue: 0, cash: 0, eft: 0, unitsSold: 0, salesCount: 0 };
    }
    const amount = Number(sale.amount) || 0;
    const qty    = Number(sale.qty) || 0;
    monthly[key].revenue    += amount;
    monthly[key].salesCount += 1;
    monthly[key].unitsSold  += qty;
    if (String(sale.payment).toUpperCase() === 'CASH') monthly[key].cash += amount;
    else monthly[key].eft += amount;
  });

  // Count new customers per month
  customers.forEach(c => {
    if (!c.firstPurchase) return;
    const d = new Date(c.firstPurchase);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (monthly[key]) monthly[key].newCustomers = (monthly[key].newCustomers || 0) + 1;
  });

  // Calculate returning
  Object.values(monthly).forEach(m => {
    m.newCustomers       = m.newCustomers || 0;
    m.returningCustomers = Math.max(0, m.salesCount - m.newCustomers);
  });

  // Rewrite summary sheet
  const headers = getSummaryHeaders();
  const rows = Object.values(monthly).sort((a,b) => a.month.localeCompare(b.month));

  // Clear existing data (keep header)
  const lastRow = sumSheet.getLastRow();
  if (lastRow > 1) sumSheet.deleteRows(2, lastRow - 1);

  rows.forEach(row => {
    sumSheet.appendRow(headers.map(h => row[h] !== undefined ? row[h] : 0));
  });
}
