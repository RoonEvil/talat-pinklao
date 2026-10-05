const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

const validPrice = (v) => Number.isFinite(Number(v)) && Number(v) >= 0;

router.get('/', wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM stalls ORDER BY zone_id, pos_row, pos_col, id'));
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const { zoneId, code, category, pricePerDay, regularPricePerDay } = req.body || {};
  if (!zoneId || !code || pricePerDay == null || regularPricePerDay == null) {
    return res.status(400).json({ error: 'กรุณากรอกโซน รหัสล็อก และราคาทั้งสองแบบให้ครบ' });
  }
  if (!wrap.isId(zoneId) || !validPrice(pricePerDay) || !validPrice(regularPricePerDay)) {
    return res.status(400).json({ error: 'ข้อมูลล็อกไม่ถูกต้อง' });
  }
  if (!(await db.get('SELECT id FROM zones WHERE id = ?', [zoneId]))) {
    return res.status(404).json({ error: 'ไม่พบโซนนี้' });
  }
  const existing = await db.get('SELECT id FROM stalls WHERE zone_id = ? AND code = ?', [zoneId, code]);
  if (existing) return res.status(409).json({ error: 'รหัสล็อกนี้มีอยู่แล้วในโซนนี้' });
  const count = (await db.get('SELECT COUNT(*)::int AS c FROM stalls WHERE zone_id = ?', [zoneId])).c;
  const stall = await db.get(
    `INSERT INTO stalls (zone_id, code, size_sqm, category, price_per_day, regular_price_per_day, pos_row, pos_col, active)
     VALUES (?,?,4,?,?,?,?,?,1) RETURNING *`,
    [zoneId, code, category || 'other', pricePerDay, regularPricePerDay, Math.floor(count / 4), count % 4]
  );
  res.status(201).json(stall);
}));

router.put('/:id', requireAdmin, wrap(async (req, res) => {
  const stall = await db.get('SELECT * FROM stalls WHERE id = ?', [req.params.id]);
  if (!stall) return res.status(404).json({ error: 'ไม่พบล็อกนี้' });
  const { active, pricePerDay, regularPricePerDay } = req.body || {};
  if ((pricePerDay != null && !validPrice(pricePerDay)) || (regularPricePerDay != null && !validPrice(regularPricePerDay))) {
    return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
  }
  const updated = await db.get(
    'UPDATE stalls SET active=?, price_per_day=?, regular_price_per_day=? WHERE id=? RETURNING *',
    [
      active != null ? (active ? 1 : 0) : stall.active,
      pricePerDay != null ? pricePerDay : stall.price_per_day,
      regularPricePerDay != null ? regularPricePerDay : stall.regular_price_per_day,
      req.params.id
    ]
  );
  res.json(updated);
}));

router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  await db.run('DELETE FROM stalls WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
