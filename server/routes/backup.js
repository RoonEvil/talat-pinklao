const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const wrap = require('../wrap');
const { ALLOWED_TYPES } = require('../files');
const { JWT_SECRET, requireHeadAdmin } = require('../middleware/auth');

// The restore replaces the admins table, so the person restoring may no longer exist afterwards.
// Step 1 hands back a short-lived token that is only accepted by the image-upload step.
function headAdminOrRestoreToken(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    if (jwt.verify(header.slice(7), JWT_SECRET).kind === 'restore') return next();
  } catch (e) { /* not a restore token; fall through to the normal check */ }
  return requireHeadAdmin(req, res, next);
}

const router = express.Router();
// Large bodies are parsed only after the head-admin check, so anonymous requests can't make the server buffer 25 MB.
const bigJson = express.json({ limit: '25mb' });

const FORMAT = 'talat-pinklao-backup';
const FILE_ID = /^[0-9a-f-]{36}$/;

// Streamed so a database full of images never has to fit in the server's memory at once.
router.get('/', requireHeadAdmin, wrap(async (req, res) => {
  const includeImages = req.query.images !== '0';
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="talat-pinklao-backup-${stamp}${includeImages ? '' : '-no-images'}.json"`,
    'Cache-Control': 'no-store'
  });
  res.write(`{"format":"${FORMAT}","version":1,"createdAt":${JSON.stringify(new Date().toISOString())},"includesImages":${includeImages},"tables":{`);
  for (let t = 0; t < db.TABLES.length; t++) {
    const table = db.TABLES[t];
    const rows = await db.all(`SELECT ${table.cols.join(', ')} FROM ${table.name} ORDER BY ${table.cols[0]}`);
    res.write(`${t ? ',' : ''}${JSON.stringify(table.name)}:${JSON.stringify(rows)}`);
  }
  res.write('},"files":[');
  if (includeImages) {
    const ids = await db.all('SELECT id FROM files ORDER BY created_at, id');
    for (let i = 0; i < ids.length; i++) {
      const f = await db.get('SELECT id, mime, data, created_at FROM files WHERE id = ?', [ids[i].id]);
      if (!f) continue;
      const entry = { id: f.id, mime: f.mime, created_at: f.created_at, data: Buffer.from(f.data).toString('base64') };
      res.write(`${i ? ',' : ''}${JSON.stringify(entry)}`);
    }
  }
  res.end(']}');
}));

function validateBackup(body) {
  if (!body || body.format !== FORMAT || body.version !== 1 || typeof body.tables !== 'object' || !body.tables) {
    return 'ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้';
  }
  for (const table of db.TABLES) {
    if (!Array.isArray(body.tables[table.name])) return `ไฟล์สำรองข้อมูลไม่มีตาราง ${table.name}`;
  }
  const hasHeadAdmin = body.tables.admins.some((a) => a && a.role === 'head' && Number(a.active) === 1);
  if (!hasHeadAdmin) return 'ไฟล์สำรองข้อมูลไม่มีบัญชีแอดมินใหญ่ที่ใช้งานอยู่ — กู้คืนแล้วจะเข้าระบบไม่ได้';
  return null;
}

// Step 1 of a restore: replace every table in one transaction (all or nothing). Images follow in step 2.
router.post('/restore', requireHeadAdmin, bigJson, wrap(async (req, res) => {
  const problem = validateBackup(req.body);
  if (problem) return res.status(400).json({ error: problem });

  const counts = {};
  try {
    await db.tx(async (t) => {
      await t.run(`TRUNCATE ${db.TABLES.map((x) => x.name).join(', ')}, files RESTART IDENTITY CASCADE`);
      for (const table of db.TABLES) {
        const rows = req.body.tables[table.name];
        counts[table.name] = rows.length;
        const chunk = Math.max(1, Math.floor(2000 / table.cols.length));
        for (let i = 0; i < rows.length; i += chunk) {
          const part = rows.slice(i, i + chunk);
          const params = [];
          const tuples = part.map((row) => {
            table.cols.forEach((c) => params.push(row && row[c] !== undefined ? row[c] : null));
            return `(${table.cols.map(() => '?').join(',')})`;
          });
          await t.run(`INSERT INTO ${table.name} (${table.cols.join(', ')}) VALUES ${tuples.join(',')}`, params);
        }
        if (table.serial) {
          await t.run(`SELECT setval(pg_get_serial_sequence('${table.name}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM ${table.name}`);
        }
      }
      await t.run('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
    });
  } catch (err) {
    return res.status(400).json({ error: 'กู้คืนไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ: ' + err.message });
  }
  const restoreToken = jwt.sign({ kind: 'restore' }, JWT_SECRET, { expiresIn: '30m' });
  res.json({ ok: true, counts, restoreToken });
}));

// Step 2 of a restore: images in small batches, safe to retry.
router.post('/restore-files', headAdminOrRestoreToken, bigJson, wrap(async (req, res) => {
  const files = req.body && req.body.files;
  if (!Array.isArray(files)) return res.status(400).json({ error: 'ข้อมูลรูปภาพไม่ถูกต้อง' });
  let saved = 0;
  for (const f of files) {
    if (!f || !FILE_ID.test(f.id) || !ALLOWED_TYPES.has(f.mime) || typeof f.data !== 'string') continue;
    const buf = Buffer.from(f.data, 'base64');
    if (!buf.length) continue;
    await db.run(
      'INSERT INTO files (id, mime, data, created_at) VALUES (?,?,?,COALESCE(?::timestamptz, NOW())) ON CONFLICT (id) DO NOTHING',
      [f.id, f.mime, buf, f.created_at || null]
    );
    saved++;
  }
  res.json({ ok: true, saved });
}));

module.exports = router;
