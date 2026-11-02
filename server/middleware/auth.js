const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function signUser(user) {
  const staff = user.role_id !== db.ROLE.VENDOR;
  return jwt.sign({ uid: user.user_id, role: user.role_id }, JWT_SECRET, { expiresIn: staff ? '12h' : '30d' });
}

// Attaches req.user ({ uid, role }) if a valid token is present; never rejects (guests allowed).
function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (token) {
    try {
      const p = jwt.verify(token, JWT_SECRET);
      if (p.uid) req.user = p;
    } catch (e) { /* ignore bad token */ }
  }
  next();
}

function isStaffToken(req) {
  return !!(req.user && req.user.role !== db.ROLE.VENDOR);
}

// Staff side (ผู้ดูแลระบบ, เจ้าหน้าที่ตลาด). The account and its role are re-read on every request, so a
// suspended account or a menu taken away by the admin stops working at once, not when the token expires.
function requireStaff(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  let p;
  try { p = jwt.verify(token, JWT_SECRET); } catch (e) { return res.status(401).json({ error: 'เซสชันไม่ถูกต้องหรือหมดอายุ' }); }
  if (!p.uid) return res.status(401).json({ error: 'เซสชันไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  db.get(
    `SELECT u.user_id, u.role_id, u.active, u.first_name, u.last_name, r.menu_access
     FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?`, [p.uid])
    .then((u) => {
      if (!u || !u.active) return res.status(401).json({ error: 'บัญชีนี้ถูกปิดใช้งานแล้ว' });
      if (u.role_id === db.ROLE.VENDOR) return res.status(403).json({ error: 'สำหรับเจ้าหน้าที่ตลาดเท่านั้น' });
      req.user = { uid: u.user_id, role: u.role_id };
      req.staff = {
        uid: u.user_id,
        role: u.role_id,
        name: `${u.first_name} ${u.last_name}`.trim(),
        menus: u.role_id === db.ROLE.ADMIN ? db.MENUS.slice() : String(u.menu_access || '').split(',').filter(Boolean)
      };
      next();
    })
    .catch(next);
}

// A staff menu ("จัดการการจอง" = 'bookings' …) that the user's role must include.
function requireMenu(key) {
  return (req, res, next) => requireStaff(req, res, () => {
    if (!req.staff.menus.includes(key)) return res.status(403).json({ error: 'สิทธิ์ของคุณไม่สามารถใช้งานเมนูนี้ได้' });
    next();
  });
}

function requireHead(req, res, next) {
  requireStaff(req, res, () => {
    if (req.staff.role !== db.ROLE.ADMIN) return res.status(403).json({ error: 'สำหรับผู้ดูแลระบบเท่านั้น' });
    next();
  });
}

// For routes open to both vendors and staff: req.staff is set only for an active staff account with that menu.
function optionalStaff(menuKey) {
  return (req, res, next) => {
    optionalAuth(req, res, () => {
      if (!isStaffToken(req)) return next();
      requireMenu(menuKey)(req, res, next);
    });
  };
}

module.exports = { JWT_SECRET, signUser, optionalAuth, optionalStaff, isStaffToken, requireStaff, requireMenu, requireHead };
