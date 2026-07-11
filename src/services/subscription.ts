import { checkedInKey, getDeployedAmenity, isFlatPaidThisMonth, isStudentPaidThisMonth, type Category } from './storage';
import { evaluateEntry } from './session';

// 'LIMIT' = allowed by payment but blocked by the daily frequency / 2-hour rule.
// Kept distinct from 'DENIED' so time-limit blocks don't show up as unpaid
// defaulters in the reports.
export type Decision = 'PAID' | 'WARN' | 'REGISTER' | 'DENIED' | 'LIMIT' | 'NA';

export interface DecisionResult {
  decision: Decision;
  allowed: boolean; // whether the person is recorded as checked-in
  buzzer: boolean; // play the denial buzzer
  overlay: boolean; // show the full-screen message
  title: string;
  message: string;
}

const WARN_MSG =
  'Your amenity subscription for this month has not been paid yet. Kindly make the payment immediately to avoid denial of entry to the amenity.';
const REGISTER_MSG =
  'Your subscription for this month is still unpaid. Please clear the dues without further delay. For now, record your entry in the physical register at the desk — kindly do not rely on the app.';
const DENIED_MSG =
  'Entry to the amenity is denied. Your subscription for this month has not been paid. Please clear the dues to regain access.';
const STUDENT_NOTEBOOK_MSG =
  'Your subscription for this month has not been paid yet. For now, please record your entry in the notebook at the desk and clear the dues at the earliest.';

/**
 * Pure decision based on category, paid-this-month status, and day of month.
 * Family: <5 warn, 5–10 register (still allowed), >10 denied.
 * Student: unpaid on/before the 5th → notebook (allowed), after the 5th → denied.
 * Guest: never checked.
 */
export function decide(category: Category, paid: boolean, dayOfMonth: number): DecisionResult {
  if (category === 'Guest') {
    return { decision: 'NA', allowed: true, buzzer: false, overlay: false, title: '', message: '' };
  }
  if (paid) {
    return { decision: 'PAID', allowed: true, buzzer: false, overlay: false, title: '', message: '' };
  }

  if (category === 'Student') {
    // Unpaid: on/before the 5th → allow but record in the notebook; after → deny.
    if (dayOfMonth <= 5) {
      return { decision: 'REGISTER', allowed: true, buzzer: false, overlay: true, title: 'Subscription Not Paid', message: STUDENT_NOTEBOOK_MSG };
    }
    return { decision: 'DENIED', allowed: false, buzzer: true, overlay: true, title: 'Entry Denied', message: DENIED_MSG };
  }

  // Family
  if (dayOfMonth < 5) {
    return { decision: 'WARN', allowed: true, buzzer: false, overlay: true, title: 'Payment Pending', message: WARN_MSG };
  }
  if (dayOfMonth <= 10) {
    return { decision: 'REGISTER', allowed: true, buzzer: false, overlay: true, title: 'Payment Overdue', message: REGISTER_MSG };
  }
  return { decision: 'DENIED', allowed: false, buzzer: true, overlay: true, title: 'Entry Denied', message: DENIED_MSG };
}

/** Resolve paid-this-month status and apply the date-band decision. */
export async function decideEntry(input: {
  category: Category;
  flat?: string;
  name?: string;
  studentId?: string;
}): Promise<DecisionResult> {
  const day = new Date().getDate();
  if (input.category === 'Guest') return decide('Guest', false, day);
  const amenity = await getDeployedAmenity();
  // Students must match the flat + name combination in the subscription rows.
  // Family matches by flat (any resident). Category still drives the date band.
  const paid =
    input.category === 'Student'
      ? await isStudentPaidThisMonth(input.flat || '', input.name || '', amenity)
      : await isFlatPaidThisMonth(input.flat || '', amenity);
  const result = decide(input.category, paid, day);

  // Payment says they may enter — now apply the daily frequency / 2-hour rule.
  // A block here overrides to a LIMIT denial (buzzer + full-screen message).
  if (result.allowed) {
    const key = checkedInKey(input.category, {
      flat: input.flat,
      name: input.name,
      studentId: input.studentId,
    });
    const gate = await evaluateEntry(key);
    if (!gate.allowed) {
      return {
        decision: 'LIMIT',
        allowed: false,
        buzzer: true,
        overlay: true,
        title: gate.title || 'Entry Denied',
        message: gate.message || 'Re-entry is not allowed right now.',
      };
    }
  }
  return result;
}
