const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db');
const wrap = require('./wrap');
const { serveFile } = require('./files');

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/zones', require('./routes/zones'));
app.use('/api/stalls', require('./routes/stalls'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/admins', require('./routes/admins'));
app.use('/api/settings', require('./routes/settings'));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/files/:id', wrap(serveFile));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'ไฟล์ใหญ่เกินไป' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'ข้อมูลใหญ่เกินไป' });
  }
  console.error(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ กรุณาลองใหม่' });
});

const PORT = process.env.PORT || 4000;
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Talat Pinklao server listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to start:', err.message);
    process.exit(1);
  });
