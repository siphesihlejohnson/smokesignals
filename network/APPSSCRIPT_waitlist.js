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
// PayFast recurring-billing wiring below is a SCAFFOLD. It will not work
// until PAYFAST_MERCHANT_ID / PAYFAST_MERCHANT_KEY / PAYFAST_PASSPHRASE are
// filled in with real values from an actual PayFast merchant account, and
// the ITN URL is registered in that account. Test against PayFast's sandbox
// before pointing it at real payments.
// ============================================================================

const PAYFAST_MERCHANT_ID   = 'TODO_MERCHANT_ID';
const PAYFAST_MERCHANT_KEY  = 'TODO_MERCHANT_KEY';
const PAYFAST_PASSPHRASE    = 'TODO_PASSPHRASE';
const PAYFAST_SANDBOX       = true; // flip to false only once tested against a real account
const PAYFAST_HOST          = PAYFAST_SANDBOX ? 'https://sandbox.payfast.co.za/eng/process' : 'https://www.payfast.co.za/eng/process';
const MEMBERSHIP_AMOUNT     = '50.00'; // R50/month

// ── Web app entry points ───────────────────────────────────────────────────

function doPost(e) {
  try {
    // PayFast ITN posts as application/x-www-form-urlencoded, not JSON —
    // it lands in e.parameter same as a GET, so route on that shape first.
    if (e.parameter && e.parameter.m_payment_id) {
      return handlePayfastItn(e.parameter);
    }

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

  // The site's application form submits here as a GET (see network/index.html).
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
// Creates the corresponding Members row and a PayFast subscription link to
// send the new member so they can start their R50/month membership.

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
      'Status', 'Joined At', 'Last Payment At', 'Next Billing At', 'PayFast Token'
    ];
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  const memberId = 'M' + Utilities.formatDate(new Date(), 'GMT+2', 'yyMMdd') + '-' + Math.floor(Math.random() * 900 + 100);

  sheet.appendRow([
    memberId, data.fname || '', data.lname || '', data.whatsapp || '', data.area || '',
    'PENDING_PAYMENT', new Date().toLocaleString('en-ZA'), '', '', ''
  ]);

  // Once real PayFast credentials are in place, this link can be sent to the
  // new member (e.g. via WhatsApp) to start their recurring R50/month membership.
  Logger.log('Payment link for ' + memberId + ': ' + buildPayfastSubscriptionLink(memberId, data));
}

function buildPayfastSubscriptionLink(memberId, data) {
  const params = {
    merchant_id: PAYFAST_MERCHANT_ID,
    merchant_key: PAYFAST_MERCHANT_KEY,
    m_payment_id: memberId,
    amount: MEMBERSHIP_AMOUNT,
    item_name: 'Smoke Signals Network Membership',
    subscription_type: '1',
    recurring_amount: MEMBERSHIP_AMOUNT,
    frequency: '3',   // monthly, per PayFast's frequency codes
    cycles: '0',      // 0 = indefinite, cancel any time
    name_first: data.fname || '',
    name_last: data.lname || '',
  };
  const query = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
  return PAYFAST_HOST + '?' + query;
}

// ── PayFast ITN (payment notification webhook) ──────────────────────────────
// Register this Apps Script's /exec URL as the notify_url in the PayFast
// merchant dashboard once an account exists. Validates the signature per
// PayFast's documented ITN process before trusting the payload.

function handlePayfastItn(params) {
  if (!verifyPayfastSignature(params)) {
    return respond({ status: 'invalid_signature' });
  }

  const memberId = params.m_payment_id;
  const status   = params.payment_status; // COMPLETE, FAILED, etc.
  updateMemberStatus(memberId, status, params.pf_payment_id);

  return respond({ status: 'ok' });
}

function verifyPayfastSignature(params) {
  const received = params.signature;
  const ordered = Object.keys(params)
    .filter(k => k !== 'signature')
    .sort()
    .map(k => k + '=' + encodeURIComponent(params[k]).replace(/%20/g, '+'))
    .join('&');
  const toHash = PAYFAST_PASSPHRASE ? ordered + '&passphrase=' + encodeURIComponent(PAYFAST_PASSPHRASE) : ordered;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, toHash);
  const computed = digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  return computed === received;
}

function updateMemberStatus(memberId, paymentStatus, pfPaymentId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Members');
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === memberId) {
      const row = i + 1;
      const newStatus = paymentStatus === 'COMPLETE' ? 'ACTIVE' : 'PAYMENT_FAILED';
      sheet.getRange(row, 6).setValue(newStatus);
      sheet.getRange(row, 8).setValue(new Date().toLocaleString('en-ZA'));
      if (newStatus === 'ACTIVE') {
        const next = new Date();
        next.setMonth(next.getMonth() + 1);
        sheet.getRange(row, 9).setValue(next.toLocaleString('en-ZA'));
      }
      sheet.getRange(row, 10).setValue(pfPaymentId || '');
      break;
    }
  }
}

function respond(data) {
  const output = ContentService.createTextOutput(JSON.stringify(data));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}
