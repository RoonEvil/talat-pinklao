const crypto = require('crypto');
const multer = require('multer');
const db = require('./db');
const { JWT_SECRET } = require('./middleware/auth');

// SVG is excluded: it can carry scripts that would run on our origin.
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Images live in Postgres (D12 pictures) so they survive redeploys.
function imageUpload(field, maxBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (req, file, cb) => cb(null, ALLOWED_TYPES.has(file.mimetype))
  }).single(field);
}

async function savePicture(t, file, type, uploadedBy) {
  const row = await t.get(
    'INSERT INTO pictures (picture_type, mime_type, data, uploaded_by) VALUES (?,?,?,?) RETURNING picture_id',
    [type, file.mimetype, file.buffer, uploadedBy || null]);
  return row.picture_id;
}

// picture_id is a running number, so links carry a signature: a slip can't be opened by guessing ids.
function sign(id) {
  return crypto.createHmac('sha256', JWT_SECRET).update(`picture:${id}`).digest('hex').slice(0, 24);
}
function pictureUrl(id) {
  return id ? `/files/${id}?k=${sign(id)}` : null;
}

async function serveFile(req, res) {
  const id = req.params.id;
  if (!/^\d{1,9}$/.test(id)) return res.status(404).end();
  const k = String(req.query.k || '');
  const expected = sign(id);
  if (k.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(k), Buffer.from(expected))) return res.status(404).end();
  const row = await db.get('SELECT mime_type, data FROM pictures WHERE picture_id = ?', [id]);
  if (!row || !row.data || !row.data.length) return res.status(404).end();
  res.set('Content-Type', row.mime_type);
  res.set('Cache-Control', 'private, max-age=86400');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(row.data));
}

module.exports = { imageUpload, savePicture, pictureUrl, serveFile, ALLOWED_TYPES };
