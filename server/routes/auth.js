const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const wrap = require('../wrap');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function sanitizeUsername(u) {
  return String(u || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

// Register a new vendor account (self-serve).
router.post('/register', wrap(async (req, res) => {
  const { name, phone, username: rawUsername, password } = req.body || {};
  const username = sanitizeUsername(rawUsername);
  if (!name || !phone || !username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ เบอร์โทรศัพท์ ชื่อผู้ใช้ และรหัสผ่านให้ครบ' });
  }
  if (password.length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
  }
  const adminClash = await db.get('SELECT username FROM admins WHERE username = ?', [username]);
  const vendorClash = await db.get('SELECT id FROM vendors WHERE id = ?', [username]);
  if (adminClash || vendorClash) {
    return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' });
  }
  const hash = bcrypt.hashSync(password, 10);
  await db.run(
    `INSERT INTO vendors (id, name, phone, category, password_hash, active, is_regular)
     VALUES (?,?,?,'other',?,1,0)`,
    [username, name, phone, hash]
  );

  const token = jwt.sign({ kind: 'vendor', id: username, name, phone }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: { kind: 'vendor', id: username, name, phone } });
}));

// Login: checks admin accounts first, then vendor accounts.
router.post('/login', wrap(async (req, res) => {
  const { username: rawUsername, password } = req.body || {};
  const username = sanitizeUsername(rawUsername);
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  const admin = await db.get('SELECT * FROM admins WHERE username = ?', [username]);
  if (admin) {
    if (!admin.active) return res.status(403).json({ error: 'บัญชีนี้ถูกปิดใช้งานแล้ว' });
    if (!bcrypt.compareSync(password, admin.password_hash)) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    const token = jwt.sign(
      { kind: 'admin', id: admin.username, name: admin.name, role: admin.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    return res.json({ token, user: { kind: 'admin', id: admin.username, name: admin.name, role: admin.role } });
  }

  const vendor = await db.get('SELECT * FROM vendors WHERE id = ?', [username]);
  if (vendor && vendor.password_hash) {
    if (!vendor.active) return res.status(403).json({ error: 'บัญชีนี้ถูกปิดใช้งานแล้ว' });
    if (!bcrypt.compareSync(password, vendor.password_hash)) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    const token = jwt.sign(
      { kind: 'vendor', id: vendor.id, name: vendor.name, phone: vendor.phone },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    return res.json({ token, user: { kind: 'vendor', id: vendor.id, name: vendor.name, phone: vendor.phone } });
  }

  res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
}));

module.exports = router;
