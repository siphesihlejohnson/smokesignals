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

// ── Security helpers ─────────────────────────────────────────────────────────
//
// This Web App is deployed "Anyone can access" (required so the static POS
// client can reach it without an OAuth flow), so doPost/doGet cannot assume
// the caller is legitimate. Two independent secrets, kept OUT of the public
// GitHub repo, gate the sensitive operations:
//
//   API_KEY     — Script property. If set, every doPost write must include a
//                 matching data.apiKey, or it's rejected. Set it once via
//                 Project Settings → Script Properties, then enter the same
//                 value in the POS's Admin → Settings tab.
//   SETUP_CODE  — Script property. Replaces the old client-side master code
//                 for first-run admin setup / "Forgot PIN" resets, verified
//                 here via the VERIFY_CODE action instead of being shipped
//                 in public client JS.
//
// If a property is left unset, the corresponding check is skipped (so an
// existing deployment keeps working until the owner opts in) — but that
// means these protections are INACTIVE until configured. See README.

function sanitizeCell(value) {
  // Sheets evaluates any cell value starting with = + - @ as a formula.
  // Prefix with an apostrophe so it's always stored/rendered as plain text.
  if (typeof value !== 'string') return value;
  return /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
}

function hasValidApiKey(data) {
  const required = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!required) return true; // not configured yet — open, see note above
  return data && data.apiKey === required;
}

// ── Entry Points ─────────────────────────────────────────────────────────────

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';

  if (action === 'ping') {
    return respond({ status: 'ok', version: '1.0' });
  }

  if (action === 'getStaff') {
    // Still returns pinHash — required for the offline-first "new device
    // auto-syncs PINs" flow. This is a deliberate, documented trade-off;
    // see README's security notes.
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = getOrCreateSheet(ss, SHEET_NAME_STAFF, getStaffHeaders());
      ensureHeaders(sheet, getStaffHeaders());
      const staff = sheetToObjects(sheet);
      return respond({ staff });
    } catch (err) {
      return respond({ error: err.message }, 500);
    }
  }

  // Default: return business data only — NOT staff/pinHash. The client's
  // fetchFromSheets() never reads a .staff field from this response; staff
  // sync goes exclusively through the dedicated getStaff action above.
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const result = {
      sales:     sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_SALES,     getSalesHeaders())),
      inventory: sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_INVENTORY, getInventoryHeaders())),
      customers: sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_CUSTOMERS, getCustomerHeaders())),
      summary:   sheetToObjects(getOrCreateSheet(ss, SHEET_NAME_SUMMARY,   getSummaryHeaders())),
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

    if (action === 'VERIFY_CODE') {
      const required = PropertiesService.getScriptProperties().getProperty('SETUP_CODE');
      const valid = !!required && body.code === required;
      return respond({ valid });
    }

    // Per-person email one-time codes for PIN setup/reset — no API key needed,
    // these ARE the auth mechanism for that specific staff member's account.
    if (action === 'REQUEST_LOGIN_CODE') {
      requestLoginCode(ss, data);
      return respond({ status: 'ok' }); // always ok — don't reveal whether the id/email matched
    }
    if (action === 'VERIFY_LOGIN_CODE') {
      return respond({ valid: verifyLoginCode(data) });
    }

    if (!hasValidApiKey(body)) {
      return respond({ error: 'unauthorized' }, 401);
    }

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

// Reads the sheet's ACTUAL current header row (not the JS constant) and
// appends any expected column that's missing, so a sheet created before a
// field was added gets extended rather than silently misaligned. Never
// reorders or removes existing columns — new fields always land at the end.
// Returns the reconciled header list; every read/write should use THIS,
// never the raw get*Headers() list, so both always agree on column order.
function ensureHeaders(sheet, expectedHeaders) {
  const lastCol = sheet.getLastColumn();
  const current = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim()).filter(h => h !== '')
    : [];
  const missing = expectedHeaders.filter(h => current.indexOf(h) === -1);
  if (missing.length === 0) return current;

  const merged = current.concat(missing);
  sheet.getRange(1, 1, 1, merged.length).setValues([merged]);
  sheet.getRange(1, 1, 1, merged.length).setFontWeight('bold');
  return merged;
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
  return ['id','name','email','role','pinHash','pinSalt','active','failedAttempts','lockedUntil'];
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
  const headers = ensureHeaders(sheet, getSalesHeaders());
  const rowNum = findRowByColumn(sheet, headers.indexOf('id'), data.id);
  if (rowNum < 0) return;
  headers.forEach((h, i) => {
    if (data[h] !== undefined) sheet.getRange(rowNum, i + 1).setValue(sanitizeCell(data[h]));
  });
}

function appendSale(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_SALES, getSalesHeaders());
  const headers = ensureHeaders(sheet, getSalesHeaders());
  const row = headers.map(h => sanitizeCell(data[h] !== undefined ? data[h] : ''));
  sheet.appendRow(row);
}

// ── Inventory ─────────────────────────────────────────────────────────────────

function upsertInventory(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_INVENTORY, getInventoryHeaders());
  const headers = ensureHeaders(sheet, getInventoryHeaders());

  // Find by id first, then by name
  let rowNum = findRowByColumn(sheet, headers.indexOf('id'), data.id);
  if (rowNum < 0) rowNum = findRowByColumn(sheet, headers.indexOf('name'), data.name);

  const row = headers.map(h => sanitizeCell(data[h] !== undefined ? data[h] : ''));
  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function processRestock(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_INVENTORY, getInventoryHeaders());
  const headers = ensureHeaders(sheet, getInventoryHeaders());

  let rowNum = findRowByColumn(sheet, headers.indexOf('id'), data.productId);
  if (rowNum < 0) rowNum = findRowByColumn(sheet, headers.indexOf('name'), data.productName);
  if (rowNum < 0) return;

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
  const headers = ensureHeaders(sheet, getStaffHeaders());
  const rowNum = findRowByColumn(sheet, headers.indexOf('id'), data.id);
  const row = headers.map(h => sanitizeCell(data[h] !== undefined ? data[h] : ''));
  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

// ── Email login codes (PIN setup/reset) ────────────────────────────────────────
// A 6-digit code, cached server-side (never exposed to any client) against the
// staff id for 10 minutes, single use. Ties "set/reset my PIN" to proof of
// access to that specific person's own inbox instead of a shared master code.

function requestLoginCode(ss, data) {
  const staffId = data && data.staffId;
  if (!staffId) return;
  const sheet = getOrCreateSheet(ss, SHEET_NAME_STAFF, getStaffHeaders());
  ensureHeaders(sheet, getStaffHeaders()); // self-heal a stale header row before reading
  const staff = sheetToObjects(sheet);
  const member = staff.filter(function (s) { return String(s.id) === String(staffId); })[0];
  if (!member || !member.email) return; // silently no-op — caller always gets a generic "ok"

  const code = String(Math.floor(100000 + Math.random() * 900000));
  CacheService.getScriptCache().put('LOGIN_CODE_' + staffId, code, 600); // 10 minutes

  MailApp.sendEmail({
    to: member.email,
    subject: 'Your Smoke Signals POS code',
    body: 'Your verification code is ' + code + '.\n\n' +
          'It expires in 10 minutes and can only be used once. ' +
          'If you did not request this, you can ignore this email.',
  });
}

function verifyLoginCode(data) {
  const staffId = data && data.staffId;
  const code = data && data.code;
  if (!staffId || !code) return false;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('LOGIN_CODE_' + staffId);
  const valid = !!cached && cached === String(code);
  if (valid) cache.remove('LOGIN_CODE_' + staffId); // single use
  return valid;
}

// ── Customers ─────────────────────────────────────────────────────────────────

function upsertCustomer(ss, data) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_CUSTOMERS, getCustomerHeaders());
  const headers = ensureHeaders(sheet, getCustomerHeaders());
  const rowNum = findRowByColumn(sheet, headers.indexOf('phone'), data.phone);
  const row = headers.map(h => sanitizeCell(data[h] !== undefined ? data[h] : ''));

  if (rowNum > 0) {
    sheet.getRange(rowNum, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
}

function deleteCustomerRow(ss, phone) {
  const sheet = getOrCreateSheet(ss, SHEET_NAME_CUSTOMERS, getCustomerHeaders());
  const headers = ensureHeaders(sheet, getCustomerHeaders());
  const rowNum = findRowByColumn(sheet, headers.indexOf('phone'), phone);
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
