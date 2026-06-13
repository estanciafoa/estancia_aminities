/**
 * Estancia Amenities — attendance log appender.
 *
 * Add this to the SAME Apps Script project that backs the deployed web app
 * (the one whose /exec URL ends in ...3Dwrgfm7pkw). It reuses the existing
 * helpers validateToken_(), toIstTimestamp_(), and jsonResponse_().
 *
 * 1) Paste the appendAttendanceLog_() function below into Code.gs.
 * 2) In doPost(e), AFTER `const payload = parsePayload_(e);`, add the dispatch
 *    branch shown in the DISPATCH comment below (before validatePayload_).
 * 3) Deploy ▸ Manage deployments ▸ (edit the active deployment) ▸
 *    Version: "New version" ▸ Deploy. The /exec URL stays the same, so the
 *    app needs no change.
 */

/* ---- DISPATCH: add inside doPost(e), near the other `if (payload.action === ...)` blocks ----

    if (payload.action === 'append_log') {
      return appendAttendanceLog_(payload);
    }

------------------------------------------------------------------------------------------- */

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
