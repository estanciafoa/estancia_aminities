import { enqueueLog } from './log-queue';
import { getSession, SESSION_MAX_MS } from './session';
import { getAutoCheckoutHours, getCheckedIn, removeCheckedIn, todayKey } from './storage';

/**
 * Close stale "inside" sessions: anyone still checked in from a previous day,
 * past the 2-hour workout cap (measured from their FIRST check-in of the day),
 * or longer than the configured backstop max hours. Each is logged as an OUT
 * with status 'AUTO' and removed from the device-local registry. Safe to call
 * often. Returns the number of sessions auto-closed.
 */
export async function autoCheckoutStale(): Promise<number> {
  const list = await getCheckedIn();
  if (list.length === 0) return 0;

  const maxHours = await getAutoCheckoutHours();
  const today = todayKey();
  const now = Date.now();
  let closed = 0;

  for (const e of list) {
    const at = new Date(e.checkInAt);
    // The 2-hour cap runs from the FIRST check-in of the day, so a re-entry
    // (which bumps the registry's checkInAt) can't extend the workout. Fall
    // back to checkInAt if no session record is found.
    const session = await getSession(e.key);
    const firstIn = session ? Date.parse(session.firstInAt) : at.getTime();
    const ageMs = now - (isFinite(firstIn) ? firstIn : at.getTime());
    const ageHours = ageMs / 3_600_000;
    const fromEarlierDay = isFinite(at.getTime()) && dayKey(at) !== today;
    if (!(fromEarlierDay || ageMs >= SESSION_MAX_MS || ageHours >= maxHours)) continue;

    await enqueueLog({
      category: e.category,
      flat: e.flat,
      name: e.name,
      gender: e.gender,
      student_id: e.student_id,
      direction: 'OUT',
      subscription: 'AUTO',
    });
    await removeCheckedIn(e.key);
    closed += 1;
  }
  return closed;
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
