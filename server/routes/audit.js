const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Approved bookings covering a given date, each with any existing audit log for that date.
router.get('/', requireAdmin, wrap(async (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const covering = await db.all(
    `SELECT b.*, s.code AS stall_code FROM bookings b
     JOIN stalls s ON s.id = b.stall_id
     WHERE b.status='approved' AND b.start_date <= ? AND b.end_date >= ?`,
    [date, date]
  );
  const logs = await db.all('SELECT * FROM audit_logs WHERE date = ?', [date]);
  const logMap = Object.fromEntries(logs.map((l) => [l.booking_id, l]));
  res.json({
    date,
    bookings: covering.map((b) => ({ ...b, audit: logMap[b.id] || null }))
  });
}));

router.get('/fines', requireAdmin, wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM audit_logs WHERE fine_amount > 0 ORDER BY recorded_at DESC'));
}));

router.put('/', requireAdmin, wrap(async (req, res) => {
  const { bookingId, date, present, categoryMatch, fineAmount, fineReason } = req.body || {};
  if (!bookingId || !date) return res.status(400).json({ error: 'กรุณาระบุ bookingId และวันที่' });
  if (!wrap.isId(bookingId) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Number(fineAmount || 0))) {
    return res.status(400).json({ error: 'ข้อมูลการตรวจสอบไม่ถูกต้อง' });
  }
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [bookingId]);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  const stall = await db.get('SELECT code FROM stalls WHERE id = ?', [booking.stall_id]);
  const id = `${bookingId}_${date}`;
  const row = await db.get(
    `INSERT INTO audit_logs (id, booking_id, stall_id, stall_code, zone_id, date, vendor_name, present, category_match, fine_amount, fine_reason, recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())
     ON CONFLICT (id) DO UPDATE SET present=EXCLUDED.present, category_match=EXCLUDED.category_match,
       fine_amount=EXCLUDED.fine_amount, fine_reason=EXCLUDED.fine_reason, recorded_at=NOW()
     RETURNING *`,
    [
      id, booking.id, booking.stall_id, stall ? stall.code : null, booking.zone_id, date, booking.vendor_name,
      present ? 1 : 0, categoryMatch ? 1 : 0, fineAmount || 0, fineReason || null
    ]
  );
  res.json(row);
}));

module.exports = router;
