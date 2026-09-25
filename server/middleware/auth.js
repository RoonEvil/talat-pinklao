const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Attaches req.user if a valid token is present; never rejects (guests allowed).
function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch (e) { /* ignore bad token */ }
  }
  next();
}

function requireAdmin(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    if (req.admin.kind !== 'admin') return res.status(403).json({ error: 'สำหรับเจ้าหน้าที่เท่านั้น' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'เซสชันไม่ถูกต้องหรือหมดอายุ' });
  }
}

function requireHeadAdmin(req, res, next) {
  requireAdmin(req, res, () => {
    if (req.admin.role !== 'head') return res.status(403).json({ error: 'สำหรับแอดมินใหญ่เท่านั้น' });
    next();
  });
}

module.exports = { JWT_SECRET, optionalAuth, requireAdmin, requireHeadAdmin };
