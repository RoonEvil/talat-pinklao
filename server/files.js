const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');

// SVG is excluded: it can carry scripts that would run on our origin.
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Images live in Postgres so they survive redeploys; ids are random so URLs can't be enumerated.
function imageUpload(field, maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype))
  }).single(field);
}

async function saveImage(file) {
  const id = crypto.randomUUID();
  await db.run('INSERT INTO files (id, mime, data) VALUES (?,?,?)', [id, file.mimetype, file.buffer]);
  return `/files/${id}`;
}

async function serveFile(req, res) {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).end();
  const row = await db.get('SELECT mime, data FROM files WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).end();
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'private, max-age=86400');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(row.data));
}

module.exports = { imageUpload, saveImage, serveFile };
