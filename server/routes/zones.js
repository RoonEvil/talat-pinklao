const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireAdmin } = require('../middleware/auth');
const { normalizeAllowed } = require('../goods');

const router = express.Router();
router.param('id', wrap.numericIdParam);

// allowedGoods: list like ['food:drink'] or ['clothing', 'general']; empty list = any goods.
function allowedValue(list) {
  const items = normalizeAllowed(list);
  return items.length ? items.join(',') : null;
}

router.get('/', wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM zones ORDER BY sort_order, id'));
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const { name, description, colorIndex, allowedGoods } = req.body || {};
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อโซน' });
  const order = (await db.get('SELECT COALESCE(MAX(sort_order),0)::int AS m FROM zones')).m + 1;
  const zone = await db.get(
    'INSERT INTO zones (name, description, color_index, sort_order, allowed_goods) VALUES (?,?,?,?,?) RETURNING *',
    [name, description || null, (Math.abs(Math.round(Number(colorIndex))) || 0) % 4, order, allowedValue(allowedGoods)]
  );
  res.status(201).json(zone);
}));

router.put('/:id', requireAdmin, wrap(async (req, res) => {
  const zone = await db.get('SELECT * FROM zones WHERE id = ?', [req.params.id]);
  if (!zone) return res.status(404).json({ error: 'ไม่พบโซนนี้' });
  const { name, description, allowedGoods } = req.body || {};
  if (name != null && !String(name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโซน' });
  const row = await db.get(
    'UPDATE zones SET name=?, description=?, allowed_goods=? WHERE id=? RETURNING *',
    [
      name != null ? String(name).trim() : zone.name,
      description !== undefined ? (description || null) : zone.description,
      allowedGoods !== undefined ? allowedValue(allowedGoods) : zone.allowed_goods,
      zone.id
    ]
  );
  res.json(row);
}));

router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const count = (await db.get('SELECT COUNT(*)::int AS c FROM stalls WHERE zone_id = ?', [req.params.id])).c;
  if (count > 0) return res.status(409).json({ error: 'กรุณาลบล็อกในโซนนี้ออกก่อน' });
  await db.run('DELETE FROM zones WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
