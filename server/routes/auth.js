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

// What a vendor may register as selling. Keep in sync with CATEGORIES / FOOD_TYPES in public/app.js.
const CATEGORY_IDS = ['food', 'clothing', 'general', 'service', 'other'];
const FOOD_TYPE_IDS = ['ready_meal', 'made_to_order', 'grill_fried', 'dessert', 'bakery', 'drink', 'fruit', 'fresh'];

// Known ids only, without duplicates, in a fixed order.
function pickKnown(value, allowed) {
  const list = Array.isArray(value) ? value : [];
  return allowed.filter((id) => list.includes(id));
}

function splitList(s) {
  return s ? String(s).split(',').filter(Boolean) : [];
}

function vendorUser(v) {
  return { kind: 'vendor', id: v.id, name: v.name, phone: v.phone, categories: splitList(v.categories), foodTypes: splitList(v.food_types) };
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
  const categories = pickKnown(req.body.categories, CATEGORY_IDS);
  if (!categories.length) {
    return res.status(400).json({ error: 'กรุณาเลือกประเภทสินค้าที่จะขายอย่างน้อย 1 อย่าง' });
  }
  const foodTypes = categories.includes('food') ? pickKnown(req.body.foodTypes, FOOD_TYPE_IDS) : [];
  if (categories.includes('food') && !foodTypes.length) {
    return res.status(400).json({ error: 'เลือกขายอาหารแล้ว กรุณาเลือกประเภทอาหารอย่างน้อย 1 อย่าง' });
  }
  const adminClash = await db.get('SELECT username FROM admins WHERE username = ?', [username]);
  const vendorClash = await db.get('SELECT id FROM vendors WHERE id = ?', [username]);
  if (adminClash || vendorClash) {
    return res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const vendor = await db.get(
    `INSERT INTO vendors (id, name, phone, category, password_hash, active, is_regular, categories, food_types)
     VALUES (?,?,?,?,?,1,0,?,?) RETURNING id, name, phone, categories, food_types`,
    [username, name, phone, categories[0], hash, categories.join(','), foodTypes.length ? foodTypes.join(',') : null]
  );

  const token = jwt.sign({ kind: 'vendor', id: username, name, phone }, JWT_SECRET, { expiresIn: '30d' });
  res.status(201).json({ token, user: vendorUser(vendor) });
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
    return res.json({ token, user: vendorUser(vendor) });
  }

  res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
}));

module.exports = router;
