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
 */

var LOG_TOKEN = 'Admin2026';

function doGet(e) {
  return jsonResponse_(true, { service: 'estancia-amenities-log-writer', status: 'ok' }, null);
}

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    if (payload.action === 'append_log') {
      return appendAttendanceLog_(payload);
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

  var headers = ['Timestamp', 'Category', 'Flat No', 'Name', 'Gender', 'Student ID', 'Direction', 'Subscription'];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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
    r.subscription || ''
  ]);

  return jsonResponse_(true, { appended: 1 }, null);
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
