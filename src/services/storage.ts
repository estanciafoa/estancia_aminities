import AsyncStorage from '@react-native-async-storage/async-storage';

const STUDENTS_KEY = '@estancia_amenities_students';
const LAST_SYNC_KEY = '@estancia_amenities_last_sync';

export interface Student {
  flat: string; // Flat No — the lookup key (the sheet has no per-person ID)
  name: string;
  month: string;
  status: string;
  type: string; // "Student" or "Family"
  amenity: string; // lowercased single amenity this row paid for ("Paid for")
  local_photo?: string; // file:// uri of the face photo extracted from the Drive ZIP
}

// In-memory cache of ALL subscription records (one row per flat+amenity+month).
let _cache: Student[] | null = null;

// --- current-month helpers ---------------------------------------------------

/** Lowercased current month name, e.g. "june". */
export function currentMonthKey(): string {
  return new Date().toLocaleString('en-US', { month: 'long' }).toLowerCase();
}

/** Tolerant match of a sheet Month value against the current month ("Jun"/"June"/"JUNE"). */
export function monthMatchesCurrent(month: string): boolean {
  const cur = currentMonthKey(); // "june"
  const rec = (month || '').trim().toLowerCase();
  if (!rec) return false;
  return rec === cur || cur.startsWith(rec) || rec.startsWith(cur.slice(0, 3));
}

// --- subscription records ----------------------------------------------------

export async function getLocalStudents(): Promise<Student[]> {
  if (_cache) return _cache;
  const data = await AsyncStorage.getItem(STUDENTS_KEY);
  _cache = data ? JSON.parse(data) : [];
  return _cache!;
}

export async function saveLocalStudents(students: Student[]): Promise<void> {
  // Deduplicate by flat+name+amenity+month so every subscription row is kept
  // (a flat may have several rows — e.g. gym + tennis, or family + student).
  const map = new Map<string, Student>();
  for (const s of students) {
    const k = `${s.flat}|${s.name}|${s.amenity}|${s.month}`.trim().toLowerCase();
    map.set(k, s);
  }
  const deduped = Array.from(map.values());
  await AsyncStorage.setItem(STUDENTS_KEY, JSON.stringify(deduped));
  _cache = deduped;
}

/**
 * Locally record a just-completed payment so gating passes immediately (before
 * the next sheet sync). One Paid record per amenity for the current month; the
 * backend also writes the durable sheet row. Dedup in saveLocalStudents handles
 * repeats.
 */
export async function addPaidSubscriptions(
  flat: string,
  name: string,
  amenities: string[],
  month: string,
): Promise<void> {
  const all = await getLocalStudents();
  const additions: Student[] = amenities.map((a) => ({
    flat: flat.trim(),
    name: name.trim(),
    month,
    status: 'Paid',
    type: '',
    amenity: a.trim().toLowerCase(),
  }));
  await saveLocalStudents([...all, ...additions]);
}

/** Best record for a flat: the current-month row if present, else any row (for display). */
export async function getStudentByFlat(flat: string): Promise<Student | null> {
  const all = await getLocalStudents();
  const key = flat.trim().toLowerCase();
  if (!key) return null;
  const matches = all.filter((s) => s.flat.trim().toLowerCase() === key);
  if (matches.length === 0) return null;
  return matches.find((s) => monthMatchesCurrent(s.month)) || matches[0];
}

/** True if the record covers the given amenity (empty amenity = no filter). */
function coversAmenity(s: Student, amenity: string): boolean {
  const a = amenity.trim().toLowerCase();
  if (!a) return true;
  return (s.amenity || '').trim().toLowerCase() === a;
}

// --- tolerant name matching (case-insensitive, trimmed, typo-tolerant) -------

/** Lowercase, strip punctuation, collapse whitespace. */
function normalizeName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein edit distance (iterative, O(n) space). */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}

/** Two name WORDS are similar: exact, containment, or a small typo. */
function tokensSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen < 4) return false; // short words / initials must match exactly
  if (a.includes(b) || b.includes(a)) return true;
  return levenshtein(a, b) <= Math.max(1, Math.floor(maxLen * 0.2));
}

/**
 * True if two names plausibly refer to the same person. Case-insensitive,
 * trimmed, tolerant of extra spaces and small spelling mistakes. The FIRST NAME
 * (first significant word, >= 3 letters) must match; trailing last names and
 * initials are ignored. Examples:
 *   "Saravanan Sengamalam" ~ "saravanan" ~ "saravanan.s" ~ "saravanan. s"   (match)
 *   "Saravanan Sengamalam" vs "sengamalam"                                    (NO match)
 */
export function namesSimilar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sigA = na.split(' ').filter((t) => t.length >= 3);
  const sigB = nb.split(' ').filter((t) => t.length >= 3);
  if (!sigA.length || !sigB.length) {
    // No significant word on one side — fall back to whole-string compare.
    return na.replace(/\s/g, '') === nb.replace(/\s/g, '');
  }
  // First name must agree (last names / initials are optional).
  return tokensSimilar(sigA[0], sigB[0]);
}

/**
 * Whether a STUDENT (flat + name combination) has ANY subscription row for the
 * (deployed) amenity — regardless of month. Used to distinguish "no subscription
 * at all" (block entry) from "subscription not paid this month" (date rule).
 */
export async function hasStudentSubscription(
  flat: string,
  name: string,
  amenity = '',
): Promise<boolean> {
  const all = await getLocalStudents();
  const fkey = flat.trim().toLowerCase();
  if (!fkey) return false;
  return all.some(
    (s) =>
      s.flat.trim().toLowerCase() === fkey &&
      coversAmenity(s, amenity) &&
      namesSimilar(s.name, name),
  );
}

/**
 * Paid this month for a STUDENT: requires the flat + name combination to exist
 * in the subscription rows for the (deployed) amenity. Name match is tolerant.
 */
export async function isStudentPaidThisMonth(
  flat: string,
  name: string,
  amenity = '',
): Promise<boolean> {
  const all = await getLocalStudents();
  const fkey = flat.trim().toLowerCase();
  if (!fkey) return false;
  return all.some(
    (s) =>
      s.flat.trim().toLowerCase() === fkey &&
      monthMatchesCurrent(s.month) &&
      coversAmenity(s, amenity) &&
      namesSimilar(s.name, name),
  );
}

/** Paid this month by flat for the given (deployed) amenity (any resident). */
export async function isFlatPaidThisMonth(flat: string, amenity = ''): Promise<boolean> {
  const all = await getLocalStudents();
  const key = flat.trim().toLowerCase();
  if (!key) return false;
  return all.some(
    (s) => s.flat.trim().toLowerCase() === key && monthMatchesCurrent(s.month) && coversAmenity(s, amenity),
  );
}

/** Distinct amenities seen across all synced subscriptions (for the admin picker). */
export async function getAmenityOptions(): Promise<string[]> {
  const all = await getLocalStudents();
  const set = new Set<string>();
  for (const s of all) if (s.amenity) set.add(s.amenity.trim().toLowerCase());
  return Array.from(set).sort();
}

export async function preloadStudents(): Promise<number> {
  const students = await getLocalStudents();
  return students.length;
}

export async function getLastSyncTime(): Promise<string | null> {
  return await AsyncStorage.getItem(LAST_SYNC_KEY);
}

export async function setLastSyncTime(time: string): Promise<void> {
  await AsyncStorage.setItem(LAST_SYNC_KEY, time);
}

export async function clearLocalStudents(): Promise<void> {
  await AsyncStorage.multiRemove([STUDENTS_KEY, ROSTER_KEY, FAMILY_ROSTER_KEY, LAST_SYNC_KEY]);
  _cache = null;
  _roster = null;
  _familyRoster = null;
}

// --- student roster (id → flat/name/photo) -----------------------------------
// Separate "Student id" tab (gid 0): Name, Flat, ValidFrom, ValidTill, …, ID.
// Students check in by ID; we resolve their flat here, then gate on the flat's
// subscription. Face photos are named by this ID.

const ROSTER_KEY = '@estancia_amenities_roster';

export interface RosterEntry {
  id: string; // Student ID — the lookup key
  name: string;
  flat: string;
  validTill?: string;
  local_photo?: string;
}

let _roster: RosterEntry[] | null = null;

export async function getRoster(): Promise<RosterEntry[]> {
  if (_roster) return _roster;
  const data = await AsyncStorage.getItem(ROSTER_KEY);
  _roster = data ? JSON.parse(data) : [];
  return _roster!;
}

export async function saveRoster(entries: RosterEntry[]): Promise<void> {
  const map = new Map<string, RosterEntry>();
  for (const e of entries) if (e.id) map.set(e.id.trim().toLowerCase(), e);
  const deduped = Array.from(map.values());
  await AsyncStorage.setItem(ROSTER_KEY, JSON.stringify(deduped));
  _roster = deduped;
}

/** Resolve a student by their ID (from the roster tab). */
export async function getRosterById(id: string): Promise<RosterEntry | null> {
  const all = await getRoster();
  const key = id.trim().toLowerCase();
  if (!key) return null;
  return all.find((e) => e.id.trim().toLowerCase() === key) || null;
}

// ---- Admin config (deployed amenity + passcode) ----

const DEPLOYED_AMENITY_KEY = '@estancia_amenities_deployed_amenity';
const ADMIN_PASSCODE_KEY = '@estancia_amenities_admin_passcode';
const DEFAULT_ADMIN_PASSCODE = '1234';

/** The amenity this device gates entry for (e.g. "gym"). '' if unset. */
export async function getDeployedAmenity(): Promise<string> {
  return (await AsyncStorage.getItem(DEPLOYED_AMENITY_KEY)) || '';
}

export async function setDeployedAmenity(amenity: string): Promise<void> {
  await AsyncStorage.setItem(DEPLOYED_AMENITY_KEY, amenity.trim().toLowerCase());
}

export async function getAdminPasscode(): Promise<string> {
  return (await AsyncStorage.getItem(ADMIN_PASSCODE_KEY)) || DEFAULT_ADMIN_PASSCODE;
}

export async function setAdminPasscode(code: string): Promise<void> {
  await AsyncStorage.setItem(ADMIN_PASSCODE_KEY, code);
}

// ---- Auto-checkout policy (close stale "inside" sessions) ----

const AUTO_CHECKOUT_HOURS_KEY = '@estancia_amenities_auto_checkout_hours';
const DEFAULT_AUTO_CHECKOUT_HOURS = 4;

/** Max hours a person may stay 'inside' before being auto-checked-out. */
export async function getAutoCheckoutHours(): Promise<number> {
  const v = await AsyncStorage.getItem(AUTO_CHECKOUT_HOURS_KEY);
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AUTO_CHECKOUT_HOURS;
}

export async function setAutoCheckoutHours(hours: number): Promise<void> {
  await AsyncStorage.setItem(AUTO_CHECKOUT_HOURS_KEY, String(hours));
}

// ---- Daily stats (local, offline) — powers the home dashboard ----

const DAILY_STATS_KEY = '@estancia_amenities_daily_stats';

export interface DayStat {
  in: number;
  out: number;
}

/** Local date key YYYY-MM-DD (device timezone). */
export function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type DailyStats = Record<string, DayStat>;

/** Increment today's IN/OUT counter (called from the log queue on every event). */
export async function bumpDailyStat(direction: 'IN' | 'OUT'): Promise<void> {
  const raw = await AsyncStorage.getItem(DAILY_STATS_KEY);
  const stats: DailyStats = raw ? JSON.parse(raw) : {};
  const key = todayKey();
  const day = stats[key] || { in: 0, out: 0 };
  if (direction === 'IN') day.in += 1;
  else day.out += 1;
  stats[key] = day;
  // Keep the store small: drop entries older than ~60 days.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 60);
  for (const k of Object.keys(stats)) {
    if (new Date(k) < cutoff) delete stats[k];
  }
  await AsyncStorage.setItem(DAILY_STATS_KEY, JSON.stringify(stats));
}

export async function getTodayStats(): Promise<DayStat> {
  const raw = await AsyncStorage.getItem(DAILY_STATS_KEY);
  const stats: DailyStats = raw ? JSON.parse(raw) : {};
  return stats[todayKey()] || { in: 0, out: 0 };
}

// ---- Family autofill history (remembered only for Family entries) ----

const FAMILY_HISTORY_KEY = '@estancia_amenities_family_history';

export interface FamilyMember {
  name: string;
  gender: string; // 'M' | 'F'
}

type FamilyHistory = Record<string, FamilyMember[]>; // keyed by lowercased flat

async function getFamilyHistory(): Promise<FamilyHistory> {
  const data = await AsyncStorage.getItem(FAMILY_HISTORY_KEY);
  return data ? JSON.parse(data) : {};
}

export async function getFamilyMembers(flat: string): Promise<FamilyMember[]> {
  const key = flat.trim().toLowerCase();
  if (!key) return [];
  const history = await getFamilyHistory();
  return history[key] || [];
}

export async function rememberFamilyMember(
  flat: string,
  name: string,
  gender: string,
): Promise<void> {
  const key = flat.trim().toLowerCase();
  const trimmedName = name.trim();
  if (!key || !trimmedName) return;
  const history = await getFamilyHistory();
  const list = history[key] || [];
  const idx = list.findIndex((m) => m.name.trim().toLowerCase() === trimmedName.toLowerCase());
  if (idx >= 0) list[idx] = { name: trimmedName, gender };
  else list.push({ name: trimmedName, gender });
  history[key] = list;
  await AsyncStorage.setItem(FAMILY_HISTORY_KEY, JSON.stringify(history));
}

// ---- Family roster (synced from an optional "Family Members" sheet tab) ----
// Pre-seeds the per-flat family list (with gender) so a freshly-installed device
// shows residents before anyone has checked in. Merged with the local history
// and the subscription names in getFamilySuggestions().

const FAMILY_ROSTER_KEY = '@estancia_amenities_family_roster';

type FamilyRoster = Record<string, FamilyMember[]>; // keyed by lowercased flat
let _familyRoster: FamilyRoster | null = null;

async function getFamilyRoster(): Promise<FamilyRoster> {
  if (_familyRoster) return _familyRoster;
  const data = await AsyncStorage.getItem(FAMILY_ROSTER_KEY);
  _familyRoster = data ? JSON.parse(data) : {};
  return _familyRoster!;
}

/** Replace the synced family roster (called from syncStudents). */
export async function saveFamilyRoster(
  entries: { flat: string; name: string; gender: string }[],
): Promise<void> {
  const map: FamilyRoster = {};
  for (const e of entries) {
    const key = e.flat.trim().toLowerCase();
    const name = e.name.trim();
    if (!key || !name) continue;
    const list = map[key] || (map[key] = []);
    if (!list.some((m) => m.name.trim().toLowerCase() === name.toLowerCase())) {
      list.push({ name, gender: e.gender === 'F' || e.gender === 'M' ? e.gender : '' });
    }
  }
  await AsyncStorage.setItem(FAMILY_ROSTER_KEY, JSON.stringify(map));
  _familyRoster = map;
}

/**
 * Family members to offer for a flat, merged from two sources and de-duped by
 * (normalized) name: the synced Family Members roster (has gender) and
 * locally-remembered check-ins (has gender). Gender precedence: roster > history.
 *
 * We deliberately do NOT seed from the subscription rows: on a family flat the
 * subscription name is the OWNER who paid the fee, not the family members who
 * actually check in. So the resident picks a previously-used name or types a new
 * one (remembered for next time). Family gating is by flat-paid-this-month, so
 * the chosen name never affects whether entry is allowed.
 */
export async function getFamilySuggestions(flat: string): Promise<FamilyMember[]> {
  const key = flat.trim().toLowerCase();
  if (!key) return [];
  const [roster, history] = await Promise.all([
    getFamilyRoster(),
    getFamilyMembers(flat),
  ]);

  const byName = new Map<string, FamilyMember>();
  const add = (name: string, gender: string) => {
    const n = (name || '').trim();
    if (!n) return;
    const g = gender === 'F' || gender === 'M' ? gender : '';
    const k = normalizeName(n);
    if (!k) return;
    const existing = byName.get(k);
    if (!existing) byName.set(k, { name: n, gender: g });
    else if (!existing.gender && g) existing.gender = g; // fill missing gender
  };

  for (const m of roster[key] || []) add(m.name, m.gender);
  for (const m of history) add(m.name, m.gender);
  return Array.from(byName.values());
}

// ---- Checked-in registry (device-local; powers the Check-Out flow) ----

const CHECKED_IN_KEY = '@estancia_amenities_checked_in';

export type Category = 'Family' | 'Student' | 'Guest';

export interface CheckedInEntry {
  key: string; // unique per person currently inside
  category: Category;
  flat: string;
  name: string;
  gender: string;
  student_id: string;
  checkInAt: string; // ISO
}

export function checkedInKey(
  category: Category,
  opts: { flat?: string; name?: string; studentId?: string },
): string {
  // Students are keyed by their ID; Family/Guest by flat + name.
  if (category === 'Student') return `S:${(opts.studentId || '').trim().toLowerCase()}`;
  return `${category}:${(opts.flat || '').trim().toLowerCase()}:${(opts.name || '').trim().toLowerCase()}`;
}

export async function getCheckedIn(): Promise<CheckedInEntry[]> {
  const data = await AsyncStorage.getItem(CHECKED_IN_KEY);
  return data ? JSON.parse(data) : [];
}

export async function addCheckedIn(entry: CheckedInEntry): Promise<void> {
  const list = await getCheckedIn();
  const filtered = list.filter((e) => e.key !== entry.key);
  filtered.push(entry);
  await AsyncStorage.setItem(CHECKED_IN_KEY, JSON.stringify(filtered));
}

export async function removeCheckedIn(key: string): Promise<void> {
  const list = await getCheckedIn();
  await AsyncStorage.setItem(CHECKED_IN_KEY, JSON.stringify(list.filter((e) => e.key !== key)));
}

export async function getCheckedInByFlat(flat: string): Promise<CheckedInEntry[]> {
  const list = await getCheckedIn();
  const key = flat.trim().toLowerCase();
  return list.filter((e) => e.flat.trim().toLowerCase() === key);
}
