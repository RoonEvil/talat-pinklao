const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  const vendors = db.prepare('SELECT * FROM vendors ORDER BY last_booking_at DESC').all();
  const counts = db
    .prepare(
      `SELECT vendor_token, COUNT(*) total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved
       FROM bookings GROUP BY vendor_token`
    )
    .all();
  const countMap = Object.fromEntries(counts.map((c) => [c.vendor_token, c]));
  res.json(
    vendors.map((v) => ({
      ...v,
      booking_total: countMap[v.id]?.total || 0,
      booking_approved: countMap[v.id]?.approved || 0
    }))
  );
});

router.put('/:id', requireAdmin, (req, res) => {
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
  const { active, isRegular } = req.body || {};
  db.prepare('UPDATE vendors SET active=?, is_regular=? WHERE id=?').run(
    active != null ? (active ? 1 : 0) : vendor.active,
    isRegular != null ? (isRegular ? 1 : 0) : vendor.is_regular,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id));
});

module.exports = router;
