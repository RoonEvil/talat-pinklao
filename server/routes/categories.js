// 2.1 จัดการข้อมูลประเภทสินค้า (D3): top-level categories and the kinds under them (parent_id).
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

const toApi = (c) => ({ id: c.category_id, parentId: c.parent_id, name: c.category_name, sortOrder: c.sort_order });

router.get('/', wrap(async (req, res) => {
  res.json((await db.all('SELECT * FROM categories ORDER BY sort_order, category_id')).map(toApi));
}));

async function readForm(body, existing) {
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 100) : (existing ? existing.category_name : '');
  if (!name) return { error: 'กรุณากรอกชื่อประเภทสินค้า' };
  let parentId = existing ? existing.parent_id : null;
  if (body.parentId !== undefined) {
    parentId = body.parentId == null || body.parentId === '' ? null : Number(body.parentId);
    if (parentId != null) {
      const parent = await db.get('SELECT category_id, parent_id FROM categories WHERE category_id = ?', [parentId]);
      if (!parent) return { error: 'ไม่พบประเภทหลักนี้' };
      if (parent.parent_id) return { error: 'ประเภทย่อยซ้อนได้ชั้นเดียว กรุณาเลือกประเภทหลัก' };
      if (existing && parentId === existing.category_id) return { error: 'ประเภทหลักต้องไม่ใช่ตัวเอง' };
      if (existing && (await db.get('SELECT 1 FROM categories WHERE parent_id = ?', [existing.category_id]))) {
        return { error: 'ประเภทนี้มีประเภทย่อยอยู่ จึงย้ายไปเป็นประเภทย่อยไม่ได้' };
      }
    }
  }
  const twin = await db.get(
    'SELECT 1 FROM categories WHERE lower(category_name) = lower(?) AND parent_id IS NOT DISTINCT FROM ?::int AND category_id <> ?',
    [name, parentId, existing ? existing.category_id : -1]);
  if (twin) return { error: 'มีประเภทสินค้าชื่อนี้อยู่แล้ว' };
  return { name, parentId };
}

router.post('/', requireMenu('market'), wrap(async (req, res) => {
  const f = await readForm(req.body || {}, null);
  if (f.error) return res.status(400).json({ error: f.error });
  const order = (await db.get('SELECT COALESCE(MAX(sort_order),0)::int AS m FROM categories WHERE parent_id IS NOT DISTINCT FROM ?::int', [f.parentId])).m + 1;
  const row = await db.get('INSERT INTO categories (parent_id, category_name, sort_order) VALUES (?,?,?) RETURNING *', [f.parentId, f.name, order]);
  res.status(201).json(toApi(row));
}));

router.put('/:id', requireMenu('market'), wrap(async (req, res) => {
  const existing = await db.get('SELECT * FROM categories WHERE category_id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'ไม่พบประเภทสินค้านี้' });
  const f = await readForm(req.body || {}, existing);
  if (f.error) return res.status(400).json({ error: f.error });
  const row = await db.get('UPDATE categories SET category_name = ?, parent_id = ? WHERE category_id = ? RETURNING *', [f.name, f.parentId, existing.category_id]);
  res.json(toApi(row));
}));

router.delete('/:id', requireMenu('market'), wrap(async (req, res) => {
  const id = Number(req.params.id);
  const ids = [id, ...(await db.all('SELECT category_id FROM categories WHERE parent_id = ?', [id])).map((r) => r.category_id)];
  const marks = ids.map(() => '?').join(',');
  const used = await db.get(
    `SELECT (SELECT COUNT(*)::int FROM bookings WHERE category_id IN (${marks})) AS b,
            (SELECT COUNT(*)::int FROM users WHERE category_id IN (${marks})) AS u`, [...ids, ...ids]);
  if (used.b || used.u) {
    return res.status(409).json({ error: `ประเภทสินค้านี้ถูกใช้ในการจอง ${used.b} รายการ และผู้ค้า ${used.u} ราย จึงลบไม่ได้` });
  }
  await db.run('DELETE FROM categories WHERE category_id = ?', [id]);
  res.status(204).end();
}));

module.exports = router;
