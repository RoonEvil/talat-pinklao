const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Approved bookings covering a given date, each with any existing audit log for that date.
router.get('/', requireAdmin, (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const covering = db
    .prepare(
      `SELECT b.*, s.code as stall_code FROM bookings b
       JOIN stalls s ON s.id = b.stall_id
       WHERE b.status='approved' AND b.start_date <= ? AND b.end_date >= ?`
    )
    .all(date, date);
  const logs = db.prepare('SELECT * FROM audit_logs WHERE date = ?').all(date);
  const logMap = Object.fromEntries(logs.map((l) => [l.booking_id, l]));
  res.json({
    date,
    bookings: covering.map((b) => ({ ...b, audit: logMap[b.id] || null }))
  });
});

router.get('/fines', requireAdmin, (req, res) => {
  res.json(
    db.prepare('SELECT * FROM audit_logs WHERE fine_amount > 0 ORDER BY recorded_at DESC').all()
  );
});

router.put('/', requireAdmin, (req, res) => {
  const { bookingId, date, present, categoryMatch, fineAmount, fineReason } = req.body || {};
  if (!bookingId || !date) return res.status(400).json({ error: 'bookingId and date are required' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  const stall = db.prepare('SELECT * FROM stalls WHERE id = ?').get(booking.stall_id);
  const id = `${bookingId}_${date}`;
  db.prepare(
    `INSERT INTO audit_logs (id, booking_id, stall_id, stall_code, zone_id, date, vendor_name, present, category_match, fine_amount, fine_reason, recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(id) DO UPDATE SET present=excluded.present, category_match=excluded.category_match,
       fine_amount=excluded.fine_amount, fine_reason=excluded.fine_reason, recorded_at=datetime('now')`
  ).run(
    id, bookingId, booking.stall_id, stall ? stall.code : null, booking.zone_id, date, booking.vendor_name,
    present ? 1 : 0, categoryMatch ? 1 : 0, fineAmount || 0, fineReason || null
  );
  res.json(db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id));
});

module.exports = router;
