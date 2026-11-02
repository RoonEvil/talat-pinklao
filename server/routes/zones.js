// 2.1 จัดการข้อมูลโซนและประเภทสินค้าที่โซนอนุญาต (D4 zones, D5 zone_categories).
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { requireMenu } = require('../middleware/auth');

const router = express.Router();
router.param('id', wrap.numericIdParam);

const COLORS = ['zone-1', 'zone-2', 'zone-3', 'zone-4'];

async function listZones(where = '', params = []) {
  const zones = await db.all(
    `SELECT zone_id AS id, zone_name AS name, description, color, sort_order FROM zones ${where} ORDER BY sort_order, zone_id`, params);
  const links = await db.all('SELECT zone_id, category_id FROM zone_categories ORDER BY category_id');
  return zones.map((z) => ({ ...z, allowed: links.filter((l) => l.zone_id === z.id).map((l) => l.category_id) }));
}

async function saveAllowed(t, zoneId, list) {
  const known = new Set((await t.all('SELECT category_id FROM categories')).map((r) => r.category_id));
  const ids = [...new Set((Array.isArray(list) ? list : []).map(Number))].filter((id) => known.has(id));
  await t.run('DELETE FROM zone_categories WHERE zone_id = ?', [zoneId]);
  for (const id of ids) await t.run('INSERT INTO zone_categories (zone_id, category_id) VALUES (?,?)', [zoneId, id]);
}

router.get('/', wrap(async (req, res) => {
  res.json(await listZones());
}));

router.post('/', requireMenu('market'), wrap(async (req, res) => {
  const { name, description, color, allowed } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโซน' });
  const id = await db.tx(async (t) => {
    const order = (await t.get('SELECT COALESCE(MAX(sort_order),0)::int AS m FROM zones')).m + 1;
    const zone = await t.get('INSERT INTO zones (zone_name, description, color, sort_order) VALUES (?,?,?,?) RETURNING zone_id',
      [String(name).trim().slice(0, 100), description || null, COLORS.includes(color) ? color : COLORS[(order - 1) % 4], order]);
    await saveAllowed(t, zone.zone_id, allowed);
    return zone.zone_id;
  });
  res.status(201).json((await listZones('WHERE zone_id = ?', [id]))[0]);
}));

router.put('/:id', requireMenu('market'), wrap(async (req, res) => {
  const zone = await db.get('SELECT * FROM zones WHERE zone_id = ?', [req.params.id]);
  if (!zone) return res.status(404).json({ error: 'ไม่พบโซนนี้' });
  const { name, description, color, allowed } = req.body || {};
  if (name != null && !String(name).trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อโซน' });
  await db.tx(async (t) => {
    await t.run('UPDATE zones SET zone_name=?, description=?, color=? WHERE zone_id=?', [
      name != null ? String(name).trim().slice(0, 100) : zone.zone_name,
      description !== undefined ? (description || null) : zone.description,
      COLORS.includes(color) ? color : zone.color,
      zone.zone_id
    ]);
    if (allowed !== undefined) await saveAllowed(t, zone.zone_id, allowed);
  });
  res.json((await listZones('WHERE zone_id = ?', [zone.zone_id]))[0]);
}));

router.delete('/:id', requireMenu('market'), wrap(async (req, res) => {
  const count = (await db.get('SELECT COUNT(*)::int AS c FROM stalls WHERE zone_id = ?', [req.params.id])).c;
  if (count > 0) return res.status(409).json({ error: 'กรุณาลบหรือย้ายล็อกในโซนนี้ออกก่อน' });
  await db.run('DELETE FROM zones WHERE zone_id = ?', [req.params.id]);
  res.status(204).end();
}));

module.exports = router;
