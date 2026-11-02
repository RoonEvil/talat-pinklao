// Processes 3.0 จองล็อก, 4.0 อนุมัติการจอง and 5.0 ชำระเงิน (D8 bookings, D9 payments, D12 pictures).
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { imageUpload, savePicture, pictureUrl } = require('../files');
const { optionalAuth, optionalStaff, requireMenu, requireStaff } = require('../middleware/auth');
const { loadCategories, splitGoods, readGoods, goodsLabel, allowsGoods, allowedLabel, zoneAllowedIds } = require('../goods');
const { findNeighborClash } = require('../neighbors');
const U = require('../users');

const router = express.Router();
router.param('id', wrap.numericIdParam);

function countDays(start, end) {
  const n = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;
  return n > 0 ? n : 1;
}

function isIsoDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

const BOOKING_SELECT = `
  SELECT b.booking_id AS id, b.stall_id, s.zone_id, s.stall_code, z.zone_name, b.vendor_id,
    TRIM(u.first_name || ' ' || u.last_name) AS vendor_name, u.phone AS vendor_phone, u.username AS vendor_username,
    b.category_id, b.start_date, b.end_date, b.rate_type, b.total_amount, b.note, b.status, b.created_at, b.decided_at,
    b.created_by, TRIM(cb.first_name || ' ' || cb.last_name) AS created_by_name,
    b.approved_by, TRIM(ab.first_name || ' ' || ab.last_name) AS approved_by_name,
    p.payment_id, p.method AS payment_method, COALESCE(p.status, 'unpaid') AS payment_status, p.amount AS paid_amount,
    p.slip_picture_id, p.paid_at, p.confirmed_at, TRIM(pb.first_name || ' ' || pb.last_name) AS confirmed_by_name
  FROM bookings b
  JOIN stalls s ON s.stall_id = b.stall_id
  JOIN zones z ON z.zone_id = s.zone_id
  JOIN users u ON u.user_id = b.vendor_id
  LEFT JOIN users cb ON cb.user_id = b.created_by
  LEFT JOIN users ab ON ab.user_id = b.approved_by
  LEFT JOIN payments p ON p.booking_id = b.booking_id
  LEFT JOIN users pb ON pb.user_id = p.confirmed_by`;

function toApi(cats) {
  return (r) => {
    const g = splitGoods(cats, r.category_id);
    const { slip_picture_id: slip, ...rest } = r;
    return { ...rest, category: g.category, food_type: g.kind, goods_label: goodsLabel(cats, r.category_id), receipt_path: pictureUrl(slip) };
  };
}

async function listBookings(where = '', params = []) {
  const rows = await db.all(`${BOOKING_SELECT} ${where} ORDER BY b.created_at DESC, b.booking_id DESC`, params);
  return rows.map(toApi(await loadCategories()));
}

async function bookingById(id) {
  return (await listBookings('WHERE b.booking_id = ?', [id]))[0];
}

async function hasOverlap(stallId, startDate, endDate, statuses, excludeId) {
  const row = await db.get(
    `SELECT COUNT(*)::int AS c FROM bookings
     WHERE stall_id = ? AND status IN (${statuses.map(() => '?').join(',')}) AND booking_id <> ?
     AND ?::date <= end_date AND ?::date >= start_date`,
    [stallId, ...statuses, excludeId || -1, startDate, endDate]);
  return row.c > 0;
}

// A registered vendor books only the goods they signed up for.
function registeredGoodsError(cats, vendor, categoryId) {
  if (!vendor || !vendor.category_id) return null;
  if (categoryId === vendor.category_id) return null;
  const c = cats.byId.get(categoryId);
  if (c && c.parent_id === vendor.category_id) return null;
  return `ประเภทสินค้านี้ไม่ตรงกับที่ผู้ค้าลงทะเบียนไว้ (${goodsLabel(cats, vendor.category_id)})`;
}

// 3.3 ตรวจสอบประเภทสินค้าที่โซนอนุญาต
async function zoneGoodsError(cats, stall, categoryId) {
  const allowed = await zoneAllowedIds(stall.zone_id);
  if (allowsGoods(cats, allowed, categoryId)) return null;
  const zone = await db.get('SELECT zone_name FROM zones WHERE zone_id = ?', [stall.zone_id]);
  return `ล็อก ${stall.stall_code} อยู่ใน${zone.zone_name} ซึ่งรับเฉพาะ${allowedLabel(cats, allowed)} ` +
    `ไม่รับ${goodsLabel(cats, categoryId)} กรุณาเลือกล็อกในโซนอื่น`;
}

function clashMessage(cats, clash) {
  return `ล็อก ${clash.code} ที่อยู่ติดกันขาย${goodsLabel(cats, clash.category_id)}ในช่วงวันที่ทับกันอยู่แล้ว ` +
    '— ตลาดไม่ให้ร้านที่ขายของเหมือนกันอยู่ติดกัน กรุณาเลือกล็อกอื่นหรือช่วงวันอื่น';
}

// 3.2 + 3.4: the stall must be free on those dates, and no neighbouring stall may sell the same thing then.
async function placementError(cats, stallId, startDate, endDate, categoryId) {
  if (await hasOverlap(stallId, startDate, endDate, ['pending', 'approved'])) {
    return 'ล็อกนี้มีคำขอหรือการจองที่ทับซ้อนกับช่วงวันที่นี้อยู่แล้ว';
  }
  const clash = await findNeighborClash({ stallId, startDate, endDate, categoryId, statuses: ['pending', 'approved'] });
  return clash ? clashMessage(cats, clash) : null;
}

// Checks shared by vendor and staff bookings. Returns { stall, categoryId } or { status, error }.
async function checkBooking(cats, body, vendor) {
  const { stallId, startDate, endDate } = body;
  if (!wrap.isId(stallId)) return { status: 400, error: 'กรุณาเลือกล็อก' };
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) return { status: 400, error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  if (endDate < startDate) return { status: 400, error: 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม' };
  const goods = readGoods(cats, body);
  if (goods.error) return { status: 400, error: goods.error };
  const stall = await db.get('SELECT * FROM stalls WHERE stall_id = ?', [stallId]);
  if (!stall || !stall.active) return { status: 404, error: 'ล็อกนี้ไม่พร้อมให้จอง' };
  const goodsError = registeredGoodsError(cats, vendor, goods.categoryId);
  if (goodsError) return { status: 400, error: goodsError };
  const zoneError = await zoneGoodsError(cats, stall, goods.categoryId);
  if (zoneError) return { status: 400, error: zoneError };
  const placement = await placementError(cats, stall.stall_id, startDate, endDate, goods.categoryId);
  if (placement) return { status: 409, error: placement };
  return { stall, categoryId: goods.categoryId };
}

async function insertBooking(t, { stall, vendor, categoryId, startDate, endDate, note, status, createdBy }) {
  const regular = !!vendor.is_regular;
  const rate = regular ? stall.regular_price_per_day : stall.price_per_day;
  const row = await t.get(
    `INSERT INTO bookings (stall_id, vendor_id, category_id, start_date, end_date, rate_type, total_amount, note, status,
       created_by, approved_by, decided_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,${status === 'approved' ? 'NOW()' : 'NULL'}) RETURNING booking_id`,
    [stall.stall_id, vendor.user_id, categoryId, startDate, endDate, regular ? 'regular' : 'walkin',
      Number(rate) * countDays(startDate, endDate), note ? String(note).slice(0, 1000) : null, status,
      createdBy || null, status === 'approved' ? createdBy || null : null]);
  return row.booking_id;
}

// Who is asking: a signed-in vendor, or a guest identified by the random token their browser keeps.
async function requester(req) {
  if (req.user && req.user.role === db.ROLE.VENDOR) {
    return db.get('SELECT * FROM users WHERE user_id = ? AND role_id = 3', [req.user.uid]);
  }
  const token = req.get('x-vendor-token');
  if (!token || token.length < 8) return null;
  return db.get('SELECT * FROM users WHERE password_hash = ?', [db.guestHash(token)]);
}

const loadOwnedBooking = wrap(async (req, res, next) => {
  const booking = await db.get('SELECT * FROM bookings WHERE booking_id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  if (!req.staff) {
    const me = await requester(req);
    if (!me || me.user_id !== booking.vendor_id) return res.status(403).json({ error: 'ไม่มีสิทธิ์จัดการการจองนี้' });
  }
  req.booking = booking;
  next();
});

// Public occupancy feed — stall availability and what each stall sells, no vendor details.
router.get('/active', wrap(async (req, res) => {
  const cats = await loadCategories();
  const rows = await db.all(
    `SELECT stall_id, start_date, end_date, status, category_id FROM bookings
     WHERE status IN ('pending','approved') AND end_date >= CURRENT_DATE`);
  res.json(rows.map((r) => {
    const g = splitGoods(cats, r.category_id);
    return { stallId: r.stall_id, startDate: r.start_date, endDate: r.end_date, status: r.status, category: g.category, foodType: g.kind };
  }));
}));

// 8.1 สรุปยอดตามช่วงวันที่: approved bookings by rate type (walkin = ขาจร, regular = ขาประจำ).
router.get('/summary', requireMenu('reports'), wrap(async (req, res) => {
  const { from, to } = req.query;
  let where = "b.status = 'approved'";
  const params = [];
  if (isIsoDate(from)) { where += ' AND b.start_date >= ?::date'; params.push(from); }
  if (isIsoDate(to)) { where += ' AND b.start_date <= ?::date'; params.push(to); }
  const rows = await db.all(
    `SELECT b.rate_type, COUNT(*)::int AS count, COALESCE(SUM(b.total_amount), 0) AS total,
       SUM(CASE WHEN p.status = 'confirmed' THEN 1 ELSE 0 END)::int AS "confirmedCount",
       COALESCE(SUM(CASE WHEN p.status = 'confirmed' THEN p.amount ELSE 0 END), 0) AS "confirmedTotal"
     FROM bookings b LEFT JOIN payments p ON p.booking_id = b.booking_id
     WHERE ${where} GROUP BY b.rate_type`, params);
  const result = {
    walkin: { count: 0, total: 0, confirmedCount: 0, confirmedTotal: 0 },
    regular: { count: 0, total: 0, confirmedCount: 0, confirmedTotal: 0 }
  };
  rows.forEach((r) => {
    if (result[r.rate_type]) {
      result[r.rate_type] = { count: r.count, total: Number(r.total), confirmedCount: r.confirmedCount, confirmedTotal: Number(r.confirmedTotal) };
    }
  });
  res.json(result);
}));

// 4.4 ติดตามสถานะการจอง — signed-in vendors only; guests do not get a "my bookings" list.
router.get('/mine', optionalAuth, wrap(async (req, res) => {
  if (!req.user || req.user.role !== db.ROLE.VENDOR) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบผู้ค้าเพื่อดูการจองของฉัน' });
  const me = await requester(req);
  if (!me) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' });
  res.json(await listBookings('WHERE b.vendor_id = ?', [me.user_id]));
}));

// All bookings, for the staff menus that work with them.
router.get('/', requireStaff, wrap(async (req, res) => {
  if (!['bookings', 'payments', 'reports', 'inspections'].some((m) => req.staff.menus.includes(m))) {
    return res.status(403).json({ error: 'สิทธิ์ของคุณไม่สามารถใช้งานเมนูนี้ได้' });
  }
  const status = req.query.status;
  res.json(['pending', 'approved', 'rejected', 'cancelled'].includes(status)
    ? await listBookings('WHERE b.status = ?', [status])
    : await listBookings());
}));

// 3.1–3.5 ผู้ค้าส่งคำขอจอง
router.post('/', optionalAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const cats = await loadCategories();
  const isMember = req.user && req.user.role === db.ROLE.VENDOR;
  let vendor = null;
  if (isMember) {
    vendor = await db.get('SELECT * FROM users WHERE user_id = ? AND role_id = 3', [req.user.uid]);
    if (!vendor) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบใหม่' });
  } else {
    const token = req.get('x-vendor-token') || body.vendorToken;
    const n = db.splitName(body.vendorName);
    const phone = db.cleanPhone(body.vendorPhone);
    if (!token || String(token).length < 8 || !String(body.vendorName || '').trim() || !phone) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อและเบอร์โทรศัพท์ให้ครบ' });
    }
    const phoneProblem = U.phoneError(phone);
    if (phoneProblem) return res.status(400).json({ error: phoneProblem });
    if (body.consent !== true) return res.status(400).json({ error: 'กรุณายินยอมให้เก็บชื่อและเบอร์โทรศัพท์เพื่อใช้ติดต่อเรื่องการจอง' });
    const member = await db.get("SELECT user_id FROM users WHERE phone = ? AND username IS NOT NULL AND password_hash NOT LIKE 'tok:%'", [phone]);
    if (member) return res.status(403).json({ error: 'เบอร์โทรศัพท์นี้เป็นของสมาชิก กรุณาเข้าสู่ระบบก่อนจอง' });
    vendor = await db.get('SELECT * FROM users WHERE password_hash = ?', [db.guestHash(token)]);
    if (vendor) {
      vendor = await db.get('UPDATE users SET first_name=?, last_name=?, phone=? WHERE user_id=? RETURNING *', [n.first, n.last, phone, vendor.user_id]);
    } else {
      vendor = await db.get(
        `INSERT INTO users (role_id, password_hash, first_name, last_name, phone, consent_at) VALUES (3,?,?,?,?,NOW()) RETURNING *`,
        [db.guestHash(token), n.first, n.last, phone]);
    }
  }
  if (!vendor.active) return res.status(403).json({ error: 'บัญชีผู้ค้าของคุณถูกระงับโดยเจ้าหน้าที่ตลาด' });

  const check = await checkBooking(cats, body, isMember ? vendor : null);
  if (check.error) return res.status(check.status).json({ error: check.error });
  const id = await db.tx((t) => insertBooking(t, {
    stall: check.stall, vendor, categoryId: check.categoryId, startDate: body.startDate, endDate: body.endDate, note: body.note, status: 'pending'
  }));
  res.status(201).json(await bookingById(id));
}));

// 3.6 จองแทนผู้ค้า (Walk-in): approved at once; cash may be taken on the spot.
router.post('/staff', requireMenu('bookings'), wrap(async (req, res) => {
  const body = req.body || {};
  const cats = await loadCategories();
  let vendor;
  if (body.vendorId) {
    vendor = await db.get('SELECT * FROM users WHERE user_id = ? AND role_id = 3', [Number(body.vendorId)]);
    if (!vendor) return res.status(404).json({ error: 'ไม่พบผู้ค้านี้' });
    if (!vendor.active) return res.status(403).json({ error: 'ผู้ค้ารายนี้ถูกระงับอยู่' });
  } else {
    const name = String(body.vendorName || '').trim();
    const phone = db.cleanPhone(body.vendorPhone);
    if (!name || !phone) return res.status(400).json({ error: 'กรุณากรอกชื่อและเบอร์โทรศัพท์ของผู้ค้า' });
    const phoneProblem = U.phoneError(phone);
    if (phoneProblem) return res.status(400).json({ error: phoneProblem });
    vendor = await db.get(
      "SELECT * FROM users WHERE role_id = 3 AND phone = ? AND (password_hash IS NULL OR password_hash NOT LIKE 'tok:%') ORDER BY user_id LIMIT 1", [phone]);
    if (vendor && !vendor.active) return res.status(403).json({ error: 'ผู้ค้าเบอร์นี้ถูกระงับอยู่' });
    if (!vendor) {
      const n = db.splitName(name);
      vendor = await db.get('INSERT INTO users (role_id, first_name, last_name, phone) VALUES (3,?,?,?) RETURNING *', [n.first, n.last, phone]);
    }
  }
  const check = await checkBooking(cats, body, vendor.username ? vendor : null);
  if (check.error) return res.status(check.status).json({ error: check.error });
  const id = await db.tx(async (t) => {
    const bookingId = await insertBooking(t, {
      stall: check.stall, vendor, categoryId: check.categoryId, startDate: body.startDate, endDate: body.endDate,
      note: body.note, status: 'approved', createdBy: req.staff.uid
    });
    if (body.paidCash === true) {
      await t.run(
        `INSERT INTO payments (booking_id, method, amount, status, paid_at, confirmed_by, confirmed_at)
         SELECT booking_id, 'cash', total_amount, 'confirmed', NOW(), ?, NOW() FROM bookings WHERE booking_id = ?`,
        [req.staff.uid, bookingId]);
    }
    return bookingId;
  });
  res.status(201).json(await bookingById(id));
}));

// 4.2 อนุมัติ / ปฏิเสธการจอง
router.put('/:id/status', requireMenu('bookings'), wrap(async (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'สถานะต้องเป็นอนุมัติหรือปฏิเสธ' });
  const booking = await db.get('SELECT * FROM bookings WHERE booking_id = ?', [req.params.id]);
  if (!booking) return res.status(404).json({ error: 'ไม่พบการจองนี้' });
  if (booking.status !== 'pending') return res.status(409).json({ error: 'การจองนี้ได้รับการพิจารณาไปแล้ว' });
  if (status === 'approved') {
    const cats = await loadCategories();
    if (await hasOverlap(booking.stall_id, booking.start_date, booking.end_date, ['approved'], booking.booking_id)) {
      return res.status(409).json({ error: 'ไม่สามารถอนุมัติได้ — ทับซ้อนกับการจองที่อนุมัติแล้ว' });
    }
    const stall = await db.get('SELECT * FROM stalls WHERE stall_id = ?', [booking.stall_id]);
    const zoneError = await zoneGoodsError(cats, stall, booking.category_id);
    if (zoneError) return res.status(409).json({ error: 'ไม่สามารถอนุมัติได้ — ' + zoneError });
    const clash = await findNeighborClash({
      stallId: booking.stall_id, startDate: booking.start_date, endDate: booking.end_date,
      categoryId: booking.category_id, statuses: ['approved'], excludeId: booking.booking_id
    });
    if (clash) return res.status(409).json({ error: 'ไม่สามารถอนุมัติได้ — ' + clashMessage(cats, clash) });
  }
  await db.run('UPDATE bookings SET status=?, approved_by=?, decided_at=NOW() WHERE booking_id=?', [status, req.staff.uid, booking.booking_id]);
  res.json(await bookingById(booking.booking_id));
}));

const PAYMENT_METHODS = ['promptpay', 'transfer', 'cash'];

// 5.2 แจ้งชำระเงิน (ผู้ค้า) / 5.4 ยืนยันการรับเงิน (เจ้าหน้าที่ตลาด)
router.put('/:id/payment', optionalStaff('payments'), loadOwnedBooking, wrap(async (req, res) => {
  const { paymentStatus, paymentMethod } = req.body || {};
  if (!['paid', 'confirmed'].includes(paymentStatus)) return res.status(400).json({ error: 'สถานะการชำระเงินไม่ถูกต้อง' });
  if (paymentStatus === 'confirmed' && !req.staff) return res.status(403).json({ error: 'เฉพาะเจ้าหน้าที่ตลาดเท่านั้นที่ยืนยันการรับเงินได้' });
  if (req.booking.status !== 'approved') return res.status(400).json({ error: 'ชำระเงินได้หลังเจ้าหน้าที่อนุมัติการจองแล้วเท่านั้น' });
  if (paymentMethod != null && !PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ error: 'วิธีการชำระเงินไม่ถูกต้อง' });
  const existing = await db.get('SELECT * FROM payments WHERE booking_id = ?', [req.booking.booking_id]);
  if (existing && existing.status === 'confirmed' && !req.staff) return res.status(409).json({ error: 'การชำระเงินนี้ได้รับการยืนยันแล้ว' });
  const method = paymentMethod || (existing && existing.method) || (paymentStatus === 'confirmed' ? 'cash' : 'promptpay');
  if (paymentStatus === 'paid') {
    await db.run(
      `INSERT INTO payments (booking_id, method, amount, status, paid_at) VALUES (?,?,?, 'paid', NOW())
       ON CONFLICT (booking_id) DO UPDATE SET method = EXCLUDED.method, status = 'paid', paid_at = NOW(), confirmed_by = NULL, confirmed_at = NULL`,
      [req.booking.booking_id, method, req.booking.total_amount]);
  } else {
    await db.run(
      `INSERT INTO payments (booking_id, method, amount, status, paid_at, confirmed_by, confirmed_at) VALUES (?,?,?, 'confirmed', NOW(), ?, NOW())
       ON CONFLICT (booking_id) DO UPDATE SET method = EXCLUDED.method, status = 'confirmed', confirmed_by = EXCLUDED.confirmed_by, confirmed_at = NOW()`,
      [req.booking.booking_id, method, req.booking.total_amount, req.staff.uid]);
  }
  res.json(await bookingById(req.booking.booking_id));
}));

// 5.2 แนบสลิป: after the vendor reported the transfer (staff may attach one any time).
router.post('/:id/receipt', optionalStaff('payments'), loadOwnedBooking, wrap(async (req, res, next) => {
  const payment = await db.get('SELECT * FROM payments WHERE booking_id = ?', [req.booking.booking_id]);
  if (!req.staff && !(req.booking.status === 'approved' && payment && payment.status === 'paid')) {
    return res.status(400).json({ error: 'แนบสลิปได้หลังกด "โอนเงินแล้ว" เท่านั้น' });
  }
  req.payment = payment;
  next();
}), imageUpload('receipt', 8 * 1024 * 1024), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกไฟล์รูป JPG, PNG, WEBP หรือ GIF' });
  await db.tx(async (t) => {
    const pictureId = await savePicture(t, req.file, 'slip', req.user ? req.user.uid : req.booking.vendor_id);
    if (req.payment) {
      await t.run('UPDATE payments SET slip_picture_id = ? WHERE payment_id = ?', [pictureId, req.payment.payment_id]);
      if (req.payment.slip_picture_id) await t.run('DELETE FROM pictures WHERE picture_id = ?', [req.payment.slip_picture_id]);
    } else {
      await t.run("INSERT INTO payments (booking_id, method, amount, slip_picture_id, status) VALUES (?, 'transfer', ?, ?, 'paid')",
        [req.booking.booking_id, req.booking.total_amount, pictureId]);
    }
  });
  res.json(await bookingById(req.booking.booking_id));
}));

// 4.3 ยกเลิกการจอง: vendors cancel their own unpaid bookings; staff may cancel any open booking.
router.delete('/:id', optionalStaff('bookings'), loadOwnedBooking, wrap(async (req, res) => {
  if (!['pending', 'approved'].includes(req.booking.status)) return res.status(400).json({ error: 'การจองนี้ถูกยกเลิกหรือปฏิเสธไปแล้ว' });
  const payment = await db.get('SELECT status FROM payments WHERE booking_id = ?', [req.booking.booking_id]);
  if (!req.staff && payment) return res.status(400).json({ error: 'แจ้งชำระเงินแล้ว ยกเลิกเองไม่ได้ กรุณาติดต่อเจ้าหน้าที่ตลาด' });
  await db.run("UPDATE bookings SET status='cancelled', decided_at=NOW() WHERE booking_id=?", [req.booking.booking_id]);
  res.json({ ok: true });
}));

module.exports = router;
