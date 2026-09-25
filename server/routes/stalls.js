const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM stalls ORDER BY zone_id, pos_row, pos_col').all());
});

router.post('/', requireAdmin, (req, res) => {
  const { zoneId, code, category, pricePerDay, regularPricePerDay } = req.body || {};
  if (!zoneId || !code || pricePerDay == null || regularPricePerDay == null) {
    return res.status(400).json({ error: 'กรุณากรอกโซน รหัสล็อก และราคาทั้งสองแบบให้ครบ' });
  }
  const existing = db.prepare('SELECT id FROM stalls WHERE zone_id = ? AND code = ?').get(zoneId, code);
  if (existing) return res.status(409).json({ error: 'รหัสล็อกนี้มีอยู่แล้วในโซนนี้' });
  const count = db.prepare('SELECT COUNT(*) c FROM stalls WHERE zone_id = ?').get(zoneId).c;
  const info = db
    .prepare(
      `INSERT INTO stalls (zone_id, code, size_sqm, category, price_per_day, regular_price_per_day, pos_row, pos_col, active)
       VALUES (?,?,4,?,?,?,?,?,1)`
    )
    .run(zoneId, code, category || 'other', pricePerDay, regularPricePerDay, Math.floor(count / 4), count % 4);
  res.status(201).json(db.prepare('SELECT * FROM stalls WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', requireAdmin, (req, res) => {
  const stall = db.prepare('SELECT * FROM stalls WHERE id = ?').get(req.params.id);
  if (!stall) return res.status(404).json({ error: 'ไม่พบล็อกนี้' });
  const { active, pricePerDay, regularPricePerDay } = req.body || {};
  db.prepare('UPDATE stalls SET active=?, price_per_day=?, regular_price_per_day=? WHERE id=?').run(
    active != null ? (active ? 1 : 0) : stall.active,
    pricePerDay != null ? pricePerDay : stall.price_per_day,
    regularPricePerDay != null ? regularPricePerDay : stall.regular_price_per_day,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM stalls WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM stalls WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
