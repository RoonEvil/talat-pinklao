const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads', 'receipts');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 10);
      cb(null, `${req.params.id}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

function countDays(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const n = Math.round((e - s) / 86400000) + 1;
  return n > 0 ? n : 1;
}

function hasOverlap(stallId, startDate, endDate, statuses, excludeId) {
  const placeholders = statuses.map(() => '?').join(',');
  const row = db
    .prepare(
      `SELECT COUNT(*) c FROM bookings
       WHERE stall_id = ? AND status IN (${placeholders}) AND id != ?
       AND date(?) <= date(end_date) AND date(?) >= date(start_date)`
    )
    .get(stallId, ...statuses, excludeId || -1, startDate, endDate);
  return row.c > 0;
}

function isRegisteredVendor(id) {
  const v = db.prepare('SELECT password_hash FROM vendors WHERE id = ?').get(id);
  return !!(v && v.password_hash);
}

// Registered vendors must prove identity with their JWT. Guests prove it with the random
// token their browser holds (X-Vendor-Token); a registered vendor's username is never accepted there.
function requesterToken(req) {
  if (req.user && req.user.kind === 'vendor') return req.user.id;
  const token = req.get('x-vendor-token');
  if (!token || isRegisteredVendor(token)) return null;
  return token;
}

function loadOwnedBooking(req, res, next) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  const isAdmin = req.user && req.user.kind === 'admin';
  if (!isAdmin && requesterToken(req) !== booking.vendor_token) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์จัดการการจองนี้' });
  }
  req.booking = booking;
  next();
}

function bookingWithMeta(id) {
  return db
    .prepare(
      `SELECT b.*, s.code as stall_code, z.name as zone_name
       FROM bookings b
       JOIN stalls s ON s.id = b.stall_id
       JOIN zones z ON z.id = b.zone_id
       WHERE b.id = ?`
    )
    .get(id);
}

// Public occupancy feed — just enough to render stall availability, no vendor details.
router.get('/active', (req, res) => {
  const rows = db
    .prepare(
      `SELECT stall_id as stallId, start_date as startDate, end_date as endDate, status
       FROM bookings WHERE status IN ('pending','approved') AND date(end_date) >= date('now')`
    )
    .all();
  res.json(rows);
});

// Admin: totals by rate type (guest = ขาจร, regular = ขาประจำ), optionally filtered by start_date range.
router.get('/summary', requireAdmin, (req, res) => {
  const { from, to } = req.query;
  let where = "status = 'approved'";
  const params = [];
  if (from) { where += ' AND start_date >= ?'; params.push(from); }
  if (to) { where += ' AND start_date <= ?'; params.push(to); }
  const rows = db
    .prepare(
      `SELECT rate_type,
         COUNT(*) as count,
         SUM(deposit_amount) as total,
         SUM(CASE WHEN payment_status='confirmed' THEN 1 ELSE 0 END) as confirmedCount,
         SUM(CASE WHEN payment_status='confirmed' THEN deposit_amount ELSE 0 END) as confirmedTotal
       FROM bookings WHERE ${where} GROUP BY rate_type`
    )
    .all(...params);
  const result = {
    guest: { count: 0, total: 0, confirmedCount: 0, confirmedTotal: 0 },
    regular: { count: 0, total: 0, confirmedCount: 0, confirmedTotal: 0 }
  };
  rows.forEach((r) => {
    if (result[r.rate_type]) {
      result[r.rate_type] = {
        count: r.count || 0,
        total: r.total || 0,
        confirmedCount: r.confirmedCount || 0,
        confirmedTotal: r.confirmedTotal || 0
      };
    }
  });
  res.json(result);
});

router.get('/mine', optionalAuth, (req, res) => {
  const token = requesterToken(req);
  if (!token) return res.json([]);
  const rows = db
    .prepare(
      `SELECT b.*, s.code as stall_code, z.name as zone_name FROM bookings b
       JOIN stalls s ON s.id = b.stall_id JOIN zones z ON z.id = b.zone_id
       WHERE b.vendor_token = ? ORDER BY b.created_at DESC`
    )
    .all(token);
  res.json(rows);
});

router.get('/', requireAdmin, (req, res) => {
  const status = req.query.status;
  const base = `SELECT b.*, s.code as stall_code, z.name as zone_name FROM bookings b
    JOIN stalls s ON s.id = b.stall_id JOIN zones z ON z.id = b.zone_id`;
  const rows = status
    ? db.prepare(`${base} WHERE b.status = ? ORDER BY b.created_at DESC`).all(status)
    : db.prepare(`${base} ORDER BY b.created_at DESC`).all();
  res.json(rows);
});

router.post('/', optionalAuth, (req, res) => {
  const {
    stallId, vendorName, vendorPhone, category,
    startDate, endDate, note, paymentMethod, alreadyPaid
  } = req.body || {};
  const vendorToken = req.user && req.user.kind === 'vendor' ? req.user.id : (req.body || {}).vendorToken;
  if (!stallId || !vendorToken || !vendorName || !vendorPhone || !startDate || !endDate) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ' });
  }
  if (!(req.user && req.user.kind === 'vendor') && isRegisteredVendor(vendorToken)) {
    return res.status(403).json({ error: 'กรุณาเข้าสู่ระบบบัญชีนี้ก่อนจอง' });
  }
  if (endDate < startDate) return res.status(400).json({ error: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' });

  const stall = db.prepare('SELECT * FROM stalls WHERE id = ?').get(stallId);
  if (!stall || !stall.active) return res.status(404).json({ error: 'ล็อกนี้ไม่พร้อมให้จอง' });

  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorToken);
  if (vendor && !vendor.active) {
    return res.status(403).json({ error: 'บัญชีผู้ขายของคุณถูกระงับโดยเจ้าหน้าที่ตลาด' });
  }

  if (hasOverlap(stallId, startDate, endDate, ['pending', 'approved'])) {
    return res.status(409).json({ error: 'ล็อกนี้มีคำขอหรือการจองที่ทับซ้อนกับช่วงวันที่นี้อยู่แล้ว' });
  }

  const isRegular = !!(vendor && vendor.is_regular);
  const rate = isRegular ? stall.regular_price_per_day : stall.price_per_day;
  const days = countDays(startDate, endDate);
  const depositAmount = rate * days;

  const info = db
    .prepare(
      `INSERT INTO bookings
       (stall_id, zone_id, vendor_token, vendor_name, vendor_phone, category, start_date, end_date, note,
        deposit_amount, rate_type, payment_method, payment_status, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`
    )
    .run(
      stallId, stall.zone_id, vendorToken, vendorName, vendorPhone, category || 'other',
      startDate, endDate, note || null,
      depositAmount, isRegular ? 'regular' : 'guest', paymentMethod || 'cash',
      alreadyPaid ? 'paid' : 'unpaid'
    );

  if (vendor) {
    db.prepare(
      'UPDATE vendors SET name=?, phone=?, category=?, last_booking_at=datetime(\'now\') WHERE id=?'
    ).run(vendorName, vendorPhone, category || 'other', vendorToken);
  } else {
    db.prepare(
      `INSERT INTO vendors (id, name, phone, category, active, is_regular, last_booking_at)
       VALUES (?,?,?,?,1,0,datetime('now'))`
    ).run(vendorToken, vendorName, vendorPhone, category || 'other');
  }

  res.status(201).json(bookingWithMeta(info.lastInsertRowid));
});

router.put('/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "สถานะต้องเป็น 'approved' หรือ 'rejected'" });
  }
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  if (status === 'approved' && hasOverlap(booking.stall_id, booking.start_date, booking.end_date, ['approved'], booking.id)) {
    return res.status(409).json({ error: 'ไม่สามารถอนุมัติได้ — ทับซ้อนกับการจองที่อนุมัติแล้ว' });
  }
  db.prepare("UPDATE bookings SET status=?, decided_at=datetime('now') WHERE id=?").run(status, req.params.id);
  res.json(bookingWithMeta(req.params.id));
});

router.put('/:id/payment', optionalAuth, loadOwnedBooking, (req, res) => {
  const { paymentStatus } = req.body || {};
  const isAdmin = req.user && req.user.kind === 'admin';
  if (paymentStatus === 'confirmed' && !isAdmin) {
    return res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่ตลาดเท่านั้นที่ยืนยันการรับเงินได้' });
  }
  if (!['paid', 'confirmed'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'สถานะการชำระเงินไม่ถูกต้อง' });
  }
  db.prepare('UPDATE bookings SET payment_status=? WHERE id=?').run(paymentStatus, req.params.id);
  res.json(bookingWithMeta(req.params.id));
});

router.post('/:id/receipt', optionalAuth, loadOwnedBooking, upload.single('receipt'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่มีรูปภาพที่อัปโหลด' });
  const receiptPath = `/uploads/receipts/${req.file.filename}`;
  db.prepare("UPDATE bookings SET receipt_path=?, payment_status='paid' WHERE id=?").run(receiptPath, req.params.id);
  res.json(bookingWithMeta(req.params.id));
});

router.delete('/:id', optionalAuth, loadOwnedBooking, (req, res) => {
  db.prepare("UPDATE bookings SET status='cancelled', decided_at=datetime('now') WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
