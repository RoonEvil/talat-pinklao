// 2.3 แก้ไขแผนผังตลาด (D7 market_layouts). Each save adds a row; the newest row is the market's map.
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu } = require('../middleware/auth');

const router = express.Router();
const KEEP_VERSIONS = 20;
const MAP_KINDS = new Set(['stall', 'entrance', 'toilet', 'stage', 'parking', 'text', 'object']);

function sanitizeLayout(body) {
  if (!body || typeof body !== 'object') return null;
  const cols = Math.round(Number(body.cols));
  const rows = Math.round(Number(body.rows));
  if (!(cols >= 4 && cols <= 60 && rows >= 4 && rows <= 60)) return null;
  if (!Array.isArray(body.items) || body.items.length > 600) return null;
  const items = [];
  for (const raw of body.items) {
    if (!raw) return null;
    if (raw.kind === 'tree') continue; // trees were removed from the market map
    if (!MAP_KINDS.has(raw.kind)) return null;
    const [x, y, w, h] = [raw.x, raw.y, raw.w, raw.h].map((v) => Math.round(Number(v)));
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (w < 1 || h < 1 || w > 4 || h > 4 || x < 0 || y < 0 || x + w > cols || y + h > rows) return null;
    const item = { kind: raw.kind, x, y, w, h };
    if (raw.kind === 'stall') {
      const stallId = Math.round(Number(raw.stallId));
      if (!(stallId > 0)) return null;
      item.stallId = stallId;
    }
    if (raw.label != null && raw.label !== '') item.label = String(raw.label).slice(0, 40);
    items.push(item);
  }
  return { cols, rows, items };
}

async function currentLayout() {
  const row = await db.get('SELECT layout_data FROM market_layouts ORDER BY layout_id DESC LIMIT 1');
  return row ? row.layout_data : null;
}

router.get('/', wrap(async (req, res) => {
  res.json({ mapLayout: await currentLayout() });
}));

router.put('/', requireMenu('market'), wrap(async (req, res) => {
  const layout = sanitizeLayout(req.body);
  if (!layout) return res.status(400).json({ error: 'ข้อมูลแผนผังไม่ถูกต้อง' });
  await db.tx(async (t) => {
    await t.run('INSERT INTO market_layouts (layout_data, updated_by) VALUES (?::jsonb, ?)', [JSON.stringify(layout), req.staff.uid]);
    await t.run(
      `DELETE FROM market_layouts WHERE layout_id NOT IN (SELECT layout_id FROM market_layouts ORDER BY layout_id DESC LIMIT ${KEEP_VERSIONS})`);
  });
  res.json({ mapLayout: layout });
}));

module.exports = router;
module.exports.currentLayout = currentLayout;
