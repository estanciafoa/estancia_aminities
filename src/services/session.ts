import AsyncStorage from '@react-native-async-storage/async-storage';

// Device-local per-person, per-day amenity session ledger. Enforces:
//  • one session per day — after checkout, re-entry is only allowed within a
//    short grace window; a longer gap means the session is over for the day;
//  • multiple check-ins inside the grace window collapse into ONE session
//    (the clock runs from the FIRST check-in, never reset by re-entry);
//  • a hard cap on total workout time from the first check-in.
// This is intentionally offline and gate-fast — it never hits the network.

const SESSIONS_KEY = '@estancia_amenities_sessions';

// A checkout→checkin gap up to this is the SAME session; beyond it, entry is
// denied for the rest of the day.
export const REENTRY_GRACE_MS = 30 * 60 * 1000; // 30 minutes
// Maximum amenity time allowed in a day, measured from the first check-in.
export const SESSION_MAX_MS = 2 * 60 * 60 * 1000; // 2 hours

export interface DaySession {
  key: string; // checkedInKey — unique per person
  day: string; // YYYY-MM-DD (local) the session belongs to
  firstInAt: string; // ISO — first check-in of the day (drives the 2h cap)
  lastOutAt: string | null; // ISO — most recent checkout, or null if never out
  insideNow: boolean;
}

export type GateCode = 'OK_NEW' | 'OK_CONTINUE' | 'DENY_GAP' | 'DENY_MAXTIME';

export interface GateResult {
  allowed: boolean;
  code: GateCode;
  title?: string;
  message?: string;
}

/** Local day key (YYYY-MM-DD). Kept here so this module has no storage import. */
export function sessionDayKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function readAll(): Promise<DaySession[]> {
  const raw = await AsyncStorage.getItem(SESSIONS_KEY);
  const list: DaySession[] = raw ? JSON.parse(raw) : [];
  // Drop anything from an earlier day so the ledger stays small and today-only.
  const today = sessionDayKey();
  return list.filter((s) => s.day === today);
}

async function writeAll(list: DaySession[]): Promise<void> {
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
}

/** Today's session for this person, or null. */
export async function getSession(key: string): Promise<DaySession | null> {
  const list = await readAll();
  return list.find((s) => s.key === key) || null;
}

/**
 * Decide whether a check-in is allowed under the frequency / time rules — call
 * BEFORE recording the check-in. Returns OK for a fresh day, a re-entry while
 * still inside, or a re-entry within the grace window; DENY when the day's
 * session is over (gap too large) or the 2-hour cap is reached.
 */
export async function evaluateEntry(key: string, now = Date.now()): Promise<GateResult> {
  const s = await getSession(key);
  if (!s) return { allowed: true, code: 'OK_NEW' };

  const firstIn = Date.parse(s.firstInAt);
  const elapsed = isFinite(firstIn) ? now - firstIn : 0;

  // 2-hour cap dominates — even a valid re-entry can't exceed the day's max.
  if (elapsed >= SESSION_MAX_MS) {
    return {
      allowed: false,
      code: 'DENY_MAXTIME',
      title: 'Time Limit Reached',
      message:
        'You have completed the maximum 2 hours of amenity time for today. Please check out — re-entry is not allowed until tomorrow.',
    };
  }

  // Already inside → a duplicate scan; treat as one session, allow.
  if (s.insideNow) return { allowed: true, code: 'OK_CONTINUE' };

  // Outside and previously checked out: only a short gap re-opens the session.
  if (s.lastOutAt) {
    const gap = now - Date.parse(s.lastOutAt);
    if (isFinite(gap) && gap > REENTRY_GRACE_MS) {
      return {
        allowed: false,
        code: 'DENY_GAP',
        title: 'Already Used Today',
        message:
          'You checked out more than 30 minutes ago. Only one amenity session is allowed per day — please come back tomorrow.',
      };
    }
  }
  return { allowed: true, code: 'OK_CONTINUE' };
}

/**
 * Record a check-in. Starts today's session on the first entry; a re-entry
 * marks the person inside again WITHOUT resetting firstInAt (so the 2h cap and
 * "one session" rule both measure from the first check-in of the day).
 */
export async function recordCheckIn(key: string, at = Date.now()): Promise<void> {
  const list = await readAll();
  const iso = new Date(at).toISOString();
  const existing = list.find((s) => s.key === key);
  if (existing) {
    existing.insideNow = true;
  } else {
    list.push({ key, day: sessionDayKey(), firstInAt: iso, lastOutAt: null, insideNow: true });
  }
  await writeAll(list);
}

/** Record a check-out (manual or auto): stamps lastOutAt and marks not-inside. */
export async function recordCheckOut(key: string, at = Date.now()): Promise<void> {
  const list = await readAll();
  const existing = list.find((s) => s.key === key);
  if (!existing) return; // never checked in today — nothing to close
  existing.insideNow = false;
  existing.lastOutAt = new Date(at).toISOString();
  await writeAll(list);
}
