const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

router.get('/', wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM zones ORDER BY sort_order, id'));
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const { name, description, colorIndex } = req.body || {};
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อโซน' });
  const order = (await db.get('SELECT COALESCE(MAX(sort_order),0)::int AS m FROM zones')).m + 1;
  const zone = await db.get(
    'INSERT INTO zones (name, description, color_index, sort_order) VALUES (?,?,?,?) RETURNING *',
    [name, description || null, (Math.abs(Math.round(Number(colorIndex))) || 0) % 4, order]
  );
  res.status(201).json(zone);
}));

router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  const count = (await db.get('SELECT COUNT(*)::int AS c FROM stalls WHERE zone_id = ?', [req.params.id])).c;
  if (count > 0) return res.status(409).json({ error: 'กรุณาลบล็อกในโซนนี้ออกก่อน' });
  await db.run('DELETE FROM zones WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
