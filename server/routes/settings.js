const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { requireHeadAdmin } = require('../middleware/auth');

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

router.get('/', (req, res) => {
  const row = db.prepare('SELECT prompt_pay_qr_path FROM settings WHERE id = 1').get();
  res.json({ promptPayQrUrl: row?.prompt_pay_qr_path || null });
});

router.post('/qr', requireHeadAdmin, upload.single('qr'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  const qrPath = `/uploads/settings/${req.file.filename}`;
  db.prepare('UPDATE settings SET prompt_pay_qr_path = ? WHERE id = 1').run(qrPath);
  res.json({ promptPayQrUrl: qrPath });
});

module.exports = router;
