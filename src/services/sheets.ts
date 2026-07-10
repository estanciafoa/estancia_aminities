import { attachLocalPhotos, importPhotosFromBase64 } from './photos';
import {
  getLastSyncTime,
  saveFamilyRoster,
  saveLocalStudents,
  saveRoster,
  setLastSyncTime,
  type RosterEntry,
  type Student,
} from './storage';

// Deployed Apps Script web app that proxies the (private) Google Sheet.
// It exposes a `get_csv` action guarded by a token. See README for redeploy steps.
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycby2yjp7UEvBdYIDzKjOyFInegp_9CA7LVhpmbHbqwnxdPYEI5WJE8BYki-3Dwrgfm7pkw/exec';
const SHEET_TOKEN = 'Admin2026';
const ROSTER_GID = '0'; // "Student id" tab (Student ID → Name/Flat), photos by ID
// Optional "Family Members" tab (columns: Flat, Name, Gender) — pre-seeds the
// family autofill list. Leave '' until the tab exists; sync skips it when empty.
const FAMILY_GID = '';

// Subscription source: the amenities-payment sheet populated by admin.html, read
// via the subscription-writer Apps Script (`get_rows` action, ssId passed
// explicitly). Each amenity has its own tab; a `combo` row covers gym + swimming.
const SUB_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxPbb2C9M4wOp5yuaUdUqq4M-0d8yoDG8-P3JyxKXwR5hQ_J4l61Z1GppvmmnOKsB53/exec';
const SUB_SS_ID = '1OhbhJPxep0s5eQKmakgmSjJBIMDEzSN3iRXuGMaOCng';
const AMENITY_TABS: Record<string, string> = {
  '2051574635': 'gym',
  '1433427596': 'swimming',
  '2028550937': 'tennis',
  '1913121077': 'combo',
};

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
  // Amenity this device gates (gym/swimming/tennis). Auto-filled at enqueue time.
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

// Case-insensitive header lookup (headers vary: "Month" vs "MONTH", trailing
// spaces, etc.). Spelling variants — e.g. "AMENITY USER" vs the older typo
// "AMINITY USER" — must still be passed as separate aliases.
function getCol(row: Record<string, string>, ...keys: string[]): string {
  const rowKeys = Object.keys(row);
  for (const k of keys) {
    const target = k.trim().toLowerCase();
    for (const rk of rowKeys) {
      if (rk.trim().toLowerCase() === target) {
        const v = row[rk];
        if (v != null && String(v).trim()) return String(v).trim();
      }
    }
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

const MONTHS: Record<string, string> = {
  jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
  jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec',
};

/** Normalize a month word + year into "Jul 2026"; '' if not a real month. */
function normMonth(word: string, yr: string): string {
  const mon = MONTHS[word.slice(0, 3).toLowerCase()];
  if (!mon) return '';
  let y = yr.trim();
  if (y.length === 2) y = '20' + y;
  return mon + ' ' + y;
}

/**
 * Pull a billing month ("Jul 2026") out of free text — the Payment Description
 * ("Jul26 - Gym Fee …" / "… until the period of JUL 2026") or an already-clean
 * "Jul 2026" value. Returns '' if none found (e.g. a date-coerced cell).
 */
function monthFromText(text: string): string {
  const d = text || '';
  let m = d.match(/until\s+the\s+period\s+of\s+([A-Za-z]{3,9})\s+(\d{4})/i);
  if (m) return normMonth(m[1], m[2]);
  m = d.match(/^\s*([A-Za-z]{3,9})\s*'?\s*(\d{2,4})\b/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return normMonth(m[1], m[2]);
  m = d.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*'?\s*(\d{2,4})\b/i);
  if (m) return normMonth(m[1], m[2]);
  return '';
}

/** Fetch a tab's rows (objects keyed by header, values coerced to strings). */
async function fetchSubRowsByGid(gid: string): Promise<Record<string, string>[]> {
  const url =
    `${SUB_APPS_SCRIPT_URL}?action=get_rows` +
    `&gid=${encodeURIComponent(gid)}` +
    `&ssId=${encodeURIComponent(SUB_SS_ID)}` +
    `&token=${encodeURIComponent(SHEET_TOKEN)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Subscription fetch failed: ' + res.status);
  const data = JSON.parse(await res.text());
  if (!data.ok) throw new Error(data.error || 'Subscription read denied');
  const rows = data.result && data.result.rows;
  // A missing `rows` array means the deployed Apps Script predates `get_rows`
  // (it returned the health payload) — surface that instead of a silent 0.
  if (!Array.isArray(rows)) {
    throw new Error('Subscription Apps Script not updated (get_rows missing) — redeploy a new version');
  }
  // Cells can come back as numbers/dates; the column helpers expect strings.
  return rows.map((r: Record<string, unknown>) => {
    const o: Record<string, string> = {};
    for (const k of Object.keys(r)) o[k] = r[k] == null ? '' : String(r[k]);
    return o;
  });
}

/**
 * Which amenities a free-text description names — used to expand a combo row
 * into one record per covered amenity. A combo can be any mix (gym+swimming,
 * swim+tennis, all three), so we read the amenities back out of the row's own
 * Payment Description rather than assuming a fixed pair.
 */
function amenitiesFromText(text: string): string[] {
  const d = (text || '').toLowerCase();
  const out: string[] = [];
  if (/gym/.test(d)) out.push('gym');
  if (/swim/.test(d)) out.push('swimming');
  if (/tennis/.test(d)) out.push('tennis');
  return out;
}

/**
 * Read the amenities-payment sheet (gym/swimming/tennis/combo tabs) into the
 * app's Student model. One row per (flat, amenity); a `combo` row is expanded
 * into one record per amenity it covers, parsed from that row's own Payment
 * Description (so gating passes on exactly the amenities the resident paid for).
 *
 * Sheet columns: S.No. | APT NO. | NAME OF CLIENT | AMINITY USER | MONTH |
 * Amount | Payment Desription. Gating uses APT NO. (flat) + AMINITY USER (the
 * per-person name) + the month. The MONTH cell is stored as a date by Sheets,
 * so the month is derived from the "Payment Desription" text instead.
 */
async function fetchSubscriptionStudents(): Promise<Student[]> {
  const students: Student[] = [];
  for (const gid of Object.keys(AMENITY_TABS)) {
    const tabAmenity = AMENITY_TABS[gid];
    const rows = await fetchSubRowsByGid(gid);
    for (const row of rows) {
      const flat = getCol(row, 'APT NO.', 'APT NO', 'FLAT NO.', 'FLAT NO', 'FLAT');
      if (!flat) continue;
      // Headers may be correctly spelled ("AMENITY USER", "Payment Description")
      // or the older typo'd form ("AMINITY USER", "Payment Desription") — accept both.
      const name = getCol(row, 'AMENITY USER', 'AMINITY USER', 'NAME OF CLIENT');
      const desc = getCol(row, 'Payment Description', 'Payment Desription', 'Description', 'head');
      const month = monthFromText(desc) || monthFromText(getCol(row, 'Month', 'MONTH'));
      // Combo: cover whatever amenities the description names (fall back to the
      // legacy gym+swimming pair if it can't be parsed). Other tabs: the tab.
      let amenities: string[];
      if (tabAmenity === 'combo') {
        amenities = amenitiesFromText(desc);
        if (!amenities.length) amenities = ['gym', 'swimming'];
      } else {
        amenities = [tabAmenity];
      }
      for (const amenity of amenities) {
        students.push({ flat, name, month, status: 'Paid', type: '', amenity });
      }
    }
  }
  return students;
}

/**
 * Pull the Google Sheet into the local database.
 * Subscriptions come from the amenities-payment sheet (gym/swimming/tennis/combo
 * tabs, columns APT NO. / AMENITY USER / Month / …); identity is the flat, and a
 * combo row is expanded into gym + swimming records. Roster + face photos still
 * come from the original read proxy.
 *
 * @param opts.photos when true (default), also download the faces ZIP from
 *   Drive and extract photos. Pass { photos: false } to sync ONLY the
 *   subscription data quickly (skips the ~36 MB ZIP). Already-downloaded
 *   photos are still re-attached either way.
 * @returns the number of subscription records stored.
 */
export async function syncStudents(opts: { photos?: boolean } = {}): Promise<number> {
  const includePhotos = opts.photos ?? true;

  // 1) Subscription details (APT NO. → amenity) — the gating data.
  const students = await fetchSubscriptionStudents();

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

  // 3) Optional Family Members tab (Flat, Name, Gender) — pre-seeds the family
  //    autofill list. Best-effort: a missing tab/gid must not abort the sync.
  if (FAMILY_GID) {
    try {
      const famRows = await fetchCsvByGid(FAMILY_GID);
      const fam: { flat: string; name: string; gender: string }[] = [];
      for (const row of famRows) {
        const flat = getCol(row, 'Flat', 'Flat No', 'Flat Number', 'flat number');
        const name = getCol(row, 'Name');
        if (!flat || !name) continue;
        const g = getCol(row, 'Gender', 'Sex').trim().toUpperCase();
        fam.push({ flat, name, gender: g.startsWith('F') ? 'F' : g.startsWith('M') ? 'M' : '' });
      }
      await saveFamilyRoster(fam);
    } catch (e) {
      console.warn('Family roster sync failed (continuing):', e);
    }
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

export const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
let _autoSyncing = false;

/**
 * Best-effort background sync used by the app shell. Refreshes subscription data
 * (no photos) when the last successful sync is older than `maxAgeMs`. Safe to
 * call often — it self-throttles (one at a time, skips if recently synced) and
 * swallows errors, so a manual "SYNC + PHOTOS" is never blocked.
 */
export async function autoSyncIfDue(maxAgeMs = AUTO_SYNC_INTERVAL_MS): Promise<void> {
  if (_autoSyncing) return;
  _autoSyncing = true;
  try {
    const last = await getLastSyncTime();
    if (last && Date.now() - new Date(last).getTime() < maxAgeMs) return;
    await syncStudents({ photos: false });
  } catch (e) {
    console.warn('Auto-sync failed (will retry later):', e);
  } finally {
    _autoSyncing = false;
  }
}
