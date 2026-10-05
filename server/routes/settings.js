const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { imageUpload, saveImage } = require('../files');
const { requireAdmin, requireHeadAdmin } = require('../middleware/auth');

const router = express.Router();

const MAP_KINDS = new Set(['stall', 'entrance', 'toilet', 'tree', 'stage', 'parking', 'text', 'object']);

function parseLayout(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function sanitizeLayout(body) {
  if (!body || typeof body !== 'object') return null;
  const cols = Math.round(Number(body.cols));
  const rows = Math.round(Number(body.rows));
  if (!(cols >= 4 && cols <= 60 && rows >= 4 && rows <= 60)) return null;
  if (!Array.isArray(body.items) || body.items.length > 600) return null;
  const items = [];
  for (const raw of body.items) {
    if (!raw || !MAP_KINDS.has(raw.kind)) return null;
    const [x, y, w, h] = [raw.x, raw.y, raw.w, raw.h].map((v) => Math.round(Number(v)));
    if (![x, y, w, h].every(Number.isFinite)) return null;
    if (w < 1 || h < 1 || w > 4 || h > 4 || x < 0 || y < 0 || x + w > cols || y + h > rows) return null;
    const item = { kind: raw.kind, x, y, w, h };
    if (raw.kind === 'stall') {
      const stallId = Math.round(Number(raw.stallId));
      if (!(stallId > 0)) return null;
      item.stallId = stallId;
    }
    if (raw.label != null && raw.label !== '') item.label = String(raw.label).slice(0, 40);
    items.push(item);
  }
  return { cols, rows, items };
}

router.get('/', wrap(async (req, res) => {
  const row = await db.get('SELECT prompt_pay_qr_path, map_layout FROM settings WHERE id = 1');
  res.json({
    promptPayQrUrl: row?.prompt_pay_qr_path || null,
    mapLayout: parseLayout(row?.map_layout)
  });
}));

router.post('/qr', requireHeadAdmin, imageUpload('qr', 5 * 1024 * 1024), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกไฟล์รูป JPG, PNG, WEBP หรือ GIF' });
  const qrPath = await saveImage(req.file);
  const old = await db.get('SELECT prompt_pay_qr_path FROM settings WHERE id = 1');
  await db.run('UPDATE settings SET prompt_pay_qr_path = ? WHERE id = 1', [qrPath]);
  if (old && old.prompt_pay_qr_path) {
    await db.run('DELETE FROM files WHERE id = ?', [old.prompt_pay_qr_path.replace('/files/', '')]);
  }
  res.json({ promptPayQrUrl: qrPath });
}));

router.put('/map', requireAdmin, wrap(async (req, res) => {
  const layout = sanitizeLayout(req.body);
  if (!layout) return res.status(400).json({ error: 'ข้อมูลแผนผังไม่ถูกต้อง' });
  await db.run('UPDATE settings SET map_layout = ? WHERE id = 1', [JSON.stringify(layout)]);
  res.json({ mapLayout: layout });
}));

module.exports = router;
