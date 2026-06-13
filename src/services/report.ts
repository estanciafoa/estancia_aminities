import { fetchLogRows, type LogRow } from './sheets';

export type ReportMode = 'daily' | 'monthly';

/** "2026-06-12 15:53:56 IST" -> { date:"2026-06-12", hour:15 } */
function parseTs(ts: string): { date: string; ym: string; hour: number } {
  const t = (ts || '').trim();
  const date = t.slice(0, 10);
  const ym = t.slice(0, 7);
  const hour = Number(t.slice(11, 13));
  return { date, ym, hour: Number.isFinite(hour) ? hour : -1 };
}

export function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function thisMonthStr(): string {
  return todayStr().slice(0, 7);
}

interface Stats {
  total: number;
  ins: number;
  outs: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
  denied: number;
  uniqueFlats: number;
  uniquePeople: number;
  male: number;
  female: number;
  peakHour: number;
  peakHourCount: number;
}

function aggregate(rows: LogRow[]): Stats {
  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const flats = new Set<string>();
  const people = new Set<string>();
  const hours = new Array(24).fill(0);
  let ins = 0;
  let outs = 0;
  let denied = 0;
  let male = 0;
  let female = 0;

  for (const r of rows) {
    const dir = (r.direction || '').toUpperCase();
    if (dir === 'OUT') outs++;
    else ins++;

    if (dir !== 'OUT') {
      // Count check-ins for category/status breakdowns.
      byCategory[r.category || '—'] = (byCategory[r.category || '—'] || 0) + 1;
      const st = (r.subscription || 'NA').toUpperCase();
      byStatus[st] = (byStatus[st] || 0) + 1;
      if (st === 'DENIED') denied++;
      const g = (r.gender || '').toUpperCase();
      if (g === 'M') male++;
      else if (g === 'F') female++;
      const { hour } = parseTs(r.timestamp);
      if (hour >= 0) hours[hour]++;
    }

    if (r.flat) flats.add(r.flat.trim().toLowerCase());
    people.add(r.student_id ? `s:${r.student_id}` : `${r.flat}|${r.name}`.toLowerCase());
  }

  let peakHour = -1;
  let peakHourCount = 0;
  hours.forEach((c, h) => {
    if (c > peakHourCount) {
      peakHourCount = c;
      peakHour = h;
    }
  });

  return {
    total: rows.length,
    ins,
    outs,
    byCategory,
    byStatus,
    denied,
    uniqueFlats: flats.size,
    uniquePeople: people.size,
    male,
    female,
    peakHour,
    peakHourCount,
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  Family: '#208AEF',
  Student: '#7C3AED',
  Guest: '#0F766E',
};
const PALETTE = ['#208AEF', '#7C3AED', '#0F766E', '#D97706', '#DC2626', '#475569'];

function pieSvg(data: { label: string; value: number; color: string }[]): string {
  const cx = 110;
  const cy = 110;
  const r = 100;
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return `<svg width="220" height="220"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#E2E8F0"/></svg>`;
  }
  const nonZero = data.filter((d) => d.value > 0);
  let body = '';
  if (nonZero.length === 1) {
    body = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${nonZero[0].color}"/>`;
  } else {
    let angle = -Math.PI / 2;
    for (const d of nonZero) {
      const slice = (d.value / total) * 2 * Math.PI;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += slice;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const large = slice > Math.PI ? 1 : 0;
      body += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${d.color}"/>`;
    }
  }
  return `<svg width="220" height="220" viewBox="0 0 220 220">${body}</svg>`;
}

function legend(data: { label: string; value: number; color: string }[]): string {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return data
    .map(
      (d) =>
        `<div class="leg"><span class="dot" style="background:${d.color}"></span>${d.label}: <b>${d.value}</b> (${Math.round((d.value / total) * 100)}%)</div>`,
    )
    .join('');
}

function statRow(label: string, value: string | number): string {
  return `<tr><td>${label}</td><td><b>${value}</b></td></tr>`;
}

function buildHtml(title: string, subtitle: string, rows: LogRow[]): string {
  const s = aggregate(rows);

  const catData = Object.keys(s.byCategory).map((k, i) => ({
    label: k,
    value: s.byCategory[k],
    color: CATEGORY_COLORS[k] || PALETTE[i % PALETTE.length],
  }));

  const statusOrder = ['PAID', 'WARN', 'REGISTER', 'DENIED', 'NA'];
  const statusRows = statusOrder
    .filter((k) => s.byStatus[k])
    .map((k) => statRow(`Check-ins · ${k}`, s.byStatus[k]))
    .join('');

  const observations: string[] = [];
  if (s.total === 0) observations.push('No attendance records for this period.');
  if (s.denied > 0) observations.push(`<b>${s.denied}</b> entry attempt(s) were <b>DENIED</b> for unpaid subscription.`);
  if (s.byStatus['REGISTER']) observations.push(`<b>${s.byStatus['REGISTER']}</b> overdue check-in(s) were asked to use the physical register.`);
  if (s.peakHour >= 0) observations.push(`Busiest hour: <b>${String(s.peakHour).padStart(2, '0')}:00–${String(s.peakHour + 1).padStart(2, '0')}:00</b> (${s.peakHourCount} check-ins).`);
  if (s.male + s.female > 0) observations.push(`Gender split (check-ins): <b>${s.male}</b> male, <b>${s.female}</b> female.`);
  observations.push(`<b>${s.uniquePeople}</b> distinct individual(s) across <b>${s.uniqueFlats}</b> flat(s).`);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<style>
  * { font-family: -apple-system, Roboto, Arial, sans-serif; color: #0F172A; }
  body { padding: 28px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: 1px; }
  .sub { color: #64748B; font-size: 13px; margin: 4px 0 20px; }
  .cards { display: flex; gap: 12px; margin-bottom: 24px; }
  .card { flex: 1; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px; text-align: center; }
  .card .n { font-size: 28px; font-weight: 800; }
  .card .l { font-size: 11px; color: #64748B; letter-spacing: 1px; }
  .section { margin-bottom: 26px; }
  .section h2 { font-size: 14px; letter-spacing: 1px; color: #475569; border-bottom: 2px solid #208AEF; padding-bottom: 6px; }
  .pierow { display: flex; align-items: center; gap: 24px; }
  .leg { font-size: 13px; margin: 4px 0; }
  .dot { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 7px 4px; border-bottom: 1px solid #EEF2F6; }
  td:last-child { text-align: right; }
  ul { font-size: 13px; line-height: 1.7; padding-left: 18px; }
  .foot { margin-top: 28px; color: #94A3B8; font-size: 11px; }
</style></head>
<body>
  <h1>ESTANCIA AMENITIES</h1>
  <div class="sub">${title} &nbsp;·&nbsp; ${subtitle}</div>

  <div class="cards">
    <div class="card"><div class="n">${s.total}</div><div class="l">TOTAL EVENTS</div></div>
    <div class="card"><div class="n">${s.ins}</div><div class="l">CHECK-INS</div></div>
    <div class="card"><div class="n">${s.outs}</div><div class="l">CHECK-OUTS</div></div>
    <div class="card"><div class="n" style="color:${s.denied ? '#DC2626' : '#0F172A'}">${s.denied}</div><div class="l">DENIED</div></div>
  </div>

  <div class="section">
    <h2>CHECK-INS BY CATEGORY</h2>
    <div class="pierow">
      ${pieSvg(catData)}
      <div>${legend(catData) || '<i>No check-ins.</i>'}</div>
    </div>
  </div>

  <div class="section">
    <h2>SUBSCRIPTION STATUS</h2>
    <table>${statusRows || '<tr><td><i>No check-ins.</i></td><td></td></tr>'}</table>
  </div>

  <div class="section">
    <h2>OBSERVATIONS</h2>
    <ul>${observations.map((o) => `<li>${o}</li>`).join('')}</ul>
  </div>

  <div class="foot">Generated ${new Date().toLocaleString('en-IN')} · Estancia Amenities attendance</div>
</body></html>`;
}

/** Fetch the log, filter to the chosen period, and return report HTML. */
export async function buildReportHtml(mode: ReportMode, value: string): Promise<{ html: string; count: number }> {
  const all = await fetchLogRows();
  const rows =
    mode === 'daily'
      ? all.filter((r) => parseTs(r.timestamp).date === value)
      : all.filter((r) => parseTs(r.timestamp).ym === value);
  const title = mode === 'daily' ? 'Daily Report' : 'Monthly Report';
  return { html: buildHtml(title, value, rows), count: rows.length };
}
