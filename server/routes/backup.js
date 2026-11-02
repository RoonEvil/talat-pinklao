// 9.2 สำรองข้อมูล / 9.3 กู้คืนข้อมูล: every table (D1–D12) in one JSON file.
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const wrap = require('../wrap');
const { ALLOWED_TYPES } = require('../files');
const { JWT_SECRET, requireMenu } = require('../middleware/auth');

const requireSettings = requireMenu('settings');

// The restore replaces the users table, so the person restoring may no longer exist afterwards.
// Step 1 hands back a short-lived token that is only accepted by the image step.
function settingsOrRestoreToken(req, res, next) {
  const header = req.headers.authorization || '';
  try {
    if (jwt.verify(header.slice(7), JWT_SECRET).kind === 'restore') return next();
  } catch (e) { /* not a restore token; fall through to the normal check */ }
  return requireSettings(req, res, next);
}

const router = express.Router();
// Large bodies are parsed only after the permission check, so anonymous requests can't make the server buffer 25 MB.
const bigJson = express.json({ limit: '25mb' });

const FORMAT = 'talat-pinklao-backup';
const VERSION = 2;

// Streamed so a database full of images never has to fit in the server's memory at once.
router.get('/', requireSettings, wrap(async (req, res) => {
  const includeImages = req.query.images !== '0';
  const stamp = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="talat-pinklao-backup-${stamp}${includeImages ? '' : '-no-images'}.json"`,
    'Cache-Control': 'no-store'
  });
  res.write(`{"format":"${FORMAT}","version":${VERSION},"createdAt":${JSON.stringify(new Date().toISOString())},"includesImages":${includeImages},"tables":{`);
  for (let t = 0; t < db.TABLES.length; t++) {
    const table = db.TABLES[t];
    const rows = await db.all(`SELECT ${table.cols.join(', ')} FROM ${table.name} ORDER BY ${table.cols[0]}`);
    res.write(`${t ? ',' : ''}${JSON.stringify(table.name)}:${JSON.stringify(rows)}`);
  }
  res.write('},"images":[');
  if (includeImages) {
    const ids = await db.all('SELECT picture_id FROM pictures ORDER BY picture_id');
    for (let i = 0; i < ids.length; i++) {
      const f = await db.get('SELECT picture_id, data FROM pictures WHERE picture_id = ?', [ids[i].picture_id]);
      if (!f) continue;
      res.write(`${i ? ',' : ''}${JSON.stringify({ id: f.picture_id, data: Buffer.from(f.data).toString('base64') })}`);
    }
  }
  res.end(']}');
}));

function validateBackup(body) {
  if (!body || body.format !== FORMAT || typeof body.tables !== 'object' || !body.tables) return 'ไม่ใช่ไฟล์สำรองข้อมูลของระบบนี้';
  if (body.version !== VERSION) return 'ไฟล์สำรองข้อมูลนี้มาจากระบบรุ่นเก่า (ก่อนปรับฐานข้อมูลเป็นตาราง users และ roles) จึงกู้คืนในรุ่นนี้ไม่ได้';
  for (const table of db.TABLES) {
    if (!Array.isArray(body.tables[table.name])) return `ไฟล์สำรองข้อมูลไม่มีตาราง ${table.name}`;
  }
  const hasAdmin = body.tables.users.some((u) => u && Number(u.role_id) === 1 && u.active && u.username && u.password_hash);
  if (!hasAdmin) return 'ไฟล์สำรองข้อมูลไม่มีบัญชีผู้ดูแลระบบที่ใช้งานอยู่ — กู้คืนแล้วจะเข้าระบบไม่ได้';
  return null;
}

// Step 1: replace every table in one transaction (all or nothing). Image bytes follow in step 2.
router.post('/restore', requireSettings, bigJson, wrap(async (req, res) => {
  const problem = validateBackup(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const counts = {};
  try {
    await db.tx(async (t) => {
      await t.run(`TRUNCATE ${db.TABLES.map((x) => x.name).join(', ')} RESTART IDENTITY CASCADE`);
      for (const table of db.TABLES) {
        const rows = req.body.tables[table.name];
        counts[table.name] = rows.length;
        const cols = table.binary ? [...table.cols, 'data'] : table.cols;
        const chunk = Math.max(1, Math.floor(2000 / cols.length));
        for (let i = 0; i < rows.length; i += chunk) {
          const params = [];
          const tuples = rows.slice(i, i + chunk).map((row) => {
            const marks = cols.map((c) => {
              if (c === 'data') { params.push(Buffer.alloc(0)); return '?'; }
              let v = row && row[c] !== undefined ? row[c] : null;
              if (c === 'layout_data') { params.push(v == null ? null : JSON.stringify(v)); return '?::jsonb'; }
              params.push(v);
              return '?';
            });
            return `(${marks.join(',')})`;
          });
          await t.run(`INSERT INTO ${table.name} (${cols.join(', ')}) VALUES ${tuples.join(',')}`, params);
        }
      }
      await db.resetSequences(t);
    });
  } catch (err) {
    return res.status(400).json({ error: 'กู้คืนไม่สำเร็จ ข้อมูลเดิมยังอยู่ครบ: ' + err.message });
  }
  const restoreToken = jwt.sign({ kind: 'restore' }, JWT_SECRET, { expiresIn: '30m' });
  res.json({ ok: true, counts, restoreToken });
}));

// Step 2: image bytes in small batches, safe to retry. Only pictures created in step 1 are filled.
router.post('/restore-files', settingsOrRestoreToken, bigJson, wrap(async (req, res) => {
  const images = req.body && req.body.images;
  if (!Array.isArray(images)) return res.status(400).json({ error: 'ข้อมูลรูปภาพไม่ถูกต้อง' });
  let saved = 0;
  for (const f of images) {
    if (!f || !wrap.isId(f.id) || typeof f.data !== 'string') continue;
    const buf = Buffer.from(f.data, 'base64');
    if (!buf.length) continue;
    const pic = await db.get('SELECT mime_type FROM pictures WHERE picture_id = ?', [f.id]);
    if (!pic || !ALLOWED_TYPES.has(pic.mime_type)) continue;
    await db.run('UPDATE pictures SET data = ? WHERE picture_id = ?', [buf, f.id]);
    saved++;
  }
  res.json({ ok: true, saved });
}));

module.exports = router;
