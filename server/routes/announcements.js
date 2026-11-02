// 7.0 จัดการประกาศ (D11 announcements): add, edit, search, delete; everyone can read them.
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

const TYPES = ['news', 'rule', 'holiday', 'event'];
const SELECT = `SELECT a.announcement_id AS id, a.title, a.type, a.body, a.pinned, a.created_at, a.created_by,
  TRIM(u.first_name || ' ' || u.last_name) AS created_by_name
  FROM announcements a LEFT JOIN users u ON u.user_id = a.created_by`;

router.get('/', wrap(async (req, res) => {
  res.json(await db.all(`${SELECT} ORDER BY a.pinned DESC, a.created_at DESC`));
}));

function readForm(body, existing) {
  const title = body.title !== undefined ? String(body.title).trim().slice(0, 200) : existing && existing.title;
  const text = body.body !== undefined ? String(body.body).trim().slice(0, 5000) : existing && existing.body;
  if (!title || !text) return { error: 'กรุณากรอกหัวข้อและข้อความ' };
  const type = TYPES.includes(body.type) ? body.type : (existing ? existing.type : 'news');
  const pinned = body.pinned !== undefined ? !!body.pinned : !!(existing && existing.pinned);
  return { title, text, type, pinned };
}

router.post('/', requireMenu('announcements'), wrap(async (req, res) => {
  const f = readForm(req.body || {}, null);
  if (f.error) return res.status(400).json({ error: f.error });
  const row = await db.get('INSERT INTO announcements (title, type, body, pinned, created_by) VALUES (?,?,?,?,?) RETURNING announcement_id',
    [f.title, f.type, f.text, f.pinned, req.staff.uid]);
  res.status(201).json(await db.get(`${SELECT} WHERE a.announcement_id = ?`, [row.announcement_id]));
}));

router.put('/:id', requireMenu('announcements'), wrap(async (req, res) => {
  const existing = await db.get('SELECT * FROM announcements WHERE announcement_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'ไม่พบประกาศนี้' });
  const f = readForm(req.body || {}, existing);
  if (f.error) return res.status(400).json({ error: f.error });
  await db.run('UPDATE announcements SET title=?, type=?, body=?, pinned=? WHERE announcement_id=?',
    [f.title, f.type, f.text, f.pinned, existing.announcement_id]);
  res.json(await db.get(`${SELECT} WHERE a.announcement_id = ?`, [existing.announcement_id]));
}));

router.delete('/:id', requireMenu('announcements'), wrap(async (req, res) => {
  await db.run('DELETE FROM announcements WHERE announcement_id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
