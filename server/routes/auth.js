const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const wrap = require('../wrap');
const { signUser, optionalAuth } = require('../middleware/auth');
const { loadCategories, readGoods } = require('../goods');
const U = require('../users');

const router = express.Router();

// What the browser keeps about the signed-in user, including which staff menus the role may open.
async function sessionUser(id) {
  const u = await U.getUser(id);
  if (!u) return null;
  const out = U.publicUser(u, await loadCategories());
  if (u.role_id !== db.ROLE.VENDOR) {
    const role = await db.get('SELECT menu_access FROM roles WHERE role_id = ?', [u.role_id]);
    out.menus = u.role_id === db.ROLE.ADMIN ? db.MENUS.slice() : String(role.menu_access || '').split(',').filter(Boolean);
  }
  return out;
}

// 1.1 สมัครสมาชิกผู้ค้า: profile, one category of goods, and PDPA consent.
router.post('/register', wrap(async (req, res) => {
  const body = req.body || {};
  const p = U.readProfile(body);
  const username = U.sanitizeUsername(body.username);
  const password = String(body.password || '');
  if (!p.firstName || !p.lastName || !p.phone || !username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ นามสกุล เบอร์โทรศัพท์ ชื่อผู้ใช้ และรหัสผ่านให้ครบ' });
  }
  const phoneProblem = U.phoneError(p.phone);
  if (phoneProblem) return res.status(400).json({ error: phoneProblem });
  if (password.length < 4) return res.status(400).json({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
  if (body.consent !== true) {
    return res.status(400).json({ error: 'กรุณายินยอมให้เก็บและใช้ข้อมูลส่วนบุคคลก่อนสมัครสมาชิก' });
  }
  const goods = readGoods(await loadCategories(), body);
  if (goods.error) return res.status(400).json({ error: goods.error });
  if (await U.usernameTaken(username)) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' });
  if (await U.phoneTaken(p.phone)) return res.status(409).json({ error: 'เบอร์โทรศัพท์นี้ถูกใช้สมัครสมาชิกไปแล้ว' });

  const row = await db.get(
    `INSERT INTO users (role_id, username, password_hash, first_name, last_name, phone, address, line_id, category_id, consent_at)
     VALUES (3,?,?,?,?,?,?,?,?,NOW()) RETURNING user_id, role_id`,
    [username, bcrypt.hashSync(password, 10), p.firstName, p.lastName, p.phone, p.address || null, p.lineId || null, goods.categoryId]
  );
  res.status(201).json({ token: signUser(row), user: await sessionUser(row.user_id) });
}));

// 1.2 เข้าสู่ระบบและตรวจสอบสิทธิ์ — one login for every role.
router.post('/login', wrap(async (req, res) => {
  const username = U.sanitizeUsername((req.body || {}).username);
  const password = String((req.body || {}).password || '');
  if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  const u = await db.get('SELECT user_id, role_id, password_hash, active FROM users WHERE username = ?', [username]);
  const hash = u && u.password_hash && !u.password_hash.startsWith('tok:') ? u.password_hash : null;
  if (!hash || !bcrypt.compareSync(password, hash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (!u.active) return res.status(403).json({ error: 'บัญชีนี้ถูกปิดใช้งานแล้ว' });
  res.json({ token: signUser(u), user: await sessionUser(u.user_id) });
}));

function requireSignedIn(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  next();
}

router.get('/me', optionalAuth, requireSignedIn, wrap(async (req, res) => {
  const user = await sessionUser(req.user.uid);
  if (!user || !user.active) return res.status(401).json({ error: 'บัญชีนี้ถูกปิดใช้งานแล้ว' });
  res.json(user);
}));

// 1.3 ผู้ใช้แก้ไขข้อมูลส่วนตัวของตนเอง (ชื่อ เบอร์ ที่อยู่ Line ID และรหัสผ่าน).
router.put('/me', optionalAuth, requireSignedIn, wrap(async (req, res) => {
  const me = await U.getUser(req.user.uid);
  if (!me || !me.active) return res.status(401).json({ error: 'บัญชีนี้ถูกปิดใช้งานแล้ว' });
  const body = req.body || {};
  const p = U.readProfile(body);
  if (p.firstName === '' || p.lastName === '') return res.status(400).json({ error: 'กรุณากรอกชื่อและนามสกุล' });
  if (p.phone !== undefined) {
    const phoneProblem = U.phoneError(p.phone);
    if (phoneProblem) return res.status(400).json({ error: phoneProblem });
    if (await U.phoneTaken(p.phone, me.user_id)) return res.status(409).json({ error: 'เบอร์โทรศัพท์นี้ถูกใช้ไปแล้ว' });
  }
  let hash = me.password_hash;
  if (body.newPassword) {
    if (String(body.newPassword).length < 4) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร' });
    if (!bcrypt.compareSync(String(body.currentPassword || ''), me.password_hash || '')) {
      return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }
    hash = bcrypt.hashSync(String(body.newPassword), 10);
  }
  await db.run(
    'UPDATE users SET first_name=?, last_name=?, phone=?, address=?, line_id=?, password_hash=? WHERE user_id=?',
    [p.firstName ?? me.first_name, p.lastName ?? me.last_name, p.phone ?? me.phone,
      p.address !== undefined ? p.address || null : me.address, p.lineId !== undefined ? p.lineId || null : me.line_id, hash, me.user_id]
  );
  res.json(await sessionUser(me.user_id));
}));

module.exports = router;
module.exports.sessionUser = sessionUser;
