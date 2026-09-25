const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM zones ORDER BY sort_order').all());
});

router.post('/', requireAdmin, (req, res) => {
  const { name, description, colorIndex } = req.body || {};
  if (!name) return res.status(400).json({ error: 'กรุณากรอกชื่อโซน' });
  const order = db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM zones').get().m + 1;
  const info = db
    .prepare('INSERT INTO zones (name, description, color_index, sort_order) VALUES (?,?,?,?)')
    .run(name, description || null, colorIndex || 0, order);
  res.status(201).json(db.prepare('SELECT * FROM zones WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) c FROM stalls WHERE zone_id = ?').get(req.params.id).c;
  if (count > 0) return res.status(409).json({ error: 'กรุณาลบล็อกในโซนนี้ออกก่อน' });
  db.prepare('DELETE FROM zones WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
