const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db'); // ensures schema + seed run on boot

const app = express();
app.use(cors());
app.use(express.json());

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

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Talat Pinklao server listening on http://localhost:${PORT}`);
});
