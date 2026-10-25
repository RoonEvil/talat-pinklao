// The market keeps stalls selling the same thing from standing side by side. "Side by side" means the
// two stalls' squares share an edge on the market map.
const db = require('./db');
const { goodsKey } = require('./goods');

// Stall squares for a market whose admin has not saved a map yet.
// Mirrors autoLayout() in public/app.js — keep the two in sync.
function autoLayoutStalls(zones, stalls) {
  const LEFT = 3;
  const byRowCol = (a, b) => (a.pos_row || 0) - (b.pos_row || 0) || (a.pos_col || 0) - (b.pos_col || 0) || a.id - b.id;
  const rects = [];
  let y = 1;
  for (const z of zones) {
    const list = stalls.filter((s) => s.zone_id === z.id).sort(byRowCol);
    if (!list.length) continue;
    const rowCount = list.length > 1 ? Math.max(2, Math.ceil(list.length / 9)) : 1;
    const perRow = Math.ceil(list.length / rowCount);
    list.forEach((s, i) => {
      rects.push({ stallId: s.id, x: LEFT + (i % perRow), y: y + Math.floor(i / perRow) * 2, w: 1, h: 1 });
    });
    y += rowCount * 2;
  }
  return rects;
}

function touches(a, b) {
  const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
  const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
  return (xOverlap && (a.y + a.h === b.y || b.y + b.h === a.y)) ||
    (yOverlap && (a.x + a.w === b.x || b.x + b.w === a.x));
}

async function stallRects() {
  const row = await db.get('SELECT map_layout FROM settings WHERE id = 1');
  try {
    const layout = row && row.map_layout ? JSON.parse(row.map_layout) : null;
    if (layout && Array.isArray(layout.items)) return layout.items.filter((it) => it.kind === 'stall');
  } catch (e) { /* unreadable saved map: fall back to the automatic one */ }
  const zones = await db.all('SELECT id FROM zones ORDER BY sort_order, id');
  const stalls = await db.all('SELECT id, zone_id, pos_row, pos_col FROM stalls');
  return autoLayoutStalls(zones, stalls);
}

async function neighborStallIds(stallId) {
  const rects = await stallRects();
  const me = rects.find((r) => r.stallId === Number(stallId));
  if (!me) return [];
  return rects.filter((r) => r.stallId !== me.stallId && touches(me, r)).map((r) => r.stallId);
}

// A booking on a neighbouring stall that sells the same thing in overlapping dates, or null.
async function findNeighborClash({ stallId, startDate, endDate, category, foodType, statuses, excludeId }) {
  const key = goodsKey(category, foodType);
  if (!key) return null;
  const ids = await neighborStallIds(stallId);
  if (!ids.length) return null;
  const rows = await db.all(
    `SELECT b.category, b.food_type, b.start_date, b.end_date, s.code
     FROM bookings b JOIN stalls s ON s.id = b.stall_id
     WHERE b.stall_id IN (${ids.map(() => '?').join(',')})
       AND b.status IN (${statuses.map(() => '?').join(',')}) AND b.id != ?
       AND ?::date <= b.end_date::date AND ?::date >= b.start_date::date
     ORDER BY b.start_date`,
    [...ids, ...statuses, excludeId || -1, startDate, endDate]
  );
  return rows.find((r) => goodsKey(r.category, r.food_type) === key) || null;
}

module.exports = { findNeighborClash, neighborStallIds };
