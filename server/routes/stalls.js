// 2.2 จัดการข้อมูลล็อกและราคา (D6 stalls).
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

const COLS = `stall_id AS id, zone_id, stall_code AS code, size_sqm, price_per_day, regular_price_per_day, active`;
const validPrice = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) < 1e8;
const cleanCode = (c) => String(c || '').trim().toUpperCase().slice(0, 10);

router.get('/', wrap(async (req, res) => {
  res.json(await db.all(`SELECT ${COLS} FROM stalls ORDER BY zone_id, stall_id`));
}));

router.post('/', requireMenu('market'), wrap(async (req, res) => {
  const { zoneId, pricePerDay, regularPricePerDay, sizeSqm } = req.body || {};
  const code = cleanCode((req.body || {}).code);
  if (!zoneId || !code || pricePerDay == null || regularPricePerDay == null) {
    return res.status(400).json({ error: 'กรุณากรอกโซน รหัสล็อก และราคาทั้งสองแบบให้ครบ' });
  }
  if (!wrap.isId(zoneId) || !validPrice(pricePerDay) || !validPrice(regularPricePerDay)) {
    return res.status(400).json({ error: 'ข้อมูลล็อกไม่ถูกต้อง' });
  }
  if (!(await db.get('SELECT zone_id FROM zones WHERE zone_id = ?', [zoneId]))) return res.status(404).json({ error: 'ไม่พบโซนนี้' });
  if (await db.get('SELECT stall_id FROM stalls WHERE stall_code = ?', [code])) return res.status(409).json({ error: 'รหัสล็อกนี้มีอยู่แล้ว' });
  const size = validPrice(sizeSqm) && Number(sizeSqm) > 0 && Number(sizeSqm) < 1000 ? Number(sizeSqm) : 4;
  const stall = await db.get(
    `INSERT INTO stalls (zone_id, stall_code, size_sqm, price_per_day, regular_price_per_day) VALUES (?,?,?,?,?) RETURNING ${COLS}`,
    [zoneId, code, size, pricePerDay, regularPricePerDay]);
  res.status(201).json(stall);
}));

router.put('/:id', requireMenu('market'), wrap(async (req, res) => {
  const stall = await db.get('SELECT * FROM stalls WHERE stall_id = ?', [req.params.id]);
  if (!stall) return res.status(404).json({ error: 'ไม่พบล็อกนี้' });
  const { active, pricePerDay, regularPricePerDay, zoneId, sizeSqm } = req.body || {};
  if ((pricePerDay != null && !validPrice(pricePerDay)) || (regularPricePerDay != null && !validPrice(regularPricePerDay))) {
    return res.status(400).json({ error: 'ราคาไม่ถูกต้อง' });
  }
  let code = stall.stall_code;
  if ((req.body || {}).code != null) {
    code = cleanCode(req.body.code);
    if (!code) return res.status(400).json({ error: 'กรุณากรอกรหัสล็อก' });
    if (await db.get('SELECT stall_id FROM stalls WHERE stall_code = ? AND stall_id <> ?', [code, stall.stall_id])) {
      return res.status(409).json({ error: 'รหัสล็อกนี้มีอยู่แล้ว' });
    }
  }
  // Moving a stall into another zone (e.g. a drinks-only row).
  let newZone = stall.zone_id;
  if (zoneId != null && String(zoneId) !== String(stall.zone_id)) {
    if (!wrap.isId(zoneId) || !(await db.get('SELECT zone_id FROM zones WHERE zone_id = ?', [zoneId]))) {
      return res.status(404).json({ error: 'ไม่พบโซนนี้' });
    }
    newZone = Number(zoneId);
  }
  const updated = await db.get(
    `UPDATE stalls SET active=?, price_per_day=?, regular_price_per_day=?, zone_id=?, stall_code=?, size_sqm=? WHERE stall_id=? RETURNING ${COLS}`,
    [
      active != null ? !!active : stall.active,
      pricePerDay != null ? pricePerDay : stall.price_per_day,
      regularPricePerDay != null ? regularPricePerDay : stall.regular_price_per_day,
      newZone, code,
      sizeSqm != null && validPrice(sizeSqm) && Number(sizeSqm) > 0 ? Number(sizeSqm) : stall.size_sqm,
      stall.stall_id
    ]);
  res.json(updated);
}));

router.delete('/:id', requireMenu('market'), wrap(async (req, res) => {
  const used = await db.get(
    "SELECT COUNT(*)::int AS c FROM bookings WHERE stall_id = ? AND status IN ('pending','approved') AND end_date >= CURRENT_DATE",
    [req.params.id]);
  if (used.c > 0) return res.status(409).json({ error: 'ล็อกนี้ยังมีการจองที่ยังไม่สิ้นสุด กรุณาปิดล็อกแทนการลบ' });
  await db.run('DELETE FROM stalls WHERE stall_id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
