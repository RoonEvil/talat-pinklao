// 3.4 ตรวจสอบสินค้าซ้ำกับล็อกข้างเคียง: stalls selling the same thing may not stand side by side.
// "Side by side" means the two stalls' squares share an edge on the market map (D7 market_layouts).
const db = require('./db');
const { loadCategories, goodsKey } = require('./goods');

// Stall squares for a market whose staff have not saved a map yet.
// Mirrors autoLayout() in public/app.js — keep the two in sync.
function autoLayoutStalls(zones, stalls) {
  const LEFT = 3;
  const rects = [];
  let y = 1;
  for (const z of zones) {
    const list = stalls.filter((s) => s.zone_id === z.zone_id).sort((a, b) => a.stall_id - b.stall_id);
    if (!list.length) continue;
    const rowCount = list.length > 1 ? Math.max(2, Math.ceil(list.length / 9)) : 1;
    const perRow = Math.ceil(list.length / rowCount);
    list.forEach((s, i) => {
      rects.push({ stallId: s.stall_id, x: LEFT + (i % perRow), y: y + Math.floor(i / perRow) * 2, w: 1, h: 1 });
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
  const row = await db.get('SELECT layout_data FROM market_layouts ORDER BY layout_id DESC LIMIT 1');
  const layout = row && row.layout_data;
  if (layout && Array.isArray(layout.items)) return layout.items.filter((it) => it.kind === 'stall');
  const zones = await db.all('SELECT zone_id FROM zones ORDER BY sort_order, zone_id');
  const stalls = await db.all('SELECT stall_id, zone_id FROM stalls');
  return autoLayoutStalls(zones, stalls);
}

async function neighborStallIds(stallId) {
  const rects = await stallRects();
  const me = rects.find((r) => r.stallId === Number(stallId));
  if (!me) return [];
  return rects.filter((r) => r.stallId !== me.stallId && touches(me, r)).map((r) => r.stallId);
}

// A booking on a neighbouring stall that sells the same thing in overlapping dates, or null.
async function findNeighborClash({ stallId, startDate, endDate, categoryId, statuses, excludeId }) {
  const cats = await loadCategories();
  const key = goodsKey(cats, categoryId);
  if (!key) return null;
  const ids = await neighborStallIds(stallId);
  if (!ids.length) return null;
  const rows = await db.all(
    `SELECT b.category_id, b.start_date, b.end_date, s.stall_code AS code
     FROM bookings b JOIN stalls s ON s.stall_id = b.stall_id
     WHERE b.stall_id IN (${ids.map(() => '?').join(',')})
       AND b.status IN (${statuses.map(() => '?').join(',')}) AND b.booking_id <> ?
       AND ?::date <= b.end_date AND ?::date >= b.start_date
     ORDER BY b.start_date`,
    [...ids, ...statuses, excludeId || -1, startDate, endDate]
  );
  return rows.find((r) => goodsKey(cats, r.category_id) === key) || null;
}

module.exports = { findNeighborClash, neighborStallIds };
