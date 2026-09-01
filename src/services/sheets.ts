import { attachLocalPhotos, importPhotosFromBase64, removePhotosById, writePhotoBase64 } from './photos';
import {
  getLastSyncTime,
  getRoster,
  monthMatchesCurrent,
  saveFamilyRoster,
  saveLocalStudents,
  saveRoster,
  setLastSyncError,
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

/** Progress reporter for syncStudents — the admin screen uses it to show live status. */
export type OnProgress = (msg: string) => void;

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

// Once the live log tab crosses ~20k rows, log-writer.gs moves the oldest
// rows into this same-spreadsheet tab (see apps-script/log-writer.gs) to keep
// the live tab (and every get_csv read of it) fast. Kept in sync with that
// file's LOG_ARCHIVE_TAB_NAME constant.
const LOG_ARCHIVE_TAB_NAME = 'Attendance Log Archive';

function mapLogRow(r: Record<string, string>): LogRow {
  return {
    timestamp: getCol(r, 'Timestamp'),
    category: getCol(r, 'Category'),
    flat: getCol(r, 'Flat No', 'Flat'),
    name: getCol(r, 'Name'),
    gender: getCol(r, 'Gender'),
    student_id: getCol(r, 'Student ID', 'StudentID'),
    direction: getCol(r, 'Direction'),
    subscription: getCol(r, 'Subscription'),
    amenity: getCol(r, 'Amenity'),
  };
}

async function fetchLogCsv(tabParam: string): Promise<Record<string, string>[]> {
  const url =
    `${APPS_SCRIPT_URL}?action=get_csv` +
    `&ssId=${encodeURIComponent(LOG_SS_ID)}` +
    `&${tabParam}` +
    `&token=${encodeURIComponent(SHEET_TOKEN)}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Log fetch failed: ' + res.status);
  const raw = await res.text();
  if (raw.trimStart().startsWith('{')) {
    const err = JSON.parse(raw);
    if (err && err.ok === false) throw new Error(err.error || 'Log fetch denied');
  }
  return parseCSV(raw);
}

/**
 * Read the full attendance log via the read proxy (for report export) —
 * merges the live tab with the archive tab (oldest rows first), so archiving
 * never makes older reports lose data. The archive tab won't exist until the
 * live tab has crossed the threshold once, so its read is best-effort.
 */
export async function fetchLogRows(): Promise<LogRow[]> {
  const [archiveRows, liveRows] = await Promise.all([
    fetchLogCsv(`sheet=${encodeURIComponent(LOG_ARCHIVE_TAB_NAME)}`).catch(() => []),
    fetchLogCsv(`gid=${encodeURIComponent(LOG_GID)}`),
  ]);
  return [...archiveRows, ...liveRows].map(mapLogRow);
}

// How many months back to look when building the family-member name list from
// actual check-in history — deep enough to survive a reinstall (which wipes
// the device-local remembered-names history) without dragging in names from a
// year ago.

/**
 * Build a per-flat family-member name list straight from the attendance log:
 * read the whole log, filter to Category=Family rows, group by Flat No, take
 * the unique Names per flat. Rather than from who paid the subscription (the
 * payer isn't necessarily who checks in). This is what seeds the Family
 * check-in "tap a resident" list on a freshly-installed device, since the
 * device-local remembered-names history (rememberFamilyMember) is wiped by
 * every reinstall. Gender comes from the log itself (captured at check-in).
 */
async function fetchFamilyMembersFromLog(
  onProgress?: OnProgress,
): Promise<{ flat: string; name: string; gender: string }[]> {
  onProgress?.('Reading attendance log for family check-in history…');
  const rows = await fetchLogRows();
  onProgress?.(`Attendance log: ${rows.length} rows read`);

  const byFlat = new Map<string, Map<string, { name: string; gender: string }>>();
  for (const r of rows) {
    if (r.category !== 'Family' || !r.flat || !r.name) continue;
    const fkey = r.flat.trim().toLowerCase();
    let bucket = byFlat.get(fkey);
    if (!bucket) byFlat.set(fkey, (bucket = new Map()));
    const nkey = r.name.trim().toLowerCase();
    const gender = r.gender === 'F' || r.gender === 'M' ? r.gender : '';
    const existing = bucket.get(nkey);
    if (!existing || (!existing.gender && gender)) {
      bucket.set(nkey, { name: r.name.trim(), gender });
    }
  }

  const familyMembers: { flat: string; name: string; gender: string }[] = [];
  for (const [flat, names] of byFlat) {
    for (const m of names.values()) familyMembers.push({ flat, name: m.name, gender: m.gender });
  }
  return familyMembers;
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

/**
 * Locate the "faces" Drive folder living beside the photos ZIP (ported from
 * IDCHECKER's getFacesFolderId) — when it exists, individual faces can be
 * pulled by name (one small ~30KB request each) instead of downloading the
 * whole multi-MB ZIP just to extract a handful of changed photos.
 */
async function getFacesFolderId(): Promise<string | null> {
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=get_faces`, { redirect: 'follow' });
    if (!res.ok) return null;
    const data = JSON.parse(await res.text());
    if (data?.ok && data.result?.found && data.result.folderId) return data.result.folderId as string;
    return null;
  } catch {
    return null;
  }
}

const FACE_DOWNLOAD_CONCURRENCY = 6;
const MAX_FACE_RETRIES = 3;

/** Run `worker` over `items` with at most `concurrency` in flight at once. */
async function runPool<T>(items: T[], worker: (item: T) => Promise<void>, concurrency: number): Promise<void> {
  let next = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  const runOne = async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: n }, runOne));
}

/** Fetch one face image by name (with retry/backoff on transient failures). */
async function fetchFaceBase64(folderId: string, name: string): Promise<string | null> {
  const url = `${APPS_SCRIPT_URL}?action=get_face&folderId=${encodeURIComponent(folderId)}&name=${encodeURIComponent(name)}`;
  for (let attempt = 0; attempt < MAX_FACE_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) {
        const base64 = await res.text();
        // The proxy returns raw base64 on success; a JSON body means a
        // definitive "not found"/error — don't retry that.
        if (!base64 || base64.trimStart().startsWith('{')) return null;
        return base64;
      }
      if (res.status !== 429 && (res.status < 500 || res.status > 599)) return null;
    } catch {
      /* network error — fall through to backoff and retry */
    }
    if (attempt < MAX_FACE_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt + Math.random() * 300));
    }
  }
  return null;
}

/** Pull exactly the wanted IDs' faces from the Drive folder, concurrently. */
async function pullFacesFromFolder(folderId: string, ids: string[], onProgress?: OnProgress): Promise<number> {
  let downloaded = 0;
  let done = 0;
  const total = ids.length;
  await runPool(
    ids,
    async (id) => {
      const base64 = await fetchFaceBase64(folderId, `${id}.jpg`);
      if (base64) {
        await writePhotoBase64(id, base64);
        downloaded++;
      }
      done++;
      onProgress?.(`Photos: ${done}/${total} synced`);
    },
    FACE_DOWNLOAD_CONCURRENCY,
  );
  return downloaded;
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
async function fetchSubscriptionStudents(onProgress?: OnProgress): Promise<Student[]> {
  const students: Student[] = [];
  // The 4 amenity tabs are independent reads — fetch them concurrently rather
  // than one Apps Script round-trip at a time (each has real latency).
  const gids = Object.keys(AMENITY_TABS);
  onProgress?.(`Reading subscription sheet: ${gids.map((g) => AMENITY_TABS[g]).join(', ')} tabs…`);
  const tabRows = await Promise.all(
    gids.map(async (gid) => {
      const rows = await fetchSubRowsByGid(gid);
      onProgress?.(`${AMENITY_TABS[gid]} tab: ${rows.length} rows read`);
      return rows;
    }),
  );
  gids.forEach((gid, i) => {
    const tabAmenity = AMENITY_TABS[gid];
    const rows = tabRows[i];
    for (const row of rows) {
      const flat = getCol(row, 'APT NO.', 'APT NO', 'FLAT NO.', 'FLAT NO', 'FLAT');
      if (!flat) continue;
      // Headers may be correctly spelled ("AMENITY USER", "Payment Description")
      // or the older typo'd form ("AMINITY USER", "Payment Desription") — accept both.
      const name = getCol(row, 'AMENITY USER', 'AMINITY USER', 'NAME OF CLIENT');
      const desc = getCol(row, 'Payment Description', 'Payment Desription', 'Description', 'head');
      const month = monthFromText(desc) || monthFromText(getCol(row, 'Month', 'MONTH'));
      // Current-month subscriptions only — skip rows for other (past/future) months.
      if (!monthMatchesCurrent(month)) continue;
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
  });
  return students;
}

/**
 * Classify roster rows by their Update/Status flag column — ported from
 * IDCHECKER's flag-driven photo sync (dataSync.ts processRows). A full ZIP
 * download + extract is expensive (~36 MB), so only rows that actually need a
 * face are pulled: brand-new IDs (never seen locally) and rows flagged 'n'
 * (new) or 'u'/'up' (update). Rows flagged 'd' (delete) are dropped from the
 * roster entirely and their local photo is removed. Unflagged, already-known
 * rows still get their metadata (name/flat/validTill) refreshed from the
 * sheet — only the photo pull is skipped for them.
 */
function classifyRosterRows(
  rows: Record<string, string>[],
  existingIds: Set<string>,
): { roster: RosterEntry[]; pullPhotoIds: string[]; deletedIds: string[] } {
  const roster: RosterEntry[] = [];
  const pullPhotoIds: string[] = [];
  const deletedIds: string[] = [];

  for (const row of rows) {
    const id = getCol(row, 'ID', 'Id', 'Student ID', 'StudentID');
    if (!id) continue;
    const flag = getCol(row, 'Update', 'update', 'Status', 'status').toLowerCase();

    if (flag === 'd') {
      deletedIds.push(id);
      continue;
    }

    roster.push({
      id,
      name: getCol(row, 'Name'),
      flat: getCol(row, 'Flat', 'Flat No', 'Flat Number', 'flat number'),
      validTill: getCol(row, 'ValidTill', 'Valid Till', 'Valid To'),
    });

    const isNew = !existingIds.has(id.trim().toLowerCase());
    if (isNew || flag === 'n' || flag === 'u' || flag === 'up') {
      pullPhotoIds.push(id);
    }
  }

  return { roster, pullPhotoIds, deletedIds };
}

/**
 * Pull the Google Sheet into the local database.
 * Subscriptions come from the amenities-payment sheet (gym/swimming/tennis/combo
 * tabs, columns APT NO. / AMENITY USER / Month / …); identity is the flat, and a
 * combo row is expanded into gym + swimming records. Roster + face photos still
 * come from the original read proxy.
 *
 * @param opts.photos when true (default), also download student photos.
 *   Pass { photos: false } to sync ONLY the subscription data quickly.
 *   Already-downloaded photos are still re-attached either way.
 * @param opts.onProgress optional live status reporter — called with a short
 *   message at each step (which sheet is being read, row counts, photo
 *   download progress) so the UI can show what's happening.
 * @param opts.forceAllPhotos when true, pull EVERY roster ID's photo — not
 *   just new/flagged ones. A one-time bulk re-sync (e.g. after clearing app
 *   data, moving to a new device, or backfilling photos for rows that were
 *   never flagged). Implies opts.photos, and explicitly uses the full ZIP
 *   instead of the per-face Drive folder.
 * @returns the number of subscription records stored.
 */
export async function syncStudents(
  opts: { photos?: boolean; onProgress?: OnProgress; forceAllPhotos?: boolean } = {},
): Promise<number> {
  const includePhotos = opts.forceAllPhotos || (opts.photos ?? true);
  const onProgress = opts.onProgress;

  // 1) Subscription details (APT NO. → amenity) — the gating data.
  // 2) Student roster (Student ID → Name/Flat) — for ID-based student lookup.
  // Independent reads — run concurrently instead of one Apps Script
  // round-trip after another.
  onProgress?.('Reading student roster: "Student id" tab…');
  const [students, rosterRows, logFamilyMembers] = await Promise.all([
    fetchSubscriptionStudents(onProgress),
    fetchCsvByGid(ROSTER_GID).then((rows) => {
      onProgress?.(`Student roster: ${rows.length} rows read`);
      return rows;
    }),
    fetchFamilyMembersFromLog(onProgress).catch((e) => {
      console.warn('Family check-in history fetch failed (leaving the family autofill list untouched):', e);
      return null;
    }),
  ]);
  const existingIds = new Set((await getRoster()).map((r) => r.id.trim().toLowerCase()));
  const { roster: newRoster, pullPhotoIds: flaggedPhotoIds, deletedIds } = classifyRosterRows(rosterRows, existingIds);
  let roster: RosterEntry[] = newRoster;
  // Normally only new/flagged IDs need a photo; forceAllPhotos bypasses that
  // and re-pulls every current roster ID's photo once.
  const pullPhotoIds = opts.forceAllPhotos ? roster.map((r) => r.id) : flaggedPhotoIds;
  onProgress?.(
    opts.forceAllPhotos
      ? `${roster.length} students in roster — re-syncing ALL photos, ${deletedIds.length} removed`
      : `${roster.length} students in roster — ${pullPhotoIds.length} need a photo, ${deletedIds.length} removed`,
  );

  // Family check-in autofill list: seeded from actual check-in history in the
  // attendance log (who has really been logged in as Family for each flat),
  // NOT from subscription payer names — the person who paid isn't necessarily
  // who checks in. This is what survives a reinstall, since the device-local
  // remembered-names history (rememberFamilyMember) is wiped every install.
  // Best-effort: if the log read itself failed, the previously-saved family
  // roster is left untouched rather than being wiped with an empty list.
  if (logFamilyMembers !== null) {
    onProgress?.(`Family check-in list: ${logFamilyMembers.length} names across all flats`);
    await saveFamilyRoster(logFamilyMembers);
  }

  // Optionally pull photos for the IDs that actually changed (new, or flagged
  // 'n'/'u'/'up') — skip photo work entirely when nothing needs one. Normal
  // syncs prefer the Drive "faces" folder: each wanted face is ~30 KB fetched
  // by name (concurrency 6), vs. downloading the whole multi-MB ZIP just to
  // extract a handful of files. Only fall back to the full ZIP if no faces
  // folder exists. The one-time bulk re-sync explicitly goes straight to the
  // full ZIP so every roster ID is refreshed from the canonical archive.
  // Photos are best-effort: a failure here must not abort the sync.
  if (includePhotos && pullPhotoIds.length > 0) {
    try {
      if (opts.forceAllPhotos) {
        onProgress?.('Downloading the full photos ZIP…');
        const zipBase64 = await fetchFacesZipBase64();
        onProgress?.(`Extracting ${pullPhotoIds.length} photo(s) from the ZIP…`);
        await importPhotosFromBase64(zipBase64, pullPhotoIds);
      } else {
        onProgress?.('Looking for the Drive "faces" folder…');
        const folderId = await getFacesFolderId();
        if (folderId) {
          onProgress?.(`Downloading ${pullPhotoIds.length} student photo(s)…`);
          await pullFacesFromFolder(folderId, pullPhotoIds, onProgress);
        } else {
          onProgress?.('No faces folder — downloading the full photos ZIP…');
          const zipBase64 = await fetchFacesZipBase64();
          onProgress?.(`Extracting ${pullPhotoIds.length} photo(s) from the ZIP…`);
          await importPhotosFromBase64(zipBase64, pullPhotoIds);
        }
      }
    } catch (e) {
      console.warn('Face photo sync failed (continuing without photos):', e);
      onProgress?.('Photo sync failed — continuing without photos');
    }
  } else if (includePhotos) {
    onProgress?.('No new/updated student photos to sync');
  }

  // Rows flagged 'd' are dropped from the roster above — also clean up their
  // extracted photo so a deleted student's face doesn't linger on disk.
  if (deletedIds.length > 0) {
    try {
      onProgress?.(`Removing ${deletedIds.length} deleted student photo(s)…`);
      await removePhotosById(deletedIds);
    } catch (e) {
      console.warn('Photo cleanup for deleted students failed (continuing):', e);
    }
  }

  // Re-attach any locally-available photos (cheap, no network) regardless, so a
  // data-only sync keeps photos fetched in a previous full sync. Named by ID.
  try {
    roster = await attachLocalPhotos(roster, (r) => r.id);
  } catch {
    /* ignore */
  }

  // Return the stored (deduped) count, not the raw row count, so the number
  // shown right after sync matches what's persisted and re-shown on re-entry.
  onProgress?.('Saving…');
  const storedCount = await saveLocalStudents(students);
  await saveRoster(roster);
  await setLastSyncTime(new Date().toISOString());
  return storedCount;
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
    await setLastSyncError(null);
  } catch (e: any) {
    console.warn('Auto-sync failed (will retry later):', e);
    // Not surfaced via a dialog (this runs silently in the background), but
    // recorded so the home screen can show a prominent banner until the next
    // sync succeeds — otherwise a network outage fails invisibly forever.
    await setLastSyncError(e?.message || 'Sync failed — check network connection');
  } finally {
    _autoSyncing = false;
  }
}
