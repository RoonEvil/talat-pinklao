// 1.4 กำหนดสิทธิ์การใช้งาน: which staff menus each role may open (roles.menu_access).
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireHead } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

const toApi = (r) => ({
  id: r.role_id,
  name: r.role_name,
  menus: String(r.menu_access || '').split(',').filter(Boolean),
  description: r.description || ''
});

router.get('/', requireHead, wrap(async (req, res) => {
  res.json((await db.all('SELECT * FROM roles ORDER BY role_id')).map(toApi));
}));

router.put('/:id', requireHead, wrap(async (req, res) => {
  const role = await db.get('SELECT * FROM roles WHERE role_id = ?', [req.params.id]);
  if (!role) return res.status(404).json({ error: 'ไม่พบสิทธิ์นี้' });
  const body = req.body || {};
  let menus = String(role.menu_access || '').split(',').filter(Boolean);
  if (Array.isArray(body.menus)) {
    if (role.role_id === db.ROLE.ADMIN) return res.status(400).json({ error: 'ผู้ดูแลระบบเข้าถึงได้ทุกเมนูเสมอ' });
    if (role.role_id === db.ROLE.VENDOR) return res.status(400).json({ error: 'ผู้ค้าใช้งานหน้าผังตลาดและการจองของฉันเท่านั้น' });
    // Settings (QR, backup, permissions) stay with the admin.
    menus = db.MENUS.filter((m) => m !== 'settings' && body.menus.includes(m));
  }
  const description = body.description !== undefined ? String(body.description).trim().slice(0, 500) : role.description;
  const row = await db.get('UPDATE roles SET menu_access = ?, description = ? WHERE role_id = ? RETURNING *',
    [menus.join(','), description, role.role_id]);
  res.json(toApi(row));
}));

module.exports = router;
