// 1.3 จัดการข้อมูลผู้ใช้: one users table for all three roles. The admin manages everyone;
// market staff manage vendors only (add, edit, search, suspend, mark regular) and cannot delete.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu } = require('../middleware/auth');
const { loadCategories, readGoods } = require('../goods');
const U = require('../users');

const router = express.Router();
router.param('id', wrap.numericIdParam);
router.use(requireMenu('users'));

const isAdmin = (req) => req.staff.role === db.ROLE.ADMIN;

router.get('/', wrap(async (req, res) => {
  const where = [];
  const params = [];
  const role = Number(req.query.role);
  if (!isAdmin(req)) where.push('u.role_id = 3');
  else if ([1, 2, 3].includes(role)) { where.push('u.role_id = ?'); params.push(role); }
  const q = String(req.query.q || '').trim();
  if (q) {
    where.push("(u.first_name || ' ' || u.last_name ILIKE ? OR u.phone LIKE ? OR COALESCE(u.username,'') ILIKE ? OR COALESCE(u.line_id,'') ILIKE ?)");
    params.push(`%${q}%`, `%${q.replace(/[\s-]/g, '')}%`, `%${q}%`, `%${q}%`);
  }
  const rows = await db.all(
    `SELECT ${U.USER_COLS},
       (SELECT COUNT(*)::int FROM bookings b WHERE b.vendor_id = u.user_id) AS booking_total,
       (SELECT COUNT(*)::int FROM bookings b WHERE b.vendor_id = u.user_id AND b.status = 'approved') AS booking_approved,
       (SELECT MAX(b.created_at) FROM bookings b WHERE b.vendor_id = u.user_id) AS last_booking_at
     FROM users u JOIN roles r ON r.role_id = u.role_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY u.role_id, u.first_name, u.last_name`, params);
  const cats = await loadCategories();
  res.json(rows.map((u) => ({
    ...U.publicUser(u, cats),
    bookingTotal: u.booking_total, bookingApproved: u.booking_approved, lastBookingAt: u.last_booking_at
  })));
}));

// Checks shared by add and edit. Returns an error message or null; fills `out` with the values to save.
async function readUserForm(req, existing, out) {
  const body = req.body || {};
  const p = U.readProfile(body);
  const roleId = body.roleId === undefined ? (existing ? existing.role_id : db.ROLE.VENDOR) : Number(body.roleId);
  if (![1, 2, 3].includes(roleId)) return 'สิทธิ์ผู้ใช้ไม่ถูกต้อง';
  if (!isAdmin(req) && roleId !== db.ROLE.VENDOR) return 'เจ้าหน้าที่ตลาดจัดการได้เฉพาะข้อมูลผู้ค้า';
  const firstName = p.firstName ?? (existing && existing.first_name);
  const lastName = p.lastName ?? (existing && existing.last_name);
  const phone = p.phone ?? (existing && existing.phone);
  // Accounts moved from the first version may have no last name; it is required when adding or changing it.
  if (!firstName || (!lastName && (!existing || p.lastName !== undefined))) return 'กรุณากรอกชื่อและนามสกุล';
  if (!phone && (!existing || p.phone !== undefined)) return 'กรุณากรอกเบอร์โทรศัพท์';
  if (p.phone !== undefined || !existing) {
    const phoneProblem = U.phoneError(phone);
    if (phoneProblem) return phoneProblem;
  }
  // Only a new or changed phone is checked, so older duplicate records can still be suspended or edited.
  const phoneChanged = !existing || phone !== existing.phone;
  if (phoneChanged && (await U.phoneTaken(phone, existing && existing.user_id))) return 'เบอร์โทรศัพท์นี้ถูกใช้ไปแล้ว';

  // Login: staff always have one; a vendor may be kept without one (e.g. someone who never uses the app).
  const username = body.username !== undefined ? U.sanitizeUsername(body.username) : (existing ? existing.username : '');
  const password = body.password ? String(body.password) : '';
  if (username && (await U.usernameTaken(username, existing && existing.user_id))) return 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว';
  if (password && password.length < 4) return 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร';
  const hadLogin = !!(existing && existing.username && existing.password_hash && !existing.password_hash.startsWith('tok:'));
  if (roleId !== db.ROLE.VENDOR && !username) return 'ผู้ดูแลระบบและเจ้าหน้าที่ตลาดต้องมีชื่อผู้ใช้';
  if (username && !password && !hadLogin) return 'กรุณาตั้งรหัสผ่านสำหรับชื่อผู้ใช้นี้';

  let categoryId = existing ? existing.category_id : null;
  if (roleId === db.ROLE.VENDOR && (body.category !== undefined || !existing)) {
    if (body.category == null || body.category === '') categoryId = null;
    else {
      const goods = readGoods(await loadCategories(), body);
      if (goods.error) return goods.error;
      categoryId = goods.categoryId;
    }
  }
  if (roleId !== db.ROLE.VENDOR) categoryId = null;

  // Same first and last name as someone else: warn first, save only when the user confirms.
  const nameChanged = !existing || firstName !== existing.first_name || lastName !== existing.last_name;
  if (nameChanged && body.confirmDuplicateName !== true) {
    const twin = await U.sameNameUser(firstName, lastName, existing && existing.user_id);
    if (twin) {
      out.duplicateName = `มีผู้ใช้ชื่อ "${firstName} ${lastName}" (${twin.role_name}) อยู่ในระบบแล้ว ต้องการบันทึกต่อหรือไม่`;
      return out.duplicateName;
    }
  }

  Object.assign(out, {
    roleId, firstName, lastName, phone,
    address: p.address !== undefined ? p.address || null : existing ? existing.address : null,
    lineId: p.lineId !== undefined ? p.lineId || null : existing ? existing.line_id : null,
    username: username || null,
    passwordHash: password ? bcrypt.hashSync(password, 10) : (username ? existing && existing.password_hash : (hadLogin ? null : existing && existing.password_hash)),
    categoryId,
    isRegular: body.isRegular !== undefined ? !!body.isRegular : !!(existing && existing.is_regular),
    active: body.active !== undefined ? !!body.active : existing ? !!existing.active : true
  });
  return null;
}

function formError(res, out, message) {
  if (out.duplicateName) return res.status(409).json({ error: message, code: 'DUPLICATE_NAME' });
  return res.status(400).json({ error: message });
}

router.post('/', wrap(async (req, res) => {
  const out = {};
  const problem = await readUserForm(req, null, out);
  if (problem) return formError(res, out, problem);
  const row = await db.get(
    `INSERT INTO users (role_id, username, password_hash, first_name, last_name, phone, address, line_id, category_id, is_regular, active, consent_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING user_id`,
    [out.roleId, out.username, out.passwordHash, out.firstName, out.lastName, out.phone, out.address, out.lineId,
      out.categoryId, out.isRegular, out.active, req.body.consent === true ? new Date() : null]);
  res.status(201).json(U.publicUser(await U.getUser(row.user_id), await loadCategories()));
}));

async function activeAdminsExcept(id) {
  return (await db.get('SELECT COUNT(*)::int AS c FROM users WHERE role_id = 1 AND active AND user_id <> ?', [id])).c;
}

router.put('/:id', wrap(async (req, res) => {
  const existing = await U.getUser(req.params.id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
  if (!isAdmin(req) && existing.role_id !== db.ROLE.VENDOR) return res.status(403).json({ error: 'เจ้าหน้าที่ตลาดจัดการได้เฉพาะข้อมูลผู้ค้า' });
  const out = {};
  const problem = await readUserForm(req, existing, out);
  if (problem) return formError(res, out, problem);
  if (existing.role_id === db.ROLE.ADMIN && (out.roleId !== db.ROLE.ADMIN || !out.active) && (await activeAdminsExcept(existing.user_id)) === 0) {
    return res.status(409).json({ error: 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 บัญชี' });
  }
  if (existing.user_id === req.staff.uid && (!out.active || out.roleId !== existing.role_id)) {
    return res.status(409).json({ error: 'ไม่สามารถระงับหรือเปลี่ยนสิทธิ์บัญชีของตนเองได้' });
  }
  await db.run(
    `UPDATE users SET role_id=?, username=?, password_hash=?, first_name=?, last_name=?, phone=?, address=?, line_id=?,
       category_id=?, is_regular=?, active=? WHERE user_id=?`,
    [out.roleId, out.username, out.passwordHash, out.firstName, out.lastName, out.phone, out.address, out.lineId,
      out.categoryId, out.isRegular, out.active, existing.user_id]);
  res.json(U.publicUser(await U.getUser(existing.user_id), await loadCategories()));
}));

router.delete('/:id', wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบผู้ใช้ได้' });
  const existing = await U.getUser(req.params.id);
  if (!existing) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
  if (existing.user_id === req.staff.uid) return res.status(409).json({ error: 'ไม่สามารถลบบัญชีของตนเองได้' });
  if (existing.role_id === db.ROLE.ADMIN && (await activeAdminsExcept(existing.user_id)) === 0) {
    return res.status(409).json({ error: 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 บัญชี' });
  }
  const used = await db.get('SELECT COUNT(*)::int AS c FROM bookings WHERE vendor_id = ?', [existing.user_id]);
  if (used.c > 0) {
    return res.status(409).json({ error: `ผู้ใช้นี้มีประวัติการจอง ${used.c} รายการ จึงลบไม่ได้ กรุณาระงับบัญชีแทน` });
  }
  await db.run('DELETE FROM users WHERE user_id = ?', [existing.user_id]);
  res.status(204).end();
}));

module.exports = router;
