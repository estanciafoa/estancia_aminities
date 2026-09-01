/**
 * Estancia Amenities — standalone attendance LOG WRITER web app.
 *
 * This is self-contained: paste the WHOLE file as Code.gs in the Apps Script
 * project deployed at the write URL
 * (…/macros/s/AKfycbxzA2-G3PjL-1HQuFXW1Gboj1vyBmBE1UFT38cTW2BjMdrtZ0AkM3pYG0P5Xyii-v4DjQ/exec),
 * then Deploy ▸ Manage deployments ▸ edit ▸ Version: New version ▸ Deploy.
 *
 * Deploy settings: Execute as = Me, Who has access = Anyone.
 * The app POSTs {action:'append_log', token, ssId, gid, timestamp, row} here.
 *
 * This deployment is ALSO shared by a separate guard-patrol app (append_patrol_log
 * / appendReport_ below) — unrelated to Estancia Amenities but living on the same
 * URL/token. Keep that code intact when redeploying from this repo.
 */

var LOG_TOKEN = 'Admin2026';

// Once the live attendance-log tab grows past LOG_ARCHIVE_THRESHOLD data rows
// (excludes header), the OLDEST rows are moved down to LOG_ARCHIVE_KEEP into a
// same-spreadsheet tab named LOG_ARCHIVE_TAB_NAME — nothing is deleted, just
// relocated. This keeps the tab every check-in writes to (and every report
// reads via get_csv by default) fast, since getDataRange()/get_csv both scan
// the whole tab on every call. The read proxy can still read the archive tab
// directly via `get_csv&sheet=<LOG_ARCHIVE_TAB_NAME>` — the app's fetchLogRows
// merges both so reports never lose access to older rows.
var LOG_ARCHIVE_TAB_NAME = 'Attendance Log Archive';
var LOG_ARCHIVE_THRESHOLD = 20000;
var LOG_ARCHIVE_KEEP = 15000;

function doGet(e) {
  return jsonResponse_(true, { service: 'estancia-amenities-log-writer', status: 'ok' }, null);
}

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    if (payload.action === 'append_log') {
      return appendAttendanceLog_(payload);
    }
    if (payload.action === 'append_patrol_log') {
      return appendPatrolLog_(payload);
    }
    return jsonResponse_(false, null, 'Unknown action: ' + payload.action);
  } catch (err) {
    return jsonResponse_(false, null, err && err.message ? err.message : String(err));
  }
}

function appendAttendanceLog_(payload) {
  validateToken_(payload.token);

  if (!payload.ssId) throw new Error('ssId is required');
  var ss = SpreadsheetApp.openById(payload.ssId);

  // Resolve the target tab by gid, falling back to the first sheet.
  var sheet = null;
  if (payload.gid) {
    var gid = Number(payload.gid);
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === gid) { sheet = sheets[i]; break; }
    }
    if (!sheet) throw new Error('Sheet with gid ' + gid + ' not found');
  } else {
    sheet = ss.getSheets()[0];
  }

  var headers = ['Timestamp', 'Category', 'Flat No', 'Name', 'Gender', 'Student ID', 'Direction', 'Subscription', 'Amenity'];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    // Migrate older sheets that pre-date the Amenity column: add the header
    // if it's missing so the new value lands under a labelled column.
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (existing.indexOf('Amenity') === -1) {
      sheet.getRange(1, headers.length, 1, 1).setValue('Amenity');
    }
  }

  var r = payload.row || {};
  sheet.appendRow([
    toIstTimestamp_(payload.timestamp),
    r.category || '',
    r.flat || '',
    r.name || '',
    r.gender || '',
    r.student_id || '',
    r.direction || '',
    r.subscription || '',
    r.amenity || ''
  ]);

  archiveOldRowsIfNeeded_(ss, sheet);

  return jsonResponse_(true, { appended: 1 }, null);
}

/**
 * Self-throttling archival: a cheap getLastRow() check runs on every append,
 * but the actual (more expensive) row move only happens once the tab crosses
 * LOG_ARCHIVE_THRESHOLD, and it drops the tab back down to LOG_ARCHIVE_KEEP —
 * so it won't re-trigger on every single append once past the threshold.
 */
function archiveOldRowsIfNeeded_(ss, sheet) {
  var dataRows = sheet.getLastRow() - 1; // exclude header
  if (dataRows <= LOG_ARCHIVE_THRESHOLD) return;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return; // another request is already archiving — skip, it'll catch up next append
  }

  try {
    // Re-check under the lock: a concurrent append may have just archived.
    dataRows = sheet.getLastRow() - 1;
    if (dataRows <= LOG_ARCHIVE_THRESHOLD) return;

    var toMove = dataRows - LOG_ARCHIVE_KEEP;
    var width = sheet.getLastColumn();
    var header = sheet.getRange(1, 1, 1, width).getValues();
    var oldRows = sheet.getRange(2, 1, toMove, width).getValues();

    var archive = ss.getSheetByName(LOG_ARCHIVE_TAB_NAME);
    if (!archive) archive = ss.insertSheet(LOG_ARCHIVE_TAB_NAME);
    if (archive.getLastRow() === 0) archive.getRange(1, 1, 1, width).setValues(header);

    archive.getRange(archive.getLastRow() + 1, 1, toMove, width).setValues(oldRows);
    sheet.deleteRows(2, toMove);
  } finally {
    lock.releaseLock();
  }
}
//------
var REPORT_FOLDER = 'Patrol Reports';
var PATROL_HEADERS = ['Date', 'Time', 'Guard Id', 'Name', 'Point', 'TAG ID', 'Report', 'Voice'];

function appendPatrolLog_(payload) {
  validateToken_(payload.token);
  if (!payload.ssId) throw new Error('ssId is required');

  var sheet = resolvePatrolSheet_(SpreadsheetApp.openById(payload.ssId), payload.gid);
  ensurePatrolHeaders_(sheet);

  var d = parseDate_(payload.timestamp);
  var r = payload.row || {};
  sheet.appendRow([
    Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy'),
    Utilities.formatDate(d, 'Asia/Kolkata', 'hh:mm a'),
    r.guardId || '',
    r.guardName || '',
    r.checkpoint || '',
    r.tagId || '',
    '', // Report column blank for normal scans
    ''  // Voice column blank for normal scans
  ]);
  return jsonResponse_(true, { appended: 1 }, null);
}

function appendReport_(payload) {
  validateToken_(payload.token);
  if (!payload.ssId) throw new Error('ssId is required');

  var folder = getOrCreateFolder_(REPORT_FOLDER);
  var photoUrl = saveToDrive_(folder, payload.image, 'report.jpg', 'image/jpeg');
  var voiceUrl = saveToDrive_(folder, payload.audio, 'voice.m4a', 'audio/mp4');

  var sheet = resolvePatrolSheet_(SpreadsheetApp.openById(payload.ssId), payload.gid);
  ensurePatrolHeaders_(sheet);

  var d = parseDate_(payload.timestamp);
  var r = payload.row || {};
  sheet.appendRow([
    Utilities.formatDate(d, 'Asia/Kolkata', 'dd/MM/yyyy'),
    Utilities.formatDate(d, 'Asia/Kolkata', 'hh:mm a'),
    r.guardId || '',
    r.guardName || '',
    r.point || '',
    r.tagId || '',
    photoUrl ? '=HYPERLINK("' + photoUrl + '","Photo")' : '',
    voiceUrl ? '=HYPERLINK("' + voiceUrl + '","Voice note")' : ''
  ]);
  return jsonResponse_(true, { appended: 1, photo: photoUrl, voice: voiceUrl }, null);
}

/** Save a base64 part to [folder], share it, and return its URL (or '' if absent). */
function saveToDrive_(folder, part, defaultName, defaultMime) {
  if (!part || !part.data) return '';
  var blob = Utilities.newBlob(
    Utilities.base64Decode(part.data),
    part.mimeType || defaultMime,
    part.name || defaultName
  );
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

function resolvePatrolSheet_(ss, gid) {
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

function ensurePatrolHeaders_(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, PATROL_HEADERS.length).setValues([PATROL_HEADERS]);
    return;
  }
  // Add Report/Voice headers to sheets created before these columns existed.
  var width = Math.max(sheet.getLastColumn(), PATROL_HEADERS.length);
  var existing = sheet.getRange(1, 1, 1, width).getValues()[0];
  if (existing[6] !== 'Report') sheet.getRange(1, 7).setValue('Report');
  if (existing[7] !== 'Voice') sheet.getRange(1, 8).setValue('Voice');
}

function parseDate_(value) {
  var d = value ? new Date(String(value)) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  return d;
}

function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}
//-----
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
  if (!t || t !== LOG_TOKEN) throw new Error('Invalid token');
}

function toIstTimestamp_(value) {
  var d = value ? new Date(String(value)) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss') + ' IST';
}

function jsonResponse_(ok, result, error) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, result: result || null, error: error || null, ts: new Date().toISOString() }))
    .setMimeType(ContentService.MimeType.JSON);
}
