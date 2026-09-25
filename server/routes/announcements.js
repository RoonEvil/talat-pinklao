const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, created_at DESC').all());
});

router.post('/', requireAdmin, (req, res) => {
  const { title, type, body } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'กรุณากรอกหัวข้อและข้อความ' });
  const info = db
    .prepare("INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,0)")
    .run(title, type || 'news', body);
  res.status(201).json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', requireAdmin, (req, res) => {
  const a = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'ไม่พบประกาศนี้' });
  const { pinned } = req.body || {};
  db.prepare('UPDATE announcements SET pinned=? WHERE id=?').run(pinned ? 1 : 0, req.params.id);
  res.json(db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
