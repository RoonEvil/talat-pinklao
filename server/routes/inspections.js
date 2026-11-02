// 6.0 ตรวจสอบตลาด (D10 inspections): daily check of approved bookings, with fines.
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);
router.use(requireMenu('inspections'));

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));

const LOG_SELECT = `
  SELECT i.inspection_id AS id, i.booking_id, i.inspect_date AS date, i.present, i.category_match, i.fine_amount, i.fine_reason,
    i.recorded_at, TRIM(ib.first_name || ' ' || ib.last_name) AS inspected_by_name,
    s.stall_code, s.zone_id, TRIM(u.first_name || ' ' || u.last_name) AS vendor_name, u.phone AS vendor_phone
  FROM inspections i
  JOIN bookings b ON b.booking_id = i.booking_id
  JOIN stalls s ON s.stall_id = b.stall_id
  JOIN users u ON u.user_id = b.vendor_id
  LEFT JOIN users ib ON ib.user_id = i.inspected_by`;

// 6.1 แสดงรายการล็อกที่ต้องตรวจ: approved bookings covering the date, each with its result if already recorded.
router.get('/', wrap(async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10);
  const covering = await db.all(
    `SELECT b.booking_id AS id, b.stall_id, s.zone_id, s.stall_code, b.category_id, b.start_date, b.end_date,
       TRIM(u.first_name || ' ' || u.last_name) AS vendor_name, u.phone AS vendor_phone
     FROM bookings b JOIN stalls s ON s.stall_id = b.stall_id JOIN users u ON u.user_id = b.vendor_id
     WHERE b.status = 'approved' AND b.start_date <= ?::date AND b.end_date >= ?::date
     ORDER BY s.stall_code`, [date, date]);
  const logs = await db.all(`${LOG_SELECT} WHERE i.inspect_date = ?::date`, [date]);
  const byBooking = Object.fromEntries(logs.map((l) => [l.booking_id, l]));
  res.json({ date, bookings: covering.map((b) => ({ ...b, audit: byBooking[b.id] || null })) });
}));

// 6.3 ค้นหาประวัติค่าปรับ
router.get('/fines', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const params = [];
  let where = 'WHERE i.fine_amount > 0';
  if (q) {
    where += " AND (s.stall_code ILIKE ? OR u.first_name || ' ' || u.last_name ILIKE ? OR COALESCE(i.fine_reason,'') ILIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  res.json(await db.all(`${LOG_SELECT} ${where} ORDER BY i.inspect_date DESC, i.recorded_at DESC`, params));
}));

// 6.2 บันทึก / แก้ไขผลตรวจและค่าปรับ (one result per booking per day).
router.put('/', wrap(async (req, res) => {
  const { bookingId, date, present, categoryMatch, fineAmount, fineReason } = req.body || {};
  const fine = Number(fineAmount || 0);
  if (!wrap.isId(bookingId) || !isDate(date) || !Number.isFinite(fine) || fine < 0) {
    return res.status(400).json({ error: 'ข้อมูลการตรวจสอบไม่ถูกต้อง' });
  }
  const booking = await db.get('SELECT booking_id, status, start_date, end_date FROM bookings WHERE booking_id = ?', [bookingId]);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  if (booking.status !== 'approved' || date < booking.start_date || date > booking.end_date) {
    return res.status(400).json({ error: 'ตรวจได้เฉพาะการจองที่อนุมัติแล้วในช่วงวันที่จอง' });
  }
  const row = await db.get(
    `INSERT INTO inspections (booking_id, inspect_date, present, category_match, fine_amount, fine_reason, inspected_by, recorded_at)
     VALUES (?,?::date,?,?,?,?,?,NOW())
     ON CONFLICT (booking_id, inspect_date) DO UPDATE SET present=EXCLUDED.present, category_match=EXCLUDED.category_match,
       fine_amount=EXCLUDED.fine_amount, fine_reason=EXCLUDED.fine_reason, inspected_by=EXCLUDED.inspected_by, recorded_at=NOW()
     RETURNING inspection_id`,
    [booking.booking_id, date, !!present, !!categoryMatch, fine, fineReason ? String(fineReason).slice(0, 500) : null, req.staff.uid]);
  res.json(await db.get(`${LOG_SELECT} WHERE i.inspection_id = ?`, [row.inspection_id]));
}));

router.delete('/:id', wrap(async (req, res) => {
  await db.run('DELETE FROM inspections WHERE inspection_id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
