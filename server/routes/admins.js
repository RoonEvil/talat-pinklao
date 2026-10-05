const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const wrap = require('../wrap');
const { requireHeadAdmin } = require('../middleware/auth');

const router = express.Router();

function sanitizeUsername(u) {
  return String(u || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

router.get('/', requireHeadAdmin, wrap(async (req, res) => {
  res.json(await db.all('SELECT username, name, role, active, created_at FROM admins ORDER BY name'));
}));

router.post('/', requireHeadAdmin, wrap(async (req, res) => {
  const { name, username: rawUsername, password, role } = req.body || {};
  const username = sanitizeUsername(rawUsername);
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ ชื่อผู้ใช้ และรหัสผ่านให้ครบ' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
  const existing = await db.get('SELECT username FROM admins WHERE username = ?', [username]);
  const vendorClash = await db.get('SELECT id FROM vendors WHERE id = ?', [username]);
  if (existing || vendorClash) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' });
  const finalRole = role === 'head' ? 'head' : 'staff';
  await db.run('INSERT INTO admins (username, name, password_hash, role, active) VALUES (?,?,?,?,1)', [
    username, name, bcrypt.hashSync(password, 10), finalRole
  ]);
  res.status(201).json({ username, name, role: finalRole, active: 1 });
}));

router.put('/:username', requireHeadAdmin, wrap(async (req, res) => {
  const { active } = req.body || {};
  const row = await db.get(
    'UPDATE admins SET active=? WHERE username=? RETURNING username, name, role, active, created_at',
    [active ? 1 : 0, req.params.username]
  );
  if (!row) return res.status(404).json({ error: 'ไม่พบบัญชีแอดมินนี้' });
  res.json(row);
}));

module.exports = router;
