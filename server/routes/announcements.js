const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

router.get('/', wrap(async (req, res) => {
  res.json(await db.all('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC'));
}));

router.post('/', requireAdmin, wrap(async (req, res) => {
  const { title, type, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'กรุณากรอกหัวข้อและข้อความ' });
  const row = await db.get(
    'INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,0) RETURNING *',
    [title, type || 'news', body]
  );
  res.status(201).json(row);
}));

router.put('/:id', requireAdmin, wrap(async (req, res) => {
  const { pinned } = req.body || {};
  const row = await db.get('UPDATE announcements SET pinned=? WHERE id=? RETURNING *', [pinned ? 1 : 0, req.params.id]);
  if (!row) return res.status(404).json({ error: 'ไม่พบประกาศนี้' });
  res.json(row);
}));

router.delete('/:id', requireAdmin, wrap(async (req, res) => {
  await db.run('DELETE FROM announcements WHERE id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
