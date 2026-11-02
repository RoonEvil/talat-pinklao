const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const wrap = require('./wrap');
const { serveFile } = require('./files');

const app = express();
app.use(cors());
const smallJson = express.json({ limit: '200kb' });
// Backup restore parses its own (larger) bodies after authentication.
app.use((req, res, next) => (req.path.startsWith('/api/backup') ? next() : smallJson(req, res, next)));

// One router per part of the system (processes 1.0–9.0 in the design).
app.use('/api/auth', require('./routes/auth'));               // 1.1–1.2 สมัครสมาชิก / เข้าสู่ระบบ
app.use('/api/users', require('./routes/users'));             // 1.3 จัดการข้อมูลผู้ใช้
app.use('/api/roles', require('./routes/roles'));             // 1.4 กำหนดสิทธิ์การใช้งาน
app.use('/api/categories', require('./routes/categories'));   // 2.1 ประเภทสินค้า
app.use('/api/zones', require('./routes/zones'));             // 2.1 โซน
app.use('/api/stalls', require('./routes/stalls'));           // 2.2 ล็อกและราคา
app.use('/api/layout', require('./routes/layout'));           // 2.3 แผนผังตลาด
app.use('/api/bookings', require('./routes/bookings'));       // 3.0–5.0 จอง อนุมัติ ชำระเงิน
app.use('/api/inspections', require('./routes/inspections')); // 6.0 ตรวจสอบตลาด
app.use('/api/announcements', require('./routes/announcements')); // 7.0 ประกาศ
app.use('/api/settings', require('./routes/settings'));       // 9.1 QR PromptPay
app.use('/api/backup', require('./routes/backup'));           // 9.2–9.3 สำรอง / กู้คืนข้อมูล

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/files/:id', wrap(serveFile));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  // A streamed response (backup download) has already sent headers; let Express close the connection.
  if (res.headersSent) return next(err);
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'ไฟล์ใหญ่เกินไป' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'ข้อมูลใหญ่เกินไป' });
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่' });
});

const PORT = process.env.PORT || 4000;
db.init()
  .then(() => {
    // Slips uploaded before the e-Slip check are read once, in the background.
    require('./slip').backfill(db).then((n) => { if (n) console.log(`Checked ${n} earlier slip(s)`); })
      .catch((err) => console.error('Slip backfill failed:', err.message));
    app.listen(PORT, () => {
      console.log(`Talat Pinklao server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
