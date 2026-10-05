const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, wrap(async (req, res) => {
  const vendors = await db.all(
    'SELECT id, name, phone, category, active, is_regular, joined_at, last_booking_at FROM vendors ORDER BY last_booking_at DESC NULLS LAST'
  );
  const counts = await db.all(
    `SELECT vendor_token, COUNT(*)::int AS total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END)::int AS approved
     FROM bookings GROUP BY vendor_token`
  );
  const countMap = Object.fromEntries(counts.map((c) => [c.vendor_token, c]));
  res.json(
    vendors.map((v) => ({
      ...v,
      booking_total: countMap[v.id]?.total || 0,
      booking_approved: countMap[v.id]?.approved || 0
    }))
  );
}));

router.put('/:id', requireAdmin, wrap(async (req, res) => {
  const vendor = await db.get('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
  if (!vendor) return res.status(404).json({ error: 'ไม่พบผู้ขายนี้' });
  const { active, isRegular } = req.body || {};
  const updated = await db.get(
    'UPDATE vendors SET active=?, is_regular=? WHERE id=? RETURNING id, name, phone, category, active, is_regular, joined_at, last_booking_at',
    [
      active != null ? (active ? 1 : 0) : vendor.active,
      isRegular != null ? (isRegular ? 1 : 0) : vendor.is_regular,
      req.params.id
    ]
  );
  res.json(updated);
}));

module.exports = router;
