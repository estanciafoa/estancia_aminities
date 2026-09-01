/**
 * Estancia Amenities — RAZORPAY PAYMENTS web app.
 *
 * A resident-facing, self-serve payment flow. A resident opens this web app's
 * /exec URL on their OWN phone (post the URL / a QR at each gate), enters their
 * flat + name, picks an amenity + month, sees the monthly amount (read from a
 * "Rates" tab), and taps Pay. We create a Razorpay PAYMENT LINK server-side
 * (the key secret never leaves this script) and hand the resident its short_url.
 *
 * When Razorpay confirms the payment we write a "paid" row into the matching
 * amenity tab of the SUBSCRIPTION sheet (id 1OhbhJPxep0s5eQKmakgmSjJBIMDEzSN3iRXuGMaOCng)
 * in the SAME column layout the kiosk app already reads
 * (S.No. | APT NO. | NAME OF CLIENT | AMENITY USER | Month | Amount | Payment
 * Description). Gating then "just works" on the kiosk after its next sync.
 *
 * TWO confirmation paths, both authoritative (we re-fetch the link from
 * Razorpay's authenticated API before writing — never trust the client):
 *   1. callback_url  → doGet(action=confirm): the payer's browser is redirected
 *      back here after paying, with a signature we verify (query params ARE
 *      readable in doGet). Gives the resident a nice "Payment received" page.
 *   2. webhook       → doPost(action=webhook OR a Razorpay event body): a
 *      server-to-server backstop in case the resident closes the browser before
 *      the redirect. NOTE: Apps Script doPost CANNOT read request headers, so we
 *      cannot verify the X-Razorpay-Signature header — instead we guard the URL
 *      with WEBHOOK_TOKEN and re-fetch the payment link from Razorpay to confirm
 *      it is genuinely paid. Configure the webhook URL as
 *      …/exec?action=webhook&token=<WEBHOOK_TOKEN>.
 * Writes are IDEMPOTENT: we skip if a row for this payment id already exists, so
 * the callback and the webhook racing each other never double-credit.
 *
 * ⚠️ DEPLOY THIS IN ITS OWN Apps Script project — NEVER in the same project as
 * subscription-writer.gs. Both files define doGet/doPost; put together, one set
 * of handlers shadows the other and each /exec URL silently starts serving the
 * wrong app. Two web apps = two projects = two /exec URLs.
 *
 * Deploy:
 *   1. A NEW, standalone Apps Script project (NOT the subscription-writer one).
 *   2. Paste this WHOLE file as Code.gs.
 *   3. Add the Razorpay keys in Project Settings ▸ Script Properties
 *      (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET). Prices are hardcoded in PACKAGES_.
 *   4. Deploy ▸ New deployment ▸ Web app. Execute as = Me, Who has access = Anyone.
 *   5. Copy the /exec URL. Post it (or a QR of it) at each gate for residents.
 *   6. In the Razorpay Dashboard ▸ Settings ▸ Webhooks, add
 *        <exec-url>?action=webhook&token=<WEBHOOK_TOKEN>
 *      subscribed to the `payment_link.paid` event (optional but recommended).
 *   To update later: Deploy ▸ Manage deployments ▸ edit ▸ Version: New version.
 */

/* ────────────────────────── CONFIG — EDIT THESE ────────────────────────── */

// Razorpay API keys are read from SCRIPT PROPERTIES (not hardcoded, so this file
// carries no secret). In the Apps Script editor:
//   Project Settings ▸ Script Properties ▸ Add property
//     RAZORPAY_KEY_ID      = rzp_live_XXXXXXXXXXXX
//     RAZORPAY_KEY_SECRET  = <your key secret>
function rzpKeyId_() { return PropertiesService.getScriptProperties().getProperty('RAZORPAY_KEY_ID') || ''; }
function rzpSecret_() { return PropertiesService.getScriptProperties().getProperty('RAZORPAY_KEY_SECRET') || ''; }
function rzpAuth_() {
  var id = rzpKeyId_(), sec = rzpSecret_();
  if (!id || !sec) throw new Error('Razorpay keys not set — add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in Project Settings ▸ Script Properties.');
  return 'Basic ' + Utilities.base64Encode(id + ':' + sec);
}

// Guards the webhook URL (invent any long random string; put it in the webhook
// URL you register in the Razorpay Dashboard). Not used by the resident page.
var WEBHOOK_TOKEN = 'set-a-long-random-string';

// Guards the kiosk QR endpoints (create_qr / qr_status). The kiosk app sends
// this — keep it in sync with PAY_TOKEN in src/services/payments.ts.
var PAY_TOKEN = 'Admin2026';

// The subscription spreadsheet the kiosk reads (same id as subscription-writer).
var SUB_SS_ID = '1OhbhJPxep0s5eQKmakgmSjJBIMDEzSN3iRXuGMaOCng';

// gid of each amenity tab (must match sheets.ts AMENITY_TABS) + the new Rates tab.
var AMENITY_GIDS = {
  gym: 2051574635,
  swimming: 1433427596,
  tennis: 2028550937,
  combo: 1913121077
};

// Hardcoded monthly price list (rupees), per category. `covers` = the amenities
// the package grants. Edit here to change prices — no sheet needed. A package
// covering 2+ amenities is written to the COMBO tab (description names them); a
// single-amenity package goes to its own tab.
var PACKAGES_ = [
  { category: 'student', label: 'Gym',                     amount: 1500, covers: ['gym'] },
  { category: 'student', label: 'Swimming',                amount: 1000, covers: ['swimming'] },
  { category: 'student', label: 'Tennis',                  amount: 1000, covers: ['tennis'] },
  { category: 'student', label: 'Gym + Swimming',          amount: 2000, covers: ['gym', 'swimming'] },
  { category: 'student', label: 'Gym + Tennis',            amount: 2000, covers: ['gym', 'tennis'] },
  { category: 'student', label: 'Swimming + Tennis',       amount: 1500, covers: ['swimming', 'tennis'] },
  { category: 'student', label: 'Gym + Swimming + Tennis', amount: 2500, covers: ['gym', 'swimming', 'tennis'] },
  { category: 'family',  label: 'Gym',                     amount: 750,  covers: ['gym'] },
  { category: 'family',  label: 'Swimming',                amount: 500,  covers: ['swimming'] },
  { category: 'family',  label: 'Tennis',                  amount: 500,  covers: ['tennis'] },
  { category: 'family',  label: 'Gym + Swimming',          amount: 1000, covers: ['gym', 'swimming'] },
  { category: 'family',  label: 'Gym + Tennis',            amount: 1000, covers: ['gym', 'tennis'] },
  { category: 'family',  label: 'Swimming + Tennis',       amount: 750,  covers: ['swimming', 'tennis'] },
  { category: 'family',  label: 'Gym + Swimming + Tennis', amount: 1300, covers: ['gym', 'swimming', 'tennis'] }
];

var CURRENCY = 'INR';

/* ─────────────────────────── ENTRY POINTS ─────────────────────────── */

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'confirm') return renderConfirm_(p);
    if (p.action === 'packages') return json_(true, { packages: getPackages_() }, null);
    if (p.action === 'qr_status') return qrStatus_(p);
    if (p.action === 'day_txns') return dayTxns_(p);
    // Default: serve the resident-facing self-serve payment page.
    return renderPage_();
  } catch (err) {
    if ((p.action || '') === 'qr_status' || (p.action || '') === 'day_txns') return json_(false, null, String(err && err.message || err));
    return htmlMessage_('Something went wrong', String(err && err.message || err), false);
  }
}

function doPost(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'webhook') return handleWebhook_(p, e);
    var payload = {};
    try { payload = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (ignore) {}
    if (payload.action === 'create_qr') return createQr_(payload);
    return json_(false, null, 'Unknown action');
  } catch (err) {
    return json_(false, null, String(err && err.message || err));
  }
}

/* ───────────────── SERVER FNS CALLED FROM THE PAGE (google.script.run) ─── */

/** Return { packages, months, execUrl } to bootstrap the page. */
function getPageData() {
  return { packages: getPackages_(), months: monthOptions_(), execUrl: execUrl_() };
}

/**
 * Create a Razorpay payment link for one subscription payment.
 * @param {Object} req { pkg, month, flat, name, mobile }  (pkg = package key)
 * @return {Object} { ok, short_url } or throws.
 */
function createPaymentLink(req) {
  req = req || {};
  var pkgKey = String(req.pkg || '').trim().toLowerCase();
  var month = String(req.month || '').trim();          // e.g. "Jul 2026"
  var flat = String(req.flat || '').trim();
  var name = String(req.name || '').trim();
  var mobile = String(req.mobile || '').trim();

  if (!month) throw new Error('Pick a month.');
  if (!flat) throw new Error('Enter your flat number.');
  if (!name) throw new Error('Enter your name.');

  var pkg = null;
  var pkgs = getPackages_();
  for (var i = 0; i < pkgs.length; i++) if (pkgs[i].key === pkgKey) pkg = pkgs[i];
  if (!pkg) throw new Error('Pick a package.');
  if (!(pkg.amount > 0)) throw new Error('No price set for ' + pkg.label + '. Ask the admin to update the Rates tab.');

  var payload = {
    amount: Math.round(pkg.amount * 100),              // paise
    currency: CURRENCY,
    accept_partial: false,
    description: pkg.label + ' subscription — ' + month + ' — Flat ' + flat,
    reference_id: reference_(pkg.key, flat, name, month),
    // covers rides along so the confirmation writes exactly the amenities paid for.
    notes: { covers: pkg.covers.join(','), pkg: pkg.label, month: month, flat: flat, name: name },
    notify: { sms: false, email: false },
    reminder_enable: false,
    callback_url: execUrl_() + '?action=confirm',
    callback_method: 'get'
  };
  if (mobile) payload.customer = { name: name, contact: mobile };

  var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: rzpAuth_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var body = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300 || !body.short_url) {
    throw new Error((body.error && body.error.description) || 'Razorpay error (' + res.getResponseCode() + ')');
  }
  return { ok: true, short_url: body.short_url };
}

/* ───────────────────────── CONFIRMATION PATHS ───────────────────────── */

/** Browser callback after payment. Verify signature, then credit the sheet. */
function renderConfirm_(p) {
  var linkId = p.razorpay_payment_link_id || '';
  var refId = p.razorpay_payment_link_reference_id || '';
  var status = p.razorpay_payment_link_status || '';
  var payId = p.razorpay_payment_id || '';
  var sig = p.razorpay_signature || '';

  if (status !== 'paid') {
    return htmlMessage_('Payment not completed', 'Status: ' + (status || 'unknown') + '. If you were charged, it will still be credited shortly.', false);
  }
  // Razorpay payment-link callback signature:
  //   HMAC_SHA256(link_id | reference_id | status | payment_id, key_secret)
  var expected = hmacHex_([linkId, refId, status, payId].join('|'), rzpSecret_());
  if (!sig || sig !== expected) {
    return htmlMessage_('Could not verify payment', 'The confirmation signature did not match. If money was deducted, it will still be credited via the payment gateway shortly.', false);
  }

  var result = creditFromLink_(linkId, payId);
  if (result.credited || result.already) {
    var what = (result.covers && result.covers.length ? result.covers.map(titleCase_).join(' & ') : titleCase_(result.tab || ''));
    return htmlMessage_('✓ Payment received', 'Thank you! Your ' + what +
      ' subscription for ' + (result.month || 'this month') + ' (Flat ' + (result.flat || '') +
      ') is recorded. You may now use the amenity — the gate will show you as paid after its next sync.', true);
  }
  return htmlMessage_('Payment received', 'We recorded your payment. If the gate still shows unpaid after a few minutes, please contact the admin.', true);
}

/** Server-to-server backstop. Guarded by WEBHOOK_TOKEN; re-fetches from API. */
function handleWebhook_(p, e) {
  if (p.token !== WEBHOOK_TOKEN) return json_(false, null, 'Bad token');
  var event = {};
  try { event = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (ignore) {}

  // Dig out the payment link id from a payment_link.* event payload.
  var entity = event.payload && event.payload.payment_link && event.payload.payment_link.entity;
  var linkId = (entity && entity.id) || '';
  var payEntity = event.payload && event.payload.payment && event.payload.payment.entity;
  var payId = (payEntity && payEntity.id) || '';
  if (!linkId) return json_(true, { skipped: 'no payment_link id' }, null);

  var result = creditFromLink_(linkId, payId);
  return json_(true, result, null);
}

/**
 * Authoritative credit: fetch the payment link from Razorpay, confirm it is
 * paid, then write a "paid" row (idempotent on the payment/link id).
 */
function creditFromLink_(linkId, payId) {
  var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/payment_links/' + encodeURIComponent(linkId), {
    method: 'get',
    headers: { Authorization: rzpAuth_() },
    muteHttpExceptions: true
  });
  var link = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300 || !link.id) throw new Error('Could not fetch payment link ' + linkId);
  if (link.status !== 'paid') return { credited: false, reason: 'link status is ' + link.status };

  var notes = link.notes || {};
  var covers = String(notes.covers || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
  if (!covers.length) covers = ['gym', 'swimming']; // safety fallback (legacy combo)
  var month = String(notes.month || '');
  var flat = String(notes.flat || '');
  var name = String(notes.name || '');
  var amountRupees = (link.amount_paid || link.amount || 0) / 100;

  // A single amenity → its own tab; two or more → the combo tab (the description
  // names them so the app grants exactly those amenities).
  var tab = covers.length > 1 ? 'combo' : covers[0];
  if (!AMENITY_GIDS.hasOwnProperty(tab)) throw new Error('Unknown amenity in link notes: ' + covers.join(','));

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (rowExistsFor_(tab, flat, month, covers)) {
      return { credited: false, already: true, tab: tab, covers: covers, month: month, flat: flat };
    }
    insertPaidRow_(tab, covers, flat, name, month, amountRupees);
    return { credited: true, tab: tab, covers: covers, month: month, flat: flat };
  } finally {
    lock.releaseLock();
  }
}

/* ─────────────────────────── SHEET I/O ─────────────────────────── */

var SUB_HEADERS = ['S.No.', 'APT NO.', 'NAME OF CLIENT', 'AMENITY USER', 'Month', 'Amount', 'Payment Description'];

/** Append a paid row in the bank-statement description style, e.g.
 *  "Jul26 - Combo pack of Gym, Swimming & Tennis for Flat No. 1137 : Saravanan .S"
 *  (single amenity → "Jul26 - Gym Fee for Flat No. 1137 : Name"). The month is
 *  parseable by monthFromText and the amenities by amenitiesFromText. */
function insertPaidRow_(tab, covers, flat, name, month, amountRupees) {
  var sheet = sheetByGid_(SpreadsheetApp.openById(SUB_SS_ID), AMENITY_GIDS[tab]);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, SUB_HEADERS.length).setValues([SUB_HEADERS]);
  var desc = shortMonth_(month) + ' - ' + coverPhrase_(covers) + ' for Flat No. ' + flat + ' : ' + name;
  sheet.appendRow(['', flat, name, name, month, amountRupees, desc]);
}

/** Idempotency: does a row already exist for this flat + month + amenity set in
 *  the tab? (The description no longer carries a payment ref, so we match on the
 *  subscription identity — this also blocks accidental double-credit.) */
function rowExistsFor_(tab, flat, month, covers) {
  var sheet = sheetByGid_(SpreadsheetApp.openById(SUB_SS_ID), AMENITY_GIDS[tab]);
  var last = sheet.getLastRow();
  if (last < 2) return false;
  var fkey = String(flat).trim().toLowerCase();
  var wantMonth = monthFromText_(month);
  var wantCovers = setKey_(covers).join('+');
  var vals = sheet.getRange(2, 1, last - 1, 7).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][1]).trim().toLowerCase() !== fkey) continue; // col B = APT NO.
    var rDesc = String(vals[i][6]);                                 // col G = Payment Description
    var rMonth = monthFromText_(rDesc) || monthFromText_(String(vals[i][4]));
    if (rMonth !== wantMonth) continue;
    if (setKey_(amenitiesInText_(rDesc)).join('+') === wantCovers) return true;
  }
  return false;
}

/** Which amenities a free-text string names (gym/swimming/tennis). */
function amenitiesInText_(t) {
  var d = String(t || '').toLowerCase();
  var out = [];
  if (/gym/.test(d)) out.push('gym');
  if (/swim/.test(d)) out.push('swimming');
  if (/tennis/.test(d)) out.push('tennis');
  return out;
}

// ── Month parsing (kept identical to sheets.ts / admin.html so keys match) ──
var MONTHS_ = { jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec' };

function normMonth_(word, yr) {
  var mon = MONTHS_[String(word).slice(0, 3).toLowerCase()];
  if (!mon) return '';
  var y = String(yr).trim();
  if (y.length === 2) y = '20' + y;
  return mon + ' ' + y;
}

function monthFromText_(text) {
  var d = String(text || '');
  var m = d.match(/until\s+the\s+period\s+of\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (m) return normMonth_(m[1], m[2]);
  m = d.match(/^\s*([A-Za-z]{3,9})\s*'?\s*(\d{2,4})\b/);
  if (m && MONTHS_[m[1].slice(0, 3).toLowerCase()]) return normMonth_(m[1], m[2]);
  m = d.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*'?\s*(\d{2,4})\b/i);
  if (m) return normMonth_(m[1], m[2]);
  return '';
}

/** "Jul 2026" → "Jul26" (bank-statement short form). */
function shortMonth_(month) {
  var m = monthFromText_(month);
  if (!m) return String(month || '');
  var parts = m.split(' ');
  return parts[0] + parts[1].slice(-2);
}

/** Amenity phrase like the bank statements: "Gym Fee" or "Combo pack of Gym, Swimming & Tennis". */
function coverPhrase_(covers) {
  var names = setKey_(covers).map(titleCase_);
  if (names.length <= 1) return (names[0] || 'Amenity') + ' Fee';
  var last = names.pop();
  return 'Combo pack of ' + names.join(', ') + ' & ' + last;
}

/** The hardcoded price list as [{ category, key, label, amount, covers:[...] }]. */
function getPackages_() {
  return PACKAGES_.map(function (p) {
    return { category: p.category, key: p.label.toLowerCase(), label: p.label, amount: p.amount, covers: p.covers };
  });
}

/* ─────────────────── KIOSK QR PAYMENT (called by the app) ─────────────── */

function validatePayToken_(t) { if (!t || t !== PAY_TOKEN) throw new Error('Invalid token'); }

// Normalized amenity set (sorted, unique, lowercased) → a stable join key.
function setKey_(arr) {
  var seen = {}, out = [];
  (arr || []).forEach(function (s) {
    var v = String(s).trim().toLowerCase();
    if (v && !seen[v]) { seen[v] = 1; out.push(v); }
  });
  return out.sort();
}

// Find the Rates-tab package whose Category + Covers set exactly match.
function packageForSet_(amenities, category) {
  var want = setKey_(amenities).join('+');
  var cat = String(category || '').trim().toLowerCase();
  var pkgs = getPackages_();
  for (var i = 0; i < pkgs.length; i++) {
    if (pkgs[i].category === cat && setKey_(pkgs[i].covers).join('+') === want) return pkgs[i];
  }
  return null;
}

// POST create_qr {token, category, flat, name, amenities:[...], month} → a Razorpay
// PAYMENT LINK (the account's QR Codes API isn't enabled; the kiosk renders this
// link's URL as a QR the resident scans). Returns { qr_id: link_id, pay_url }.
function createQr_(payload) {
  validatePayToken_(payload.token);
  var amenities = payload.amenities || [];
  var category = String(payload.category || '').trim();
  var month = String(payload.month || '').trim();
  var flat = String(payload.flat || '').trim();
  var name = String(payload.name || '').trim();
  if (!amenities.length) throw new Error('Select at least one amenity.');
  if (!month || !flat || !name) throw new Error('Missing flat, name, or month.');

  var pkg = packageForSet_(amenities, category);
  if (!pkg) throw new Error('No price configured for this combination. Ask the admin to add it to the Rates tab.');
  var covers = setKey_(pkg.covers);

  var body = {
    amount: Math.round(pkg.amount * 100),
    currency: CURRENCY,
    accept_partial: false,
    description: (pkg.label + ' - ' + month + ' - Flat ' + flat).slice(0, 200),
    // reference_id must be unique per link (Razorpay rejects duplicates).
    reference_id: ('E' + flat + '-' + covers.map(function (c) { return c.charAt(0); }).join('') + '-' + (new Date().getTime())).slice(0, 40),
    notes: { covers: covers.join(','), month: month, flat: flat, name: name },
    notify: { sms: false, email: false },
    reminder_enable: false,
    callback_url: execUrl_() + '?action=confirm',
    callback_method: 'get'
  };
  var res = UrlFetchApp.fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: rzpAuth_() },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  var link = JSON.parse(res.getContentText() || '{}');
  if (res.getResponseCode() >= 300 || !link.id || !link.short_url) {
    throw new Error((link.error && link.error.description) || 'Razorpay error (' + res.getResponseCode() + ')');
  }
  return json_(true, { qr_id: link.id, pay_url: link.short_url, amount: pkg.amount, covers: covers }, null);
}

// GET qr_status {token, id} → { paid, ... }. Polls the payment link; on payment
// it writes the paid row (idempotent) so the kiosk can let the resident in.
function qrStatus_(p) {
  validatePayToken_(p.token);
  var id = String(p.id || '').trim();
  if (!id) throw new Error('Missing payment id');
  var r = creditFromLink_(id, '');
  if (r.credited || r.already) {
    return json_(true, { paid: true, covers: r.covers || [], month: r.month, flat: r.flat }, null);
  }
  return json_(true, { paid: false }, null);
}

// GET day_txns {token, date="YYYY-MM-DD"} → every Razorpay payment CAPTURED on
// that IST calendar day, for admin reconciliation ("today's collections"). Reads
// straight from Razorpay's Payments API — independent of the subscription sheet,
// so it reflects the actual money, not what the sheet-write happened to record.
// `date` defaults to today (IST). Pages through all results (100/page).
function dayTxns_(p) {
  validatePayToken_(p.token);
  var date = String(p.date || '').trim();
  if (!date) {
    var nowIST = new Date(new Date().getTime() + 19800000); // shift UTC→IST for the y/m/d
    date = nowIST.getUTCFullYear() + '-' +
      ('0' + (nowIST.getUTCMonth() + 1)).slice(-2) + '-' +
      ('0' + nowIST.getUTCDate()).slice(-2);
  }
  var m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('date must be YYYY-MM-DD');

  // IST day boundaries → UTC Unix seconds. IST = UTC+5:30 = 19800s.
  var startIST = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0) / 1000 - 19800;
  var endIST = startIST + 86400 - 1;

  var all = [], skip = 0;
  for (var guard = 0; guard < 100; guard++) { // ≤10k payments/day is plenty
    var url = 'https://api.razorpay.com/v1/payments?count=100&skip=' + skip +
      '&from=' + startIST + '&to=' + endIST;
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: rzpAuth_() },
      muteHttpExceptions: true
    });
    var body = JSON.parse(res.getContentText() || '{}');
    if (res.getResponseCode() >= 300) {
      throw new Error((body.error && body.error.description) || 'Razorpay error (' + res.getResponseCode() + ')');
    }
    var items = body.items || [];
    all = all.concat(items);
    if (items.length < 100) break;
    skip += 100;
  }

  var captured = all.filter(function (x) { return x.status === 'captured'; });
  captured.sort(function (a, b) { return (a.created_at || 0) - (b.created_at || 0); });
  var total = 0;
  var payments = captured.map(function (x) {
    var n = x.notes || {};
    total += x.amount || 0;
    return {
      id: x.id,
      amount: (x.amount || 0) / 100,
      method: x.method || '',
      flat: String(n.flat || ''),
      name: String(n.name || ''),
      covers: String(n.covers || ''),
      month: String(n.month || ''),
      created_at: x.created_at || 0 // Unix seconds (UTC)
    };
  });
  return json_(true, {
    date: date,
    count: payments.length,
    total_rupees: total / 100,
    payments: payments
  }, null);
}

function sheetByGid_(ss, gid) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === Number(gid)) return sheets[i];
  }
  throw new Error('Sheet with gid ' + gid + ' not found');
}

/* ─────────────────────────── HELPERS ─────────────────────────── */

function monthOptions_() {
  // Current month + next month, formatted like sheets.ts expects ("Jul 2026").
  var names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var now = new Date();
  var out = [];
  for (var k = 0; k < 2; k++) {
    var d = new Date(now.getFullYear(), now.getMonth() + k, 1);
    out.push(names[d.getMonth()] + ' ' + d.getFullYear());
  }
  return out;
}

function reference_(amenity, flat, name, month) {
  return [amenity, flat, name, month].join('|').replace(/\s+/g, '_').slice(0, 40);
}

function hmacHex_(message, key) {
  var raw = Utilities.computeHmacSha256Signature(message, key);
  var hex = '';
  for (var i = 0; i < raw.length; i++) {
    var b = (raw[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function titleCase_(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function execUrl_() { return ScriptApp.getService().getUrl(); }

function json_(ok, result, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, result: result || null, error: error || null }))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ─────────────────────────── HTML PAGES ─────────────────────────── */

function renderPage_() {
  return HtmlService.createHtmlOutput(PAGE_HTML)
    .setTitle('Estancia Amenities — Pay')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function htmlMessage_(title, body, ok) {
  var color = ok ? '#16a34a' : '#dc2626';
  var html =
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:-apple-system,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#111">' +
    '<div style="border-left:6px solid ' + color + ';background:#f8fafc;border-radius:10px;padding:20px">' +
    '<h2 style="margin:0 0 10px;color:' + color + '">' + escapeHtml_(title) + '</h2>' +
    '<p style="margin:0;line-height:1.5;font-size:16px">' + escapeHtml_(body) + '</p></div></div>';
  return HtmlService.createHtmlOutput(html)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// The resident-facing form. Uses google.script.run (no CORS) to load rates and
// create the link, then hands the resident a target=_top "Pay now" button (a
// user tap reliably breaks out of the Apps Script sandbox iframe to Razorpay).
var PAGE_HTML =
'<!doctype html>' +
'<style>' +
'  *{box-sizing:border-box} body{font-family:-apple-system,Roboto,Arial,sans-serif;margin:0;background:#f1f5f9;color:#0f172a}' +
'  .card{max-width:480px;margin:0 auto;padding:24px 18px}' +
'  h1{font-size:22px;margin:6px 0 2px} .sub{color:#64748b;font-size:14px;margin:0 0 18px}' +
'  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}' +
'  select,input{width:100%;padding:13px;font-size:16px;border:1px solid #cbd5e1;border-radius:10px;background:#fff}' +
'  .amt{font-size:15px;color:#0f172a;margin:16px 0 4px;font-weight:600}' +
'  button{width:100%;margin-top:20px;padding:15px;font-size:17px;font-weight:700;color:#fff;background:#2563eb;border:0;border-radius:12px}' +
'  button:disabled{background:#94a3b8}' +
'  a.pay{display:block;text-align:center;margin-top:20px;padding:15px;font-size:17px;font-weight:700;color:#fff;background:#16a34a;border-radius:12px;text-decoration:none}' +
'  .err{color:#dc2626;font-size:14px;margin-top:12px;min-height:18px}' +
'  .muted{color:#64748b;font-size:12px;margin-top:18px;line-height:1.4}' +
'</style>' +
'<div class="card">' +
'  <h1>Estancia Amenities</h1>' +
'  <p class="sub">Pay your monthly amenity subscription</p>' +
'  <label>Package</label><select id="pkg"></select>' +
'  <label>Month</label><select id="month"></select>' +
'  <label>Flat number</label><input id="flat" inputmode="numeric" placeholder="e.g. A-204">' +
'  <label>Your name</label><input id="name" placeholder="As known at the gate">' +
'  <label>Mobile (optional)</label><input id="mobile" inputmode="tel" placeholder="10-digit mobile">' +
'  <div class="amt" id="amt"></div>' +
'  <button id="pay" disabled>Loading…</button>' +
'  <div class="err" id="err"></div>' +
'  <div id="linkbox"></div>' +
'  <p class="muted">You will be taken to Razorpay\'s secure page to pay. After paying, your subscription is recorded automatically. The gate updates on its next sync.</p>' +
'</div>' +
'<script>' +
'  var PKGS={};' +
'  function $(id){return document.getElementById(id);}' +
'  function fmt(a){return "\\u20B9"+a;}' +
'  function refreshAmt(){var p=PKGS[$("pkg").value];var btn=$("pay");if(p){$("amt").textContent="Amount: "+fmt(p.amount);btn.disabled=false;btn.textContent="Pay "+fmt(p.amount);}else{$("amt").textContent="";btn.disabled=true;btn.textContent="Unavailable";}}' +
'  google.script.run.withSuccessHandler(function(d){' +
'    var sel=$("pkg");(d.packages||[]).forEach(function(p){PKGS[p.key]=p;var o=document.createElement("option");o.value=p.key;o.textContent=p.label+" ("+fmt(p.amount)+")";sel.appendChild(o);});' +
'    if(!(d.packages||[]).length){$("err").textContent="No packages configured yet — ask the admin to fill the Rates tab.";}' +
'    var mo=$("month");(d.months||[]).forEach(function(m){var o=document.createElement("option");o.value=m;o.textContent=m;mo.appendChild(o);});' +
'    refreshAmt();' +
'  }).withFailureHandler(function(e){$("err").textContent=String(e&&e.message||e);}).getPageData();' +
'  document.addEventListener("change",function(ev){if(ev.target.id==="pkg")refreshAmt();});' +
'  $("pay").addEventListener("click",function(){' +
'    $("err").textContent="";var btn=$("pay");btn.disabled=true;btn.textContent="Creating link…";' +
'    var req={pkg:$("pkg").value,month:$("month").value,flat:$("flat").value,name:$("name").value,mobile:$("mobile").value};' +
'    google.script.run.withSuccessHandler(function(r){' +
'      $("linkbox").innerHTML="<a class=\\"pay\\" target=\\"_top\\" href=\\""+r.short_url+"\\">Continue to secure payment \\u2192</a>";' +
'      btn.style.display="none";' +
'      try{window.top.location.href=r.short_url;}catch(e){}' +
'    }).withFailureHandler(function(e){$("err").textContent=String(e&&e.message||e);btn.disabled=false;refreshAmt();}).createPaymentLink(req);' +
'  });' +
'</script>';
