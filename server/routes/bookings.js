const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { imageUpload, saveImage } = require('../files');
const { optionalAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

function countDays(start, end) {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const n = Math.round((e - s) / 86400000) + 1;
  return n > 0 ? n : 1;
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

async function hasOverlap(stallId, startDate, endDate, statuses, excludeId) {
  const placeholders = statuses.map(() => '?').join(',');
  const row = await db.get(
    `SELECT COUNT(*)::int AS c FROM bookings
     WHERE stall_id = ? AND status IN (${placeholders}) AND id != ?
     AND ?::date <= end_date::date AND ?::date >= start_date::date`,
    [stallId, ...statuses, excludeId || -1, startDate, endDate]
  );
  return row.c > 0;
}

async function isRegisteredVendor(id) {
  const v = await db.get('SELECT password_hash FROM vendors WHERE id = ?', [id]);
  return !!(v && v.password_hash);
}

// Registered vendors must prove identity with their JWT. Guests prove it with the random
// token their browser holds (X-Vendor-Token); a registered vendor's username is never accepted there.
async function requesterToken(req) {
  if (req.user && req.user.kind === 'vendor') return req.user.id;
  const token = req.get('x-vendor-token');
  if (!token || (await isRegisteredVendor(token))) return null;
  return token;
}

const loadOwnedBooking = wrap(async (req, res, next) => {
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  const isAdmin = req.user && req.user.kind === 'admin';
  if (!isAdmin && (await requesterToken(req)) !== booking.vendor_token) {
    return res.status(403).json({ error: 'ไม่มีสิทธิ์จัดการการจองนี้' });
  }
  req.booking = booking;
  next();
});

function bookingWithMeta(id) {
  return db.get(
    `SELECT b.*, s.code AS stall_code, z.name AS zone_name
     FROM bookings b
     JOIN stalls s ON s.id = b.stall_id
     JOIN zones z ON z.id = b.zone_id
     WHERE b.id = ?`,
    [id]
  );
}

// Public occupancy feed — just enough to render stall availability, no vendor details.
router.get('/active', wrap(async (req, res) => {
  res.json(await db.all(
    `SELECT stall_id AS "stallId", start_date AS "startDate", end_date AS "endDate", status
     FROM bookings WHERE status IN ('pending','approved') AND end_date::date >= CURRENT_DATE`
  ));
}));

// Admin: totals by rate type (guest = ขาจร, regular = ขาประจำ), optionally filtered by start_date range.
router.get('/summary', requireAdmin, wrap(async (req, res) => {
  const { from, to } = req.query;
  let where = "status = 'approved'";
  const params = [];
  if (isIsoDate(from)) { where += ' AND start_date >= ?'; params.push(from); }
  if (isIsoDate(to)) { where += ' AND start_date <= ?'; params.push(to); }
  const rows = await db.all(
    `SELECT rate_type,
       COUNT(*)::int AS count,
       COALESCE(SUM(deposit_amount), 0) AS total,
       SUM(CASE WHEN payment_status='confirmed' THEN 1 ELSE 0 END)::int AS "confirmedCount",
       COALESCE(SUM(CASE WHEN payment_status='confirmed' THEN deposit_amount ELSE 0 END), 0) AS "confirmedTotal"
     FROM bookings WHERE ${where} GROUP BY rate_type`,
    params
  );
  const result = {
    guest: { count: 0, total: 0, confirmedCount: 0, confirmedTotal: 0 },
    regular: { count: 0, total: 0, confirmedCount: 0, confirmedTotal: 0 }
  };
  rows.forEach((r) => {
    if (result[r.rate_type]) {
      result[r.rate_type] = {
        count: r.count || 0,
        total: Number(r.total) || 0,
        confirmedCount: r.confirmedCount || 0,
        confirmedTotal: Number(r.confirmedTotal) || 0
      };
    }
  });
  res.json(result);
}));

router.get('/mine', optionalAuth, wrap(async (req, res) => {
  const token = await requesterToken(req);
  if (!token) return res.json([]);
  res.json(await db.all(
    `SELECT b.*, s.code AS stall_code, z.name AS zone_name FROM bookings b
     JOIN stalls s ON s.id = b.stall_id JOIN zones z ON z.id = b.zone_id
     WHERE b.vendor_token = ? ORDER BY b.created_at DESC`,
    [token]
  ));
}));

router.get('/', requireAdmin, wrap(async (req, res) => {
  const status = req.query.status;
  const base = `SELECT b.*, s.code AS stall_code, z.name AS zone_name FROM bookings b
    JOIN stalls s ON s.id = b.stall_id JOIN zones z ON z.id = b.zone_id`;
  const rows = status
    ? await db.all(`${base} WHERE b.status = ? ORDER BY b.created_at DESC`, [status])
    : await db.all(`${base} ORDER BY b.created_at DESC`);
  res.json(rows);
}));

router.post('/', optionalAuth, wrap(async (req, res) => {
  const {
    stallId, vendorName, vendorPhone, category,
    startDate, endDate, note
  } = req.body || {};
  const isVendorLogin = req.user && req.user.kind === 'vendor';
  const vendorToken = isVendorLogin ? req.user.id : (req.body || {}).vendorToken;
  if (!stallId || !vendorToken || !vendorName || !vendorPhone || !startDate || !endDate) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลที่จำเป็นให้ครบ' });
  }
  if (!wrap.isId(stallId)) return res.status(404).json({ error: 'ล็อกนี้ไม่พร้อมให้จอง' });
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return res.status(400).json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' });
  }
  if (!isVendorLogin && (await isRegisteredVendor(vendorToken))) {
    return res.status(403).json({ error: 'กรุณาเข้าสู่ระบบบัญชีนี้ก่อนจอง' });
  }
  if (endDate < startDate) return res.status(400).json({ error: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' });

  const stall = await db.get('SELECT * FROM stalls WHERE id = ?', [stallId]);
  if (!stall || !stall.active) return res.status(404).json({ error: 'ล็อกนี้ไม่พร้อมให้จอง' });

  const vendor = await db.get('SELECT * FROM vendors WHERE id = ?', [vendorToken]);
  if (vendor && !vendor.active) {
    return res.status(403).json({ error: 'บัญชีผู้ขายของคุณถูกระงับโดยเจ้าหน้าที่ตลาด' });
  }

  if (await hasOverlap(stallId, startDate, endDate, ['pending', 'approved'])) {
    return res.status(409).json({ error: 'ล็อกนี้มีคำขอหรือการจองที่ทับซ้อนกับช่วงวันที่นี้อยู่แล้ว' });
  }

  const isRegular = !!(vendor && vendor.is_regular);
  const rate = isRegular ? stall.regular_price_per_day : stall.price_per_day;
  const depositAmount = rate * countDays(startDate, endDate);

  const created = await db.get(
    `INSERT INTO bookings
     (stall_id, zone_id, vendor_token, vendor_name, vendor_phone, category, start_date, end_date, note,
      deposit_amount, rate_type, payment_method, payment_status, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'pending') RETURNING id`,
    [
      stallId, stall.zone_id, vendorToken, vendorName, vendorPhone, category || 'other',
      startDate, endDate, note || null,
      // Payment is chosen and made after approval, so every new booking starts unpaid.
      depositAmount, isRegular ? 'regular' : 'guest', 'promptpay', 'unpaid'
    ]
  );

  if (vendor) {
    await db.run('UPDATE vendors SET name=?, phone=?, category=?, last_booking_at=NOW() WHERE id=?', [
      vendorName, vendorPhone, category || 'other', vendorToken
    ]);
  } else {
    await db.run(
      `INSERT INTO vendors (id, name, phone, category, active, is_regular, last_booking_at)
       VALUES (?,?,?,?,1,0,NOW())`,
      [vendorToken, vendorName, vendorPhone, category || 'other']
    );
  }

  res.status(201).json(await bookingWithMeta(created.id));
}));

router.put('/:id/status', requireAdmin, wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "สถานะต้องเป็น 'approved' หรือ 'rejected'" });
  }
  const booking = await db.get('SELECT * FROM bookings WHERE id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  if (status === 'approved' && (await hasOverlap(booking.stall_id, booking.start_date, booking.end_date, ['approved'], booking.id))) {
    return res.status(409).json({ error: 'ไม่สามารถอนุมัติได้ — ทับซ้อนกับการจองที่อนุมัติแล้ว' });
  }
  await db.run('UPDATE bookings SET status=?, decided_at=NOW() WHERE id=?', [status, booking.id]);
  res.json(await bookingWithMeta(booking.id));
}));

const PAYMENT_METHODS = ['promptpay', 'bank', 'cash'];

// Flow: booking approved → vendor pays and reports it ('paid') → vendor attaches slip → staff confirms.
router.put('/:id/payment', optionalAuth, loadOwnedBooking, wrap(async (req, res) => {
  const { paymentStatus, paymentMethod } = req.body || {};
  const isAdmin = req.user && req.user.kind === 'admin';
  if (paymentStatus === 'confirmed' && !isAdmin) {
    return res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่ตลาดเท่านั้นที่ยืนยันการรับเงินได้' });
  }
  if (!['paid', 'confirmed'].includes(paymentStatus)) {
    return res.status(400).json({ error: 'สถานะการชำระเงินไม่ถูกต้อง' });
  }
  if (req.booking.status !== 'approved') {
    return res.status(400).json({ error: 'ชำระเงินได้หลังเจ้าหน้าที่อนุมัติการจองแล้วเท่านั้น' });
  }
  if (paymentMethod != null && !PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ error: 'วิธีการชำระเงินไม่ถูกต้อง' });
  }
  await db.run('UPDATE bookings SET payment_status=?, payment_method=COALESCE(?, payment_method) WHERE id=?', [
    paymentStatus, paymentMethod || null, req.booking.id
  ]);
  res.json(await bookingWithMeta(req.booking.id));
}));

const requireReportedPayment = (req, res, next) => {
  const isAdmin = req.user && req.user.kind === 'admin';
  if (!isAdmin && !(req.booking.status === 'approved' && req.booking.payment_status === 'paid')) {
    return res.status(400).json({ error: 'แนบสลิปได้หลังกด "โอนเงินแล้ว" เท่านั้น' });
  }
  next();
};

router.post('/:id/receipt', optionalAuth, loadOwnedBooking, requireReportedPayment, imageUpload('receipt', 8 * 1024 * 1024), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกไฟล์รูป JPG, PNG, WEBP หรือ GIF' });
  const receiptPath = await saveImage(req.file);
  await db.run('UPDATE bookings SET receipt_path=? WHERE id=?', [receiptPath, req.booking.id]);
  if (req.booking.receipt_path && req.booking.receipt_path.startsWith('/files/')) {
    await db.run('DELETE FROM files WHERE id = ?', [req.booking.receipt_path.replace('/files/', '')]);
  }
  res.json(await bookingWithMeta(req.booking.id));
}));

router.delete('/:id', optionalAuth, loadOwnedBooking, wrap(async (req, res) => {
  const isAdmin = req.user && req.user.kind === 'admin';
  if (!['pending', 'approved'].includes(req.booking.status)) {
    return res.status(400).json({ error: 'การจองนี้ถูกยกเลิกหรือปฏิเสธไปแล้ว' });
  }
  if (!isAdmin && req.booking.payment_status !== 'unpaid') {
    return res.status(400).json({ error: 'ชำระเงินแล้ว ยกเลิกเองไม่ได้ กรุณาติดต่อเจ้าหน้าที่ตลาด' });
  }
  await db.run("UPDATE bookings SET status='cancelled', decided_at=NOW() WHERE id=?", [req.booking.id]);
  res.json({ ok: true });
}));

module.exports = router;
