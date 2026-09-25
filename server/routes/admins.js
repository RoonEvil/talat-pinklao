const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireHeadAdmin } = require('../middleware/auth');

const router = express.Router();

function sanitizeUsername(u) {
  return String(u || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

router.get('/', requireHeadAdmin, (req, res) => {
  res.json(db.prepare('SELECT username, name, role, active, created_at FROM admins ORDER BY name').all());
});

router.post('/', requireHeadAdmin, (req, res) => {
  const { name, username: rawUsername, password, role } = req.body || {};
  const username = sanitizeUsername(rawUsername);
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อ ชื่อผู้ใช้ และรหัสผ่านให้ครบ' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'รหัสผ่านต้องมีความยาวอย่างน้อย 4 ตัวอักษร' });
  const existing = db.prepare('SELECT username FROM admins WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' });
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO admins (username, name, password_hash, role, active) VALUES (?,?,?,?,1)').run(
    username, name, hash, role === 'head' ? 'head' : 'staff'
  );
  res.status(201).json({ username, name, role: role === 'head' ? 'head' : 'staff', active: 1 });
});

router.put('/:username', requireHeadAdmin, (req, res) => {
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(req.params.username);
  if (!admin) return res.status(404).json({ error: 'ไม่พบบัญชีแอดมินนี้' });
  const { active } = req.body || {};
  db.prepare('UPDATE admins SET active=? WHERE username=?').run(active ? 1 : 0, req.params.username);
  res.json(db.prepare('SELECT username, name, role, active, created_at FROM admins WHERE username = ?').get(req.params.username));
});

module.exports = router;
