// api/leaderboard.js — reads Google Sheet CSV directly (no GAS needed)
// Supports ?mode=day|week|month&date=YYYY-MM-DD (defaults: week + today)

const SHEET_ID   = '1sJwNPM7_mhL5_5AzhzLXh_SjklJBHVCbhlsCRpYuGts';
const SHEET_NAME = 'Form Responses 1';
const CSV_URL    = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;

// ── CSV Parser ───────────────────────────────────────────────────────────────
function parseCSVLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCSVLine(lines[i]);
    if (c.length < 9) continue;
    rows.push({
      timestamp:      c[0]  || '',
      name:           c[1]  || '',
      date:           c[2]  || '',
      setCalls:       toNum(c[3]),
      blueprints:     toNum(c[4]),
      noShows:        toNum(c[5]),
      followUps:      toNum(c[6]),
      closes:         toNum(c[7]),
      revenue:        toNum(c[8]),
      objection:      c[9]  || '',
      pipelineHealth: c[10] || '',
      win:            c[11] || '',
      flag:           c[12] || '',
    });
  }
  return rows;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function toNum(val) {
  const n = parseFloat(String(val || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function getDayBounds(anchor) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  const end = new Date(anchor);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getWeekBounds(anchor) {
  const d    = new Date(anchor);
  const day  = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthBounds(anchor) {
  const d     = new Date(anchor);
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

function formatDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function buildLabel(mode, start, end) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (mode === 'day')   return formatDate(start);
  if (mode === 'month') return `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

// ── Leaderboard Builder ──────────────────────────────────────────────────────
function buildLeaderboard(rows, start, end) {
  const reps = {};

  for (const row of rows) {
    const rowDate = new Date(row.date);
    if (isNaN(rowDate) || rowDate < start || rowDate > end) continue;
    if (!row.name) continue;

    if (!reps[row.name]) {
      reps[row.name] = {
        name: row.name,
        setCalls: 0, blueprints: 0, noShows: 0, followUps: 0,
        closes: 0, revenue: 0, days: 0,
        topObjection: {}, flags: [], wins: [],
      };
    }

    const r = reps[row.name];
    r.setCalls   += row.setCalls;
    r.blueprints += row.blueprints;
    r.noShows    += row.noShows;
    r.followUps  += row.followUps;
    r.closes     += row.closes;
    r.revenue    += row.revenue;
    r.days       += 1;

    if (row.objection) r.topObjection[row.objection] = (r.topObjection[row.objection] || 0) + 1;
    if (row.flag && row.flag.trim()) r.flags.push(row.flag.trim());
    if (row.win  && row.win.trim())  r.wins.push(row.win.trim());
  }

  const repList = Object.values(reps).map(rep => {
    const booked = rep.blueprints + rep.noShows;
    rep.showRate         = booked > 0         ? Math.round((rep.blueprints / booked)         * 100) : null;
    rep.closeRate        = rep.blueprints > 0 ? Math.round((rep.closes     / rep.blueprints) * 100) : null;
    rep.topObjectionText = Object.keys(rep.topObjection)
      .sort((a, b) => rep.topObjection[b] - rep.topObjection[a])[0] || null;
    return rep;
  }).sort((a, b) => b.revenue !== a.revenue ? b.revenue - a.revenue : b.closes - a.closes);

  const totals = repList.reduce((acc, r) => {
    acc.closes     += r.closes;
    acc.revenue    += r.revenue;
    acc.blueprints += r.blueprints;
    acc.noShows    += r.noShows;
    acc.setCalls   += r.setCalls;
    return acc;
  }, { closes: 0, revenue: 0, blueprints: 0, noShows: 0, setCalls: 0 });

  const teamBooked  = totals.blueprints + totals.noShows;
  totals.showRate   = teamBooked > 0        ? Math.round((totals.blueprints / teamBooked)        * 100) : null;
  totals.closeRate  = totals.blueprints > 0 ? Math.round((totals.closes     / totals.blueprints) * 100) : null;

  return { reps: repList, totals };
}

// ── Vercel Handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  try {
    // Parse query params — mode defaults to 'week', date defaults to today
    const mode   = ['day','week','month'].includes(req.query.mode) ? req.query.mode : 'week';
    const anchor = req.query.date ? new Date(req.query.date) : new Date();
    if (isNaN(anchor)) return res.status(400).json({ error: 'Invalid date param' });

    const bounds =
      mode === 'day'   ? getDayBounds(anchor)   :
      mode === 'month' ? getMonthBounds(anchor)  :
                         getWeekBounds(anchor);

    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`Sheet fetch failed: ${response.status}`);
    const csv  = await response.text();
    const rows = parseCSV(csv);
    const { reps, totals } = buildLeaderboard(rows, bounds.start, bounds.end);

    res.status(200).json({
      mode,
      label:     buildLabel(mode, bounds.start, bounds.end),
      updatedAt: new Date().toISOString(),
      reps,
      totals,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
