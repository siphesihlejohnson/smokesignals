// ============================================================================
// The Network — Waitlist Apps Script
// Create a NEW separate Google Spreadsheet for this (don't use the Smoke420 one)
// Paste into Extensions → Apps Script → Deploy as Web App (Anyone can access)
// ============================================================================

function doPost(e) {
  try {
    const body    = JSON.parse(e.postData.contents);
    const action  = body.action;
    const data    = body.data;

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
  if (e && e.parameter && e.parameter.action === 'ping') {
    return respond({ status: 'ok' });
  }
  return respond({ status: 'ok', message: 'Waitlist endpoint active' });
}

function appendWaitlistEntry(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('Waitlist');

  if (!sheet) {
    sheet = ss.insertSheet('Waitlist');
    const headers = [
      'Submitted At', 'First Name', 'Surname', 'WhatsApp',
      'Area', 'Monthly Volume', 'How They Heard', 'Notes', 'Status'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);

    // Format columns
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
    data.volume   || '',
    data.source   || '',
    data.notes    || '',
    'PENDING',  // Status column — manually update to APPROVED / REJECTED / WAITLIST
  ];

  sheet.appendRow(row);

  // Optional: colour code the new row
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 9).setBackground('#fff2cc'); // Yellow for PENDING
}

function respond(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
