import { attachLocalPhotos, importPhotosFromBase64 } from './photos';
import { saveLocalStudents, saveRoster, setLastSyncTime, type RosterEntry, type Student } from './storage';

// Deployed Apps Script web app that proxies the (private) Google Sheet.
// It exposes a `get_csv` action guarded by a token. See README for redeploy steps.
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';
const SHEET_TOKEN = 'Admin2026';
const STUDENTS_GID = '716123554'; // subscription details tab (Flat No → Paid for)
const ROSTER_GID = '0'; // "Student id" tab (Student ID → Name/Flat), photos by ID

// In/out attendance log lives in a separate spreadsheet, written via a
// dedicated (write-only) Apps Script deployment. Reads stay on APPS_SCRIPT_URL.
const LOG_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxzA2-G3PjL-1HQuFXW1Gboj1vyBmBE1UFT38cTW2BjMdrtZ0AkM3pYG0P5Xyii-v4DjQ/exec';
const LOG_SS_ID = '1FDIJ5xJWDG6BTwf_jwn8QQIurZY7x2NI4xpxFEbM_80';
const LOG_GID = '1191732374';

export type Direction = 'IN' | 'OUT';

export interface AttendanceLogRow {
  category: 'Family' | 'Student' | 'Guest';
  flat: string;
  name: string;
  gender: string; // 'M' | 'F' | ''
  student_id: string;
  direction: Direction;
  // Decision/status: PAID | WARN | REGISTER | DENIED | NA (Guest) | '' (checkout)
  subscription: string;
  // Amenity this device gates (gym/pool/tennis). Auto-filled at enqueue time.
  amenity?: string;
}

/**
 * Append one in/out row to the attendance log sheet via the Apps Script proxy.
 * Requires the `append_log` action in the deployed Code.gs (see apps-script/).
 */
export async function postAttendanceLog(row: AttendanceLogRow, timestamp?: string): Promise<void> {
  const res = await fetch(LOG_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'follow',
    body: JSON.stringify({
      action: 'append_log',
      token: SHEET_TOKEN,
      ssId: LOG_SS_ID,
      gid: LOG_GID,
      timestamp: timestamp || new Date().toISOString(),
      row,
    }),
  });
  if (!res.ok) throw new Error('Log write failed: ' + res.status);
  const text = await res.text();
  // Success returns JSON {ok:true}. An HTML page means the action/deploy is missing.
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Log write failed: Apps Script not updated (append_log action missing)');
  }
  if (!data.ok) throw new Error(data.error || 'Log write failed');
}

export interface LogRow {
  timestamp: string;
  category: string;
  flat: string;
  name: string;
  gender: string;
  student_id: string;
  direction: string;
  subscription: string;
  amenity: string;
}

/** Read the full attendance log via the read proxy (for report export). */
export async function fetchLogRows(): Promise<LogRow[]> {
  const url =
    `${APPS_SCRIPT_URL}?action=get_csv` +
    `&ssId=${encodeURIComponent(LOG_SS_ID)}` +
    `&gid=${encodeURIComponent(LOG_GID)}` +
    `&token=${encodeURIComponent(SHEET_TOKEN)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Log fetch failed: ' + res.status);
  const raw = await res.text();
  const rows = parseCSV(raw);
  return rows.map((r) => ({
    timestamp: getCol(r, 'Timestamp'),
    category: getCol(r, 'Category'),
    flat: getCol(r, 'Flat No', 'Flat'),
    name: getCol(r, 'Name'),
    gender: getCol(r, 'Gender'),
    student_id: getCol(r, 'Student ID', 'StudentID'),
    direction: getCol(r, 'Direction'),
    subscription: getCol(r, 'Subscription'),
    amenity: getCol(r, 'Amenity'),
  }));
}

// --- CSV parsing (reused verbatim from IDCHECKER) ---
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      if (line[c] === '"') {
        inQuotes = !inQuotes;
      } else if (line[c] === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += line[c];
      }
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

function getCol(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const val = row[k] || row[k.toLowerCase()] || row[k.toUpperCase()];
    if (val) return val.trim();
  }
  return '';
}

/** Fetch the face-photos ZIP (base64) through the Apps Script `get_zip` proxy. */
async function fetchFacesZipBase64(): Promise<string> {
  const url = `${APPS_SCRIPT_URL}?action=get_zip&token=${encodeURIComponent(SHEET_TOKEN)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('ZIP fetch failed: ' + res.status);
  const raw = await res.text();
  // The proxy returns JSON only on error; base64 ZIP text on success.
  if (raw.trimStart().startsWith('{')) {
    try {
      const err = JSON.parse(raw);
      if (err && err.ok === false) throw new Error(err.error || 'ZIP access denied');
    } catch (e: any) {
      if (e?.message) throw e;
    }
  }
  return raw;
}

/** Fetch any tab's CSV (by gid) through the Apps Script proxy. */
async function fetchCsvByGid(gid: string): Promise<Record<string, string>[]> {
  const url =
    `${APPS_SCRIPT_URL}?action=get_csv` +
    `&gid=${encodeURIComponent(gid)}` +
    `&token=${encodeURIComponent(SHEET_TOKEN)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Fetch failed: ' + res.status);
  const raw = await res.text();
  // The proxy returns JSON only on error; CSV on success.
  if (raw.trimStart().startsWith('{')) {
    try {
      const err = JSON.parse(raw);
      if (err && err.ok === false) throw new Error(err.error || 'Access denied');
    } catch (e: any) {
      if (e?.message) throw e;
    }
  }
  return parseCSV(raw);
}

/**
 * Pull the Google Sheet into the local database.
 * Sheet columns: Flat No, Name, Month, Type, Paid for, Status.
 * Identity is the Flat No (the sheet has no per-person ID); "Paid for" is a
 * single amenity per row (a flat may have several rows for several amenities).
 *
 * @param opts.photos when true (default), also download the faces ZIP from
 *   Drive and extract photos. Pass { photos: false } to sync ONLY the
 *   subscription data quickly (skips the ~36 MB ZIP). Already-downloaded
 *   photos are still re-attached either way.
 * @returns the number of subscription records stored.
 */
export async function syncStudents(opts: { photos?: boolean } = {}): Promise<number> {
  const includePhotos = opts.photos ?? true;

  // 1) Subscription details (Flat No → Paid for) — the gating data.
  const subRows = await fetchCsvByGid(STUDENTS_GID);
  const students: Student[] = [];
  for (const row of subRows) {
    const flat = getCol(row, 'Flat No', 'Flat', 'Flat Number', 'flat number');
    if (!flat) continue;
    const amenity = getCol(row, 'Paid for', 'Paid For', 'Paidfor', 'Subscription', 'Amenity')
      .trim()
      .toLowerCase();
    students.push({
      flat,
      name: getCol(row, 'Name'),
      month: getCol(row, 'Month'),
      status: getCol(row, 'Status'),
      type: getCol(row, 'Type'),
      amenity,
    });
  }

  // 2) Student roster (Student ID → Name/Flat) — for ID-based student lookup.
  const rosterRows = await fetchCsvByGid(ROSTER_GID);
  let roster: RosterEntry[] = [];
  for (const row of rosterRows) {
    const id = getCol(row, 'ID', 'Id', 'Student ID', 'StudentID');
    if (!id) continue;
    roster.push({
      id,
      name: getCol(row, 'Name'),
      flat: getCol(row, 'Flat', 'Flat No', 'Flat Number', 'flat number'),
      validTill: getCol(row, 'ValidTill', 'Valid Till', 'Valid To'),
    });
  }

  // Optionally pull the face photos ZIP from Drive and extract by student ID.
  // Photos are best-effort: a ZIP failure must not abort the data sync.
  if (includePhotos) {
    try {
      const zipBase64 = await fetchFacesZipBase64();
      await importPhotosFromBase64(zipBase64, roster.map((r) => r.id));
    } catch (e) {
      console.warn('Face photo sync failed (continuing without photos):', e);
    }
  }

  // Re-attach any locally-available photos (cheap, no network) regardless, so a
  // data-only sync keeps photos fetched in a previous full sync. Named by ID.
  try {
    roster = await attachLocalPhotos(roster, (r) => r.id);
  } catch {
    /* ignore */
  }

  await saveLocalStudents(students);
  await saveRoster(roster);
  await setLastSyncTime(new Date().toISOString());
  return students.length;
}
