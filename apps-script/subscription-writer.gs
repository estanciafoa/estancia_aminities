/**
 * Estancia Amenities — SUBSCRIPTION SHEET WRITER web app.
 *
 * Powers admin.html: it POSTs parsed bank-statement rows here and this script
 * inserts them at the TOP of the chosen amenity tab (gym/swimming/tennis/combo)
 * of the subscription spreadsheet.
 *
 * ⚠️ DEPLOY THIS IN ITS OWN Apps Script project — NEVER in the same project as
 * razorpay-payments.gs. Both files define doGet/doPost; put together, one set of
 * handlers shadows the other and this /exec URL silently starts serving the wrong
 * app (that outage: the subscription URL served the Razorpay "Pay" page). Two
 * web apps = two projects = two /exec URLs.
 *
 * Deploy:
 *   1. Open the target sheet (id 1OhbhJPxep0s5eQKmakgmSjJBIMDEzSN3iRXuGMaOCng)
 *      ▸ Extensions ▸ Apps Script  (or a standalone Apps Script project).
 *   2. Paste this WHOLE file as Code.gs.
 *   3. Deploy ▸ New deployment ▸ Web app.
 *        Execute as = Me,  Who has access = Anyone.
 *   4. Copy the /exec URL and paste it into admin.html's ENDPOINT constant.
 *   To update later: Deploy ▸ Manage deployments ▸ edit ▸ Version: New version ▸ Deploy.
 *
 * The page POSTs {action:'insert_rows', token, ssId, gid, rows} here, where each
 * row is [S.No., APT NO., NAME OF CLIENT, AMENITY USER, Month, Amount, Payment
 * Description] (already normalized client-side; AMENITY USER + Month are parsed
 * out of the bank statement's Description text).
 */

var WRITE_TOKEN = 'Admin2026';

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.action === 'existing_keys') return existingKeys_(p);
    if (p.action === 'get_rows') return getRows_(p);
    if (p.action === 'get_rows_multi') return getRowsMulti_(p);
  } catch (err) {
    return jsonResponse_(false, null, err && err.message ? err.message : String(err));
  }
  return jsonResponse_(true, { service: 'estancia-subscription-writer', status: 'ok' }, null);
}

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    if (payload.action === 'insert_rows') {
      return insertSubscriptionRows_(payload);
    }
    if (payload.action === 'dedupe_tab') {
      return dedupeTab_(payload);
    }
    return jsonResponse_(false, null, 'Unknown action: ' + payload.action);
  } catch (err) {
    return jsonResponse_(false, null, err && err.message ? err.message : String(err));
  }
}

function insertSubscriptionRows_(payload) {
  validateToken_(payload.token);

  if (!payload.ssId) throw new Error('ssId is required');
  var ss = SpreadsheetApp.openById(payload.ssId);
  var sheet = resolveSheet_(ss, payload.gid);

  // Ensure a header row exists (only when the tab is completely empty).
  var headers = ['S.No.', 'APT NO.', 'NAME OF CLIENT', 'AMENITY USER', 'Month', 'Amount', 'Payment Description'];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  var rows = payload.rows || [];
  if (rows.length) {
    // Insert at the TOP of the data region (below the header), pushing existing
    // rows down — the chosen "insert before the first data row" behavior.
    sheet.insertRowsBefore(2, rows.length);
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return jsonResponse_(true, { inserted: rows.length, tab: sheet.getName() }, null);
}

// One-time cleanup: collapse rows that a re-uploaded statement duplicated. The
// dedup key is APT NO. + NAME OF CLIENT + AMENITY USER + Month + Amount (cols
// B..F), normalized — the same unique-subscription key as normKey_/rowKey. The
// S.No. (col A) and Payment Description (col G) are NOT in the key, so two rows
// that describe the same subscription (same person, month and amount) collapse
// even if the description wording differs; rows differing in amount are KEPT.
// Keeps the first (topmost = newest) occurrence, drops blank rows, and renumbers
// S.No. 1..N. Pass dryRun:true to preview the counts without writing. (The real
// fix for WHY duplicates piled up is the header-based existing_keys above —
// redeploy this file so uploads dedup again.)
function dedupeTab_(p) {
  validateToken_(p.token);
  if (!p.ssId) throw new Error('ssId is required');
  var ss = SpreadsheetApp.openById(p.ssId);
  var sheet = resolveSheet_(ss, p.gid);

  var last = sheet.getLastRow();
  if (last < 2) return jsonResponse_(true, { tab: sheet.getName(), total: 0, kept: 0, removed: 0 }, null);
  var width = sheet.getLastColumn();
  var all = sheet.getRange(1, 1, last, width).getValues();

  var seen = {};
  var kept = [];
  var removed = 0;
  for (var r = 1; r < all.length; r++) {
    var row = all[r];
    var blank = true;
    for (var c = 1; c < row.length; c++) {
      if (String(row[c] == null ? '' : row[c]).trim() !== '') { blank = false; break; }
    }
    if (blank) { removed++; continue; }
    // Key = cols B..F (APT NO., NAME, AMENITY USER, Month, Amount) — S.No. (col A)
    // and Payment Description (col G) excluded, matching normKey_/rowKey.
    var parts = [];
    for (var c = 1; c <= 5; c++) parts.push(String(row[c] == null ? '' : row[c]).trim().toLowerCase());
    var key = parts.join('');
    if (seen[key]) { removed++; continue; }
    seen[key] = true;
    kept.push(row);
  }

  if (p.dryRun) {
    return jsonResponse_(true, { tab: sheet.getName(), total: last - 1, kept: kept.length, removed: removed, dryRun: true }, null);
  }

  for (var i = 0; i < kept.length; i++) kept[i][0] = i + 1; // renumber S.No.
  sheet.getRange(2, 1, last - 1, width).clearContent();
  if (kept.length) sheet.getRange(2, 1, kept.length, width).setValues(kept);
  return jsonResponse_(true, { tab: sheet.getName(), total: last - 1, kept: kept.length, removed: removed }, null);
}

// Resolve a tab by gid (matching getSheetId()), falling back to the first sheet.
function resolveSheet_(ss, gid) {
  if (gid) {
    var g = Number(gid);
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === g) return sheets[i];
    }
    throw new Error('Sheet with gid ' + g + ' not found');
  }
  return ss.getSheets()[0];
}

// Return the existing rows' unique keys (APT NO + NAME + AMENITY USER + Month +
// Amount), lowercased, so admin.html can drop duplicates before pushing. This
// identifies the same subscription regardless of which statement it came from —
// the S.No. differs per statement and the Payment Description is free text, so
// NEITHER is part of the key. Columns are located by header name (tolerant),
// falling back to positions B/C/D/F. MUST match admin.html's rowKey exactly.
function existingKeys_(p) {
  validateToken_(p.token);
  if (!p.ssId) throw new Error('ssId is required');
  var ss = SpreadsheetApp.openById(p.ssId);
  var sheet = resolveSheet_(ss, p.gid);

  var last = sheet.getLastRow();
  if (last < 2) return jsonResponse_(true, { keys: [] }, null);

  var width = Math.max(sheet.getLastColumn(), 5);
  var all = sheet.getRange(1, 1, last, width).getValues();
  var header = all[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function findCol(names, fallback) {
    for (var i = 0; i < header.length; i++) {
      for (var j = 0; j < names.length; j++) {
        if (header[i] === names[j]) return i;
      }
    }
    return fallback;
  }
  var iApt = findCol(['apt no.', 'apt no', 'flat no.', 'flat no', 'flat', 'usn'], 1);
  var iName = findCol(['name of client', 'name'], 2);
  var iUser = findCol(['amenity user', 'aminity user', 'amenity user name'], 3);
  var iAmount = findCol(['amount', 'amt'], 5);
  // Derive the month from the Payment Description (verbatim text) — NOT the Month
  // cell, which Sheets coerces to a date and would never match the client's
  // parsed "Jul 2026". Same derivation the app and admin.html use.
  var iDesc = findCol(['payment description', 'payment desription', 'description', 'head'], 6);
  var iMonthCell = findCol(['month'], 4);

  var keys = [];
  for (var r = 1; r < all.length; r++) {
    var month = monthFromText_(String(all[r][iDesc] || '')) || monthFromText_(String(all[r][iMonthCell] || ''));
    keys.push(normKey_(all[r][iApt], all[r][iName], all[r][iUser], month, all[r][iAmount]));
  }
  return jsonResponse_(true, { keys: keys }, null);
}

// ── Month parsing (ported from admin.html extractMonth / sheets.ts monthFromText,
// kept identical so client and server produce the same key) ──────────────────
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

// Return a tab's data rows as objects keyed by the (trimmed) header row, so the
// mobile app can read this sheet as its subscription source.
function getRows_(p) {
  validateToken_(p.token);
  if (!p.ssId) throw new Error('ssId is required');
  var ss = SpreadsheetApp.openById(p.ssId);
  var sheet = resolveSheet_(ss, p.gid);

  var last = sheet.getLastRow();
  if (last < 2) return jsonResponse_(true, { rows: [] }, null);

  var all = sheet.getRange(1, 1, last, sheet.getLastColumn()).getValues();
  var header = all[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var r = 1; r < all.length; r++) {
    var obj = {};
    for (var c = 0; c < header.length; c++) {
      if (header[c]) obj[header[c]] = all[r][c];
    }
    rows.push(obj);
  }
  return jsonResponse_(true, { rows: rows }, null);
}

// Read SEVERAL tabs of one spreadsheet in ONE execution, filtered to one
// billing month, and return positional arrays instead of per-row objects.
//
// This exists because the bank report needs four tabs at once: doing that as
// four `get_rows` calls meant four concurrent executions (all `Execute as = Me`,
// so they queue against one identity), four openById() calls on the SAME
// spreadsheet, and the whole multi-year history shipped so the browser could
// throw ~70% of it away. Measured on the live sheet: 1145 rows / 280 KB / 4
// requests became 368 rows / 47 KB / 1 request.
//
// `get_rows` above is UNCHANGED and still object-shaped — src/services/sheets.ts
// depends on it. This is an additional action, not a replacement.
//
// Params: gids (comma-separated), month ("Aug 2026", optional — omit for all
// rows), ssId, token.
// Returns { header, tabs: { <gid>: { rows: [[...]], dupSkipped } } }, where each
// row is [S.No., APT NO., NAME OF CLIENT, AMENITY USER, Amount, Payment
// Description] with S.No. renumbered from 1 — the bank workbook's column order.
function getRowsMulti_(p) {
  validateToken_(p.token);
  if (!p.ssId) throw new Error('ssId is required');
  if (!p.gids) throw new Error('gids is required');

  var ss = SpreadsheetApp.openById(p.ssId); // once, not once per tab
  var wantMonth = String(p.month || '').trim();
  var gids = String(p.gids).split(',');
  var tabs = {};

  for (var t = 0; t < gids.length; t++) {
    var gid = String(gids[t]).trim();
    if (!gid) continue;
    tabs[gid] = readTabRows_(resolveSheet_(ss, gid), wantMonth);
  }
  return jsonResponse_(true, { header: BANK_HEADER_, tabs: tabs }, null);
}

var BANK_HEADER_ = ['S.No.', 'APT NO.', 'NAME OF CLIENT', 'AMENITY USER', 'Amount', 'Payment Description'];

// One tab -> this month's rows, deduped and renumbered. Columns are located by
// header name with the same fallbacks as existingKeys_, so a tab whose columns
// drift still reads. The dedupe key is normKey_ (APT NO. + NAME + AMENITY USER
// + Month + Amount) — identical to the client's rowKey; rows are newest-first
// (insertRowsBefore(2, ...)), so the first occurrence of a key wins.
function readTabRows_(sheet, wantMonth) {
  var last = sheet.getLastRow();
  if (last < 2) return { rows: [], dupSkipped: 0 };

  var width = Math.max(sheet.getLastColumn(), 7);
  var all = sheet.getRange(1, 1, last, width).getValues();
  var header = all[0].map(function (h) { return String(h).trim().toLowerCase(); });
  function findCol(names, fallback) {
    for (var i = 0; i < header.length; i++) {
      for (var j = 0; j < names.length; j++) {
        if (header[i] === names[j]) return i;
      }
    }
    return fallback;
  }
  var iApt = findCol(['apt no.', 'apt no', 'flat no.', 'flat no', 'flat', 'usn'], 1);
  var iName = findCol(['name of client', 'name'], 2);
  var iUser = findCol(['amenity user', 'aminity user', 'amenity user name'], 3);
  var iAmount = findCol(['amount', 'amt'], 5);
  var iDesc = findCol(['payment description', 'payment desription', 'description', 'head'], 6);
  var iMonthCell = findCol(['month'], 4);

  var rows = [], seen = {}, dupSkipped = 0, seq = 0;
  for (var r = 1; r < all.length; r++) {
    var desc = all[r][iDesc] == null ? '' : String(all[r][iDesc]);
    var month = monthFromText_(desc) || monthFromCell_(all[r][iMonthCell]);
    if (wantMonth && month !== wantMonth) continue;

    var apt = all[r][iApt] == null ? '' : all[r][iApt];
    var name = all[r][iName] == null ? '' : all[r][iName];
    var user = all[r][iUser] == null ? '' : all[r][iUser];
    var amount = toNum_(all[r][iAmount]);

    var key = normKey_(apt, name, user, month, amount);
    if (seen[key]) { dupSkipped++; continue; }
    seen[key] = true;
    rows.push([++seq, apt, name, user, amount, desc]);
  }
  return { rows: rows, dupSkipped: dupSkipped };
}

// The Month cell, when the Payment Description has no month in it. Sheets
// coerces that column to a Date, and Apps Script hands it back as a Date object
// whose String() form is "Mon Aug 01 2026 ..." — monthFromText_ reads the "01"
// as the year and returns "Aug 2001". Format it instead. (admin.html could
// never use this fallback at all: over JSON the cell arrived as an ISO string,
// which matches no month pattern, so these rows silently fell out of every
// report.) Plain text in the cell still goes through monthFromText_.
function monthFromCell_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'MMM yyyy');
  }
  return monthFromText_(String(v));
}

// "Rs. 1,300.00" -> 1300. Left as-is when there's no number to find, matching
// admin.html's toNum so the dedupe key is byte-identical on both sides.
function toNum_(v) {
  var n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? v : n;
}

// Unique-subscription key: APT NO. + NAME OF CLIENT + AMENITY USER + Month +
// Amount, normalized. Kept identical to admin.html's rowKey (client side).
function normKey_(apt, name, user, month, amount) {
  return [
    String(apt == null ? '' : apt).trim().toLowerCase(),
    String(name == null ? '' : name).trim().toLowerCase(),
    String(user == null ? '' : user).trim().toLowerCase(),
    String(month == null ? '' : month).trim().toLowerCase(),
    String(amount == null ? '' : amount).trim().toLowerCase()
  ].join('|');
}

function parsePayload_(e) {
  if (e && e.parameter && e.parameter.payload) return JSON.parse(e.parameter.payload);
  if (e && e.postData && e.postData.contents) {
    var raw = e.postData.contents;
    if (typeof raw === 'string' && raw.indexOf('payload=') === 0) {
      var encoded = raw.split('&').filter(function (p) { return p.indexOf('payload=') === 0; })
        .map(function (p) { return p.substring('payload='.length); })[0] || '';
      return JSON.parse(decodeURIComponent(encoded.replace(/\+/g, ' ')));
    }
    return JSON.parse(raw);
  }
  throw new Error('Missing payload body');
}

function validateToken_(t) {
  if (!t || t !== WRITE_TOKEN) throw new Error('Invalid token');
}

function jsonResponse_(ok, result, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, result: result || null, error: error || null, ts: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}
