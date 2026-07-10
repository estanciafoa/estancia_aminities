// Kiosk-side Razorpay QR payments. Talks to the apps-script/razorpay-payments.gs
// web app: fetch packages/prices, create a dynamic UPI QR for the selected
// amenities, and poll until the payment is confirmed.

// Deployed razorpay-payments.gs /exec URL. PASTE IT HERE after deploying that
// script. Leave '' until then — the Pay flow surfaces a clear error if unset.
const PAY_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbzyKljj-NXH4RT5L6mDp6Fob1dbpD6oqGRRexVbqKbkfseq1k8zBCo6pmsU98Xd-JgM/exec';
// Must match PAY_TOKEN in razorpay-payments.gs.
const PAY_TOKEN = 'Admin2026';

// The amenities a resident can pay for at the gate.
export const PAYABLE_AMENITIES = ['gym', 'swimming', 'tennis'] as const;

export interface AmenityPackage {
  category: string; // "student" | "family" (prices differ by category)
  key: string;
  label: string;
  amount: number;
  covers: string[]; // amenities this package grants
}

export interface QrInfo {
  qrId: string; // Razorpay payment-link id (used for status polling)
  payUrl: string; // the payment link URL — rendered as a QR on the kiosk
  amount: number;
  covers: string[];
}

export interface QrStatus {
  paid: boolean;
  covers?: string[];
  amount?: number;
}

export interface DayPayment {
  id: string;
  amount: number; // rupees
  method: string;
  flat: string;
  name: string;
  covers: string; // comma-joined amenities, from the link notes
  month: string;
  created_at: number; // Unix seconds (UTC)
}

export interface DayTransactions {
  date: string; // YYYY-MM-DD (IST)
  count: number;
  total_rupees: number;
  payments: DayPayment[];
}

export function isPaymentConfigured(): boolean {
  return !!PAY_APPS_SCRIPT_URL;
}

function ensureConfigured(): void {
  if (!PAY_APPS_SCRIPT_URL) {
    throw new Error('Payments not set up yet — paste the Razorpay web-app URL into payments.ts.');
  }
}

/** Normalize an amenity set into a stable "gym+swimming" key. */
function setKey(a: string[]): string {
  return Array.from(new Set(a.map((s) => s.trim().toLowerCase()).filter(Boolean))).sort().join('+');
}

/** The price for an exact amenity selection in a category, or null if none. */
export function amountForSet(
  pkgs: AmenityPackage[],
  selected: string[],
  category: string,
): number | null {
  const want = setKey(selected);
  const cat = category.trim().toLowerCase();
  if (!want) return null;
  for (const p of pkgs) if (p.category === cat && setKey(p.covers) === want) return p.amount;
  return null;
}

/** Current billing month as the app/sheet formats it, e.g. "Jul 2026". */
export function currentMonthLabel(): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date();
  return names[d.getMonth()] + ' ' + d.getFullYear();
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Payment service unreachable or not deployed.');
  }
  if (!data.ok) throw new Error(data.error || 'Payment request failed');
  return data.result || {};
}

export async function fetchPackages(): Promise<AmenityPackage[]> {
  ensureConfigured();
  const url = `${PAY_APPS_SCRIPT_URL}?action=packages&token=${encodeURIComponent(PAY_TOKEN)}`;
  const res = await fetch(url, { redirect: 'follow' });
  const result = await readJson(res);
  return (result.packages || []) as AmenityPackage[];
}

export async function createQr(input: {
  category: string;
  flat: string;
  name: string;
  amenities: string[];
  month: string;
}): Promise<QrInfo> {
  ensureConfigured();
  const res = await fetch(PAY_APPS_SCRIPT_URL, {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'create_qr', token: PAY_TOKEN, ...input }),
  });
  const r = await readJson(res);
  return { qrId: r.qr_id, payUrl: r.pay_url, amount: r.amount, covers: r.covers || [] };
}

export async function checkQrStatus(qrId: string): Promise<QrStatus> {
  ensureConfigured();
  const url =
    `${PAY_APPS_SCRIPT_URL}?action=qr_status&id=${encodeURIComponent(qrId)}` +
    `&token=${encodeURIComponent(PAY_TOKEN)}`;
  const res = await fetch(url, { redirect: 'follow' });
  return (await readJson(res)) as QrStatus;
}

/** Today's date as the Razorpay day-report expects it: "YYYY-MM-DD" (IST). */
export function todayISO(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/** Every Razorpay payment captured on the given IST day (defaults to today).
 *  Reads Razorpay directly — the actual money, for admin reconciliation. */
export async function fetchDayTransactions(dateISO?: string): Promise<DayTransactions> {
  ensureConfigured();
  const date = (dateISO || '').trim();
  const url =
    `${PAY_APPS_SCRIPT_URL}?action=day_txns&token=${encodeURIComponent(PAY_TOKEN)}` +
    (date ? `&date=${encodeURIComponent(date)}` : '');
  const res = await fetch(url, { redirect: 'follow' });
  const r = (await readJson(res)) as DayTransactions;
  return { date: r.date, count: r.count || 0, total_rupees: r.total_rupees || 0, payments: r.payments || [] };
}
