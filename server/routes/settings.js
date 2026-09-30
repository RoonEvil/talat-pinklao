const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireAdmin, requireHeadAdmin } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads', 'settings');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `promptpay-qr-${Date.now()}${path.extname(file.originalname || '')}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

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

router.get('/', (req, res) => {
  const row = db.prepare('SELECT prompt_pay_qr_path, map_layout FROM settings WHERE id = 1').get();
  res.json({
    promptPayQrUrl: row?.prompt_pay_qr_path || null,
    mapLayout: parseLayout(row?.map_layout)
  });
});

router.post('/qr', requireHeadAdmin, upload.single('qr'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่มีรูปภาพที่อัปโหลด' });
  const qrPath = `/uploads/settings/${req.file.filename}`;
  db.prepare('UPDATE settings SET prompt_pay_qr_path = ? WHERE id = 1').run(qrPath);
  res.json({ promptPayQrUrl: qrPath });
});

router.put('/map', requireAdmin, (req, res) => {
  const layout = sanitizeLayout(req.body);
  if (!layout) return res.status(400).json({ error: 'ข้อมูลแผนผังไม่ถูกต้อง' });
  db.prepare('UPDATE settings SET map_layout = ? WHERE id = 1').run(JSON.stringify(layout));
  res.json({ mapLayout: layout });
});

module.exports = router;
