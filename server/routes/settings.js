// 9.1 จัดการ QR PromptPay (D12 pictures, picture_type 'promptpay_qr'), plus the public settings the map page needs.
const express = require('express');
const db = require('../db');
const wrap = require('../wrap');
const { imageUpload, savePicture, pictureUrl } = require('../files');
const { requireMenu } = require('../middleware/auth');
const { currentLayout } = require('./layout');

const router = express.Router();

async function currentQr() {
  const row = await db.get("SELECT picture_id FROM pictures WHERE picture_type = 'promptpay_qr' ORDER BY picture_id DESC LIMIT 1");
  return row ? pictureUrl(row.picture_id) : null;
}

router.get('/', wrap(async (req, res) => {
  res.json({ promptPayQrUrl: await currentQr(), mapLayout: await currentLayout() });
}));

router.post('/qr', requireMenu('settings'), imageUpload('qr', 5 * 1024 * 1024), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'กรุณาเลือกไฟล์รูป JPG, PNG, WEBP หรือ GIF' });
  await db.tx(async (t) => {
    const id = await savePicture(t, req.file, 'promptpay_qr', req.staff.uid);
    await t.run("DELETE FROM pictures WHERE picture_type = 'promptpay_qr' AND picture_id <> ?", [id]);
  });
  res.json({ promptPayQrUrl: await currentQr() });
}));

module.exports = router;
