// ============================================================================
// Smoke Signals Network — Membership Apps Script
// Create a NEW separate Google Spreadsheet for this (don't use the Smoke420 one)
// Paste into Extensions → Apps Script → Deploy as Web App (Anyone can access)
//
// Two sheets are managed here:
//   "Waitlist" — every membership application as it comes in from the site
//   "Members"  — active/lapsed/cancelled members, created once an application
//                is approved (set the Waitlist row's Status to APPROVED)
//
// Membership fees are collected manually (bank transfer / cash) — there's no
// payment gateway wired up. Admins update a member's Status, Last Payment At
// and Next Billing At columns by hand in the Members sheet.
// ============================================================================

// ── Web app entry points ───────────────────────────────────────────────────

function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action;
    const data   = body.data;

    if (action === 'WAITLIST') {
      appendWaitlistEntry(data);
      return respond({ status: 'ok' });
    }

    return respond({ status: 'unknown_action' });
  } catch (err) {
    return respond({ error: err.message });
  }
}

function doGet(e) {
  const p = (e && e.parameter) || {};

  if (p.action === 'ping') {
    return respond({ status: 'ok' });
  }

  // The site's application form submits here as a GET (see index.html).
  if (p.fname && p.whatsapp) {
    appendWaitlistEntry({
      submittedAt: p.submittedAt,
      fname:       p.fname,
      lname:       p.lname,
      whatsapp:    p.whatsapp,
      area:        p.area,
      source:      p.source,
      notes:       p.notes,
      age:         p.age,
    });
    return respond({ status: 'ok' });
  }

  return respond({ status: 'ok', message: 'Waitlist endpoint active' });
}

// ── Waitlist ────────────────────────────────────────────────────────────────

function appendWaitlistEntry(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Waitlist');

  if (!sheet) {
    sheet = ss.insertSheet('Waitlist');
    const headers = [
      'Submitted At', 'First Name', 'Surname', 'WhatsApp',
      'Area', 'Age Confirmed', 'How They Heard', 'Notes', 'Status'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);

    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(4, 130);
    sheet.setColumnWidth(7, 180);
    sheet.setColumnWidth(8, 250);
    sheet.setColumnWidth(9, 100);
  }

  const row = [
    data.submittedAt ? new Date(data.submittedAt).toLocaleString('en-ZA') : new Date().toLocaleString('en-ZA'),
    data.fname    || '',
    data.lname    || '',
    data.whatsapp || '',
    data.area     || '',
    data.age === 'yes' ? 'Yes' : '',
    data.source   || '',
    data.notes    || '',
    'PENDING',  // Status column — manually update to APPROVED / REJECTED / WAITLIST
  ];

  sheet.appendRow(row);

  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 9).setBackground('#fff2cc'); // Yellow for PENDING
}

// ── Members ─────────────────────────────────────────────────────────────────
// Fires when a human editor sets a Waitlist row's Status to APPROVED.
// Creates the corresponding Members row; the admin then collects the first
// payment manually and updates the row's Status/Last Payment At/Next Billing At.

function onEdit(e) {
  const sheet = e.range.getSheet();
  if (sheet.getName() !== 'Waitlist') return;
  if (e.range.getColumn() !== 9) return; // Status column
  if (e.value !== 'APPROVED') return;

  const row = e.range.getRow();
  const values = sheet.getRange(row, 1, 1, 9).getValues()[0];
  const [submittedAt, fname, lname, whatsapp, area] = values;

  addMember({ fname, lname, whatsapp, area });
}

function addMember(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Members');

  if (!sheet) {
    sheet = ss.insertSheet('Members');
    const headers = [
      'Member ID', 'First Name', 'Surname', 'WhatsApp', 'Area',
      'Status', 'Joined At', 'Last Payment At', 'Next Billing At'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const memberId = 'M' + Utilities.formatDate(new Date(), 'GMT+2', 'yyMMdd') + '-' + Math.floor(Math.random() * 900 + 100);

  sheet.appendRow([
    memberId, data.fname || '', data.lname || '', data.whatsapp || '', data.area || '',
    'PENDING_PAYMENT', new Date().toLocaleString('en-ZA'), '', ''
  ]);
}

function respond(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
