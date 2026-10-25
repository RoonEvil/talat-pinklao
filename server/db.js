const bcrypt = require('bcryptjs');

// Routes write SQL with `?` placeholders; Postgres wants $1, $2, ...
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i);
}

function makeApi(runQuery) {
  const api = {
    all: (sql, params = []) => runQuery(toPg(sql), params),
    get: async (sql, params = []) => (await runQuery(toPg(sql), params))[0],
    run: (sql, params = []) => runQuery(toPg(sql), params)
  };
  return api;
}

let backend = null;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    pool.on('error', (err) => console.error('Postgres pool error', err));
    return {
      query: async (sql, params) => (await pool.query(sql, params)).rows,
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(makeApi(async (sql, params) => (await client.query(sql, params)).rows));
          await client.query('COMMIT');
          return result;
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
      }
    };
  }

  if (process.env.RENDER) {
    throw new Error('DATABASE_URL is not set. Add your Neon connection string in Render → Environment.');
  }

  // Local development only: an in-process Postgres (PGlite) stored under server/.pgdata.
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(process.env.PGLITE_DIR || require('path').join(__dirname, '.pgdata'));
  console.warn('DATABASE_URL not set — using local PGlite database (development only).');
  return {
    query: async (sql, params) => (await pg.query(sql, params)).rows,
    tx: (fn) => pg.transaction((t) => fn(makeApi(async (sql, params) => (await t.query(sql, params)).rows)))
  };
}

const db = makeApi((sql, params) => backend.query(sql, params));
db.tx = (fn) => backend.tx(fn);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS admins (
    username TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('staff','head')) DEFAULT 'staff',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'other',
    password_hash TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    is_regular INTEGER NOT NULL DEFAULT 0,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    last_booking_at TIMESTAMPTZ,
    categories TEXT,
    food_types TEXT
  )`,
  // What a registered vendor sells: comma-separated category ids, plus food sub-types when they sell food.
  'ALTER TABLE vendors ADD COLUMN IF NOT EXISTS categories TEXT',
  'ALTER TABLE vendors ADD COLUMN IF NOT EXISTS food_types TEXT',
  `CREATE TABLE IF NOT EXISTS zones (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color_index INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS stalls (
    id SERIAL PRIMARY KEY,
    zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    size_sqm DOUBLE PRECISION DEFAULT 4,
    category TEXT NOT NULL DEFAULT 'other',
    price_per_day DOUBLE PRECISION NOT NULL DEFAULT 650,
    regular_price_per_day DOUBLE PRECISION NOT NULL DEFAULT 450,
    pos_row INTEGER DEFAULT 0,
    pos_col INTEGER DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (zone_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    stall_id INTEGER NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
    zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    vendor_token TEXT NOT NULL,
    vendor_name TEXT NOT NULL,
    vendor_phone TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    note TEXT,
    deposit_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    rate_type TEXT NOT NULL DEFAULT 'guest',
    payment_method TEXT NOT NULL DEFAULT 'cash',
    payment_status TEXT NOT NULL CHECK (payment_status IN ('unpaid','paid','confirmed')) DEFAULT 'unpaid',
    receipt_path TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled')) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    food_type TEXT,
    created_by TEXT
  )`,
  // food_type: what a food booking sells (neighbouring stalls may not sell the same thing).
  // created_by: the staff username when staff booked on a customer's behalf.
  'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS food_type TEXT',
  'ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_by TEXT',
  `CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'news',
    body TEXT NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    stall_id INTEGER,
    stall_code TEXT,
    zone_id INTEGER,
    date TEXT NOT NULL,
    vendor_name TEXT,
    present INTEGER NOT NULL DEFAULT 1,
    category_match INTEGER NOT NULL DEFAULT 1,
    fine_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
    fine_reason TEXT,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    prompt_pay_qr_path TEXT,
    map_layout TEXT,
    seed_version INTEGER DEFAULT 1
  )`,
  'ALTER TABLE settings ADD COLUMN IF NOT EXISTS seed_version INTEGER DEFAULT 1',
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`
];

// Column lists used by backup/restore, in foreign-key-safe insert order. Keep in sync with SCHEMA.
db.TABLES = [
  { name: 'admins', serial: false, cols: ['username', 'name', 'password_hash', 'role', 'active', 'created_at'] },
  { name: 'vendors', serial: false, cols: ['id', 'name', 'phone', 'category', 'password_hash', 'active', 'is_regular', 'joined_at', 'last_booking_at', 'categories', 'food_types'] },
  { name: 'zones', serial: true, cols: ['id', 'name', 'description', 'color_index', 'sort_order'] },
  { name: 'stalls', serial: true, cols: ['id', 'zone_id', 'code', 'size_sqm', 'category', 'price_per_day', 'regular_price_per_day', 'pos_row', 'pos_col', 'active'] },
  { name: 'bookings', serial: true, cols: ['id', 'stall_id', 'zone_id', 'vendor_token', 'vendor_name', 'vendor_phone', 'category', 'start_date', 'end_date', 'note', 'deposit_amount', 'rate_type', 'payment_method', 'payment_status', 'receipt_path', 'status', 'created_at', 'decided_at', 'food_type', 'created_by'] },
  { name: 'announcements', serial: true, cols: ['id', 'title', 'type', 'body', 'pinned', 'created_at'] },
  { name: 'audit_logs', serial: false, cols: ['id', 'booking_id', 'stall_id', 'stall_code', 'zone_id', 'date', 'vendor_name', 'present', 'category_match', 'fine_amount', 'fine_reason', 'recorded_at'] },
  { name: 'settings', serial: false, cols: ['id', 'prompt_pay_qr_path', 'map_layout', 'seed_version'] }
];

// The market starts with 55 stalls: F1–F28 in the food zone and G1–G27 in the general zone.
const DEFAULT_ZONES = [
  { name: 'โซนอาหารสดและสำเร็จรูป', description: 'อาหารปรุงสำเร็จ ของว่าง และเครื่องดื่ม ใต้เต็นท์หลัก', color: 0, order: 1, prefix: 'F', count: 28, category: () => 'food' },
  { name: 'โซนสินค้าทั่วไป', description: 'เสื้อผ้า ของใช้ในบ้าน และสินค้าทั่วไป', color: 1, order: 2, prefix: 'G', count: 27, category: (i) => (i % 2 === 0 ? 'general' : 'clothing') }
];

async function addDefaultStalls(t, zoneId, z) {
  for (let i = 0; i < z.count; i++) {
    await t.run(
      `INSERT INTO stalls (zone_id, code, size_sqm, category, price_per_day, regular_price_per_day, pos_row, pos_col, active)
       VALUES (?,?,4,?,650,450,?,?,1) ON CONFLICT (zone_id, code) DO NOTHING`,
      [zoneId, `${z.prefix}${i + 1}`, z.category(i), Math.floor(i / 4), i % 4]
    );
  }
}

async function seed() {
  const zoneCount = (await db.get('SELECT COUNT(*)::int AS c FROM zones')).c;
  if (zoneCount === 0) {
    await db.tx(async (t) => {
      for (const z of DEFAULT_ZONES) {
        const zone = await t.get(
          'INSERT INTO zones (name, description, color_index, sort_order) VALUES (?,?,?,?) RETURNING id',
          [z.name, z.description, z.color, z.order]
        );
        await addDefaultStalls(t, zone.id, z);
      }
    });
  }

  const adminCount = (await db.get('SELECT COUNT(*)::int AS c FROM admins')).c;
  if (adminCount === 0) {
    await db.run('INSERT INTO admins (username, name, password_hash, role, active) VALUES (?,?,?,?,1)', [
      'ongsa', 'OngSa', bcrypt.hashSync('GGEZ', 10), 'head'
    ]);
  }

  const announceCount = (await db.get('SELECT COUNT(*)::int AS c FROM announcements')).c;
  if (announceCount === 0) {
    await db.run('INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,1)', [
      'ยินดีต้อนรับสู่ตลาดปิ่นเกล้า', 'news',
      'ระบบจองล็อกเปิดให้ผู้ขายใช้งานแล้ว สามารถส่งคำขอจองล็อกได้ที่แท็บ "ผังตลาด" และเจ้าหน้าที่จะตรวจสอบให้ในเร็วๆ นี้'
    ]);
    await db.run('INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,0)', [
      'กฎของตลาด: ทางเดินต้องโล่ง', 'rule',
      'กรุณาดูแลให้ทางเดินระหว่างล็อกโล่ง ไม่มีกล่องหรืออุปกรณ์กีดขวาง เพื่อความสะดวกของผู้ป่วยและผู้เยี่ยมชมตลอดเวลา'
    ]);
  }

  await db.run('INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING');
}

// One-time upgrades for databases created by older versions. Each step runs once, so stalls an
// admin deletes on purpose are not re-created on the next deploy.
async function migrate() {
  const { v } = await db.get('SELECT COALESCE(seed_version, 1) AS v FROM settings WHERE id = 1');
  if (v < 2) {
    await db.tx(async (t) => {
      for (const z of DEFAULT_ZONES) {
        const zone = await t.get('SELECT id FROM zones WHERE name = ? ORDER BY id LIMIT 1', [z.name]);
        if (zone) await addDefaultStalls(t, zone.id, z);
      }
      await t.run('UPDATE settings SET seed_version = 2 WHERE id = 1');
    });
  }
}

db.init = async function init() {
  backend = await connect();
  for (const stmt of SCHEMA) await db.run(stmt);
  await seed();
  await migrate();
};

module.exports = db;
