// 1.3 จัดการข้อมูลผู้ใช้ (D2 users). Least privilege:
// - ผู้ดูแลระบบ: the only role that adds, edits, suspends or deletes accounts and assigns roles.
// - เจ้าหน้าที่ตลาด: views and searches vendor data read-only (to contact and verify vendors); no admin/staff accounts.
// - ผู้ค้า: no access here; they edit only their own profile through /api/auth/me.
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu, requireHead } = require('../middleware/auth');
const { loadCategories, readGoods } = require('../goods');
const U = require('../users');

const router = express.Router();
router.param('id', wrap.numericIdParam);

const isAdmin = (req) => req.staff.role === db.ROLE.ADMIN;

async function listUsers(req, extraWhere = [], extraParams = []) {
  const where = [...extraWhere];
  const params = [...extraParams];
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
  // publicUser never includes password_hash.
  return rows.map((u) => ({
    ...U.publicUser(u, cats),
    bookingTotal: u.booking_total, bookingApproved: u.booking_approved, lastBookingAt: u.last_booking_at
  }));
}

// View and search: admin sees everyone, staff only vendors.
router.get('/', requireMenu('users'), wrap(async (req, res) => {
  res.json(await listUsers(req));
}));

router.get('/:id', requireMenu('users'), wrap(async (req, res) => {
  const rows = await listUsers(req, ['u.user_id = ?'], [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
  res.json(rows[0]);
}));

// Everything below changes accounts: ผู้ดูแลระบบ only.
router.use(requireHead);

// Checks shared by add and edit. Returns { status, body } on a problem, or null and fills `out`.
async function readUserForm(req, existing, out) {
  const body = req.body || {};
  const p = U.readProfile(body);
  const roleId = body.roleId === undefined ? (existing ? existing.role_id : db.ROLE.VENDOR) : Number(body.roleId);
  if (![1, 2, 3].includes(roleId)) return { status: 400, body: { error: 'สิทธิ์ผู้ใช้ไม่ถูกต้อง' } };
  const username = body.username !== undefined ? U.sanitizeUsername(body.username) : (existing ? existing.username || '' : '');
  const password = body.password ? String(body.password) : '';
  const values = {
    username, password: existing ? 'kept' : password,
    firstName: p.firstName ?? (existing ? existing.first_name : ''),
    lastName: p.lastName ?? (existing ? existing.last_name : ''),
    phone: p.phone ?? (existing ? existing.phone : ''),
    address: p.address ?? (existing ? existing.address : '')
  };
  // A new account needs every required field. An edit may not blank a field it sends; older accounts that are
  // still missing a field can be edited (e.g. suspended) and are asked to complete it at their next sign-in.
  const missing = existing
    ? U.REQUIRED.filter((k) => k !== 'password' && (body[k] !== undefined || (k === 'username' && body.username !== undefined)) && !String(values[k] || '').trim())
    : U.missingFields(values);
  if (missing.length) return { status: 400, body: { error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง', fields: missing } };
  if (p.phone !== undefined || !existing) {
    const phoneProblem = U.phoneError(values.phone);
    if (phoneProblem) return { status: 400, body: { error: phoneProblem, fields: ['phone'] } };
  }
  if (password) {
    const pwProblem = U.passwordError(password);
    if (pwProblem) return { status: 400, body: { error: pwProblem, fields: ['password'] } };
  }
  if (username && (await U.usernameTaken(username, existing && existing.user_id))) {
    return { status: 409, body: { error: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว', fields: ['username'] } };
  }
  const phoneChanged = !existing || values.phone !== existing.phone;
  if (phoneChanged && (await U.phoneTaken(values.phone, existing && existing.user_id))) {
    return { status: 409, body: { error: 'เบอร์โทรศัพท์นี้ถูกใช้ไปแล้ว', fields: ['phone'] } };
  }
  const hadLogin = !!(existing && existing.username && existing.password_hash && !existing.password_hash.startsWith('tok:'));
  if (username && !password && !hadLogin) return { status: 400, body: { error: 'กรุณาตั้งรหัสผ่านสำหรับชื่อผู้ใช้นี้', fields: ['password'] } };

  let categoryId = existing ? existing.category_id : null;
  if (roleId === db.ROLE.VENDOR && (body.category !== undefined || !existing)) {
    if (body.category == null || body.category === '') categoryId = null;
    else {
      const goods = readGoods(await loadCategories(), body);
      if (goods.error) return { status: 400, body: { error: goods.error, fields: ['category'] } };
      categoryId = goods.categoryId;
    }
  }
  if (roleId !== db.ROLE.VENDOR) categoryId = null;

  // Same first and last name as someone else: warn first, save only when the admin confirms.
  const nameChanged = !existing || values.firstName !== existing.first_name || values.lastName !== existing.last_name;
  if (nameChanged && body.confirmDuplicateName !== true) {
    const twin = await U.sameNameUser(values.firstName, values.lastName, existing && existing.user_id);
    if (twin) {
      return { status: 409, body: { error: `มีผู้ใช้ชื่อ "${values.firstName} ${values.lastName}" (${twin.role_name}) อยู่ในระบบแล้ว ต้องการบันทึกต่อหรือไม่`, code: 'DUPLICATE_NAME' } };
    }
  }

  Object.assign(out, {
    roleId,
    firstName: values.firstName, lastName: values.lastName, phone: values.phone, address: values.address || '',
    lineId: p.lineId !== undefined ? p.lineId || null : existing ? existing.line_id : null,
    username: username || null,
    passwordHash: password ? bcrypt.hashSync(password, 10) : (existing ? existing.password_hash : null),
    categoryId,
    isRegular: body.isRegular !== undefined ? !!body.isRegular : !!(existing && existing.is_regular),
    active: body.active !== undefined ? !!body.active : existing ? !!existing.active : true
  });
  return null;
}

router.post('/', wrap(async (req, res) => {
  const out = {};
  const problem = await readUserForm(req, null, out);
  if (problem) return res.status(problem.status).json(problem.body);
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
  const out = {};
  const problem = await readUserForm(req, existing, out);
  if (problem) return res.status(problem.status).json(problem.body);
  if (existing.user_id === req.staff.uid && (!out.active || out.roleId !== existing.role_id)) {
    return res.status(409).json({ error: 'ไม่สามารถระงับหรือเปลี่ยนสิทธิ์บัญชีของตนเองได้' });
  }
  if (existing.role_id === db.ROLE.ADMIN && (out.roleId !== db.ROLE.ADMIN || !out.active) && (await activeAdminsExcept(existing.user_id)) === 0) {
    return res.status(409).json({ error: 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 บัญชี' });
  }
  await db.run(
    `UPDATE users SET role_id=?, username=?, password_hash=?, first_name=?, last_name=?, phone=?, address=?, line_id=?,
       category_id=?, is_regular=?, active=? WHERE user_id=?`,
    [out.roleId, out.username, out.passwordHash, out.firstName, out.lastName, out.phone, out.address, out.lineId,
      out.categoryId, out.isRegular, out.active, existing.user_id]);
  res.json(U.publicUser(await U.getUser(existing.user_id), await loadCategories()));
}));

router.delete('/:id', wrap(async (req, res) => {
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
