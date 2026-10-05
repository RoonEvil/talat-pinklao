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
    last_booking_at TIMESTAMPTZ
  )`,
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
    decided_at TIMESTAMPTZ
  )`,
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
    map_layout TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`
];

async function seed() {
  const zoneCount = (await db.get('SELECT COUNT(*)::int AS c FROM zones')).c;
  if (zoneCount === 0) {
    const zones = [
      ['โซนอาหารสดและสำเร็จรูป', 'อาหารปรุงสำเร็จ ของว่าง และเครื่องดื่ม ใต้เต็นท์หลัก', 0, 1, 'F', 'food'],
      ['โซนสินค้าทั่วไป', 'เสื้อผ้า ของใช้ในบ้าน และสินค้าทั่วไป', 1, 2, 'G', 'general']
    ];
    await db.tx(async (t) => {
      for (const z of zones) {
        const zone = await t.get(
          'INSERT INTO zones (name, description, color_index, sort_order) VALUES (?,?,?,?) RETURNING id',
          [z[0], z[1], z[2], z[3]]
        );
        for (let i = 0; i < 8; i++) {
          const cat = z[5] === 'general' ? (i % 2 === 0 ? 'general' : 'clothing') : z[5];
          await t.run(
            `INSERT INTO stalls (zone_id, code, size_sqm, category, price_per_day, regular_price_per_day, pos_row, pos_col, active)
             VALUES (?,?,4,?,650,450,?,?,1)`,
            [zone.id, `${z[4]}${i + 1}`, cat, Math.floor(i / 4), i % 4]
          );
        }
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

db.init = async function init() {
  backend = await connect();
  for (const stmt of SCHEMA) await db.run(stmt);
  await seed();
};

module.exports = db;
