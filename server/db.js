const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Routes write SQL with `?` placeholders; Postgres wants $1, $2, ...
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + ++i);
}

function makeApi(runQuery) {
  return {
    all: (sql, params = []) => runQuery(toPg(sql), params),
    get: async (sql, params = []) => (await runQuery(toPg(sql), params))[0],
    run: (sql, params = []) => runQuery(toPg(sql), params)
  };
}

// DATE stays 'YYYY-MM-DD' (no time-zone shifts); NUMERIC becomes a JS number.
const DATE_OID = 1082;
const NUMERIC_OID = 1700;
const parseNumeric = (v) => (v == null ? null : parseFloat(v));

let backend = null;

async function connect() {
  if (process.env.DATABASE_URL) {
    const pg = require('pg');
    pg.types.setTypeParser(DATE_OID, (v) => v);
    pg.types.setTypeParser(NUMERIC_OID, parseNumeric);
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
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
  const pg = new PGlite(process.env.PGLITE_DIR || require('path').join(__dirname, '.pgdata'), {
    parsers: { [DATE_OID]: (v) => v, [NUMERIC_OID]: parseNumeric }
  });
  console.warn('DATABASE_URL not set — using local PGlite database (development only).');
  return {
    query: async (sql, params) => (await pg.query(sql, params)).rows,
    tx: (fn) => pg.transaction((t) => fn(makeApi(async (sql, params) => (await t.query(sql, params)).rows)))
  };
}

const db = makeApi((sql, params) => backend.query(sql, params));
db.tx = (fn) => backend.tx(fn);

// The 12 tables of the data dictionary (D1–D12), in foreign-key order.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS roles (
    role_id INTEGER PRIMARY KEY,
    role_name VARCHAR(30) NOT NULL,
    menu_access TEXT NOT NULL DEFAULT '',
    description TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    category_id SERIAL PRIMARY KEY,
    parent_id INTEGER REFERENCES categories(category_id) ON DELETE CASCADE,
    category_name VARCHAR(100) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    role_id INTEGER NOT NULL REFERENCES roles(role_id),
    username VARCHAR(50) UNIQUE,
    password_hash VARCHAR(100),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL DEFAULT '',
    phone VARCHAR(15) NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    line_id VARCHAR(50),
    category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
    is_regular BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    consent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS zones (
    zone_id SERIAL PRIMARY KEY,
    zone_name VARCHAR(100) NOT NULL,
    description TEXT,
    color VARCHAR(20) NOT NULL DEFAULT 'zone-1',
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS zone_categories (
    zone_id INTEGER NOT NULL REFERENCES zones(zone_id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
    PRIMARY KEY (zone_id, category_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stalls (
    stall_id SERIAL PRIMARY KEY,
    zone_id INTEGER NOT NULL REFERENCES zones(zone_id),
    stall_code VARCHAR(10) NOT NULL UNIQUE,
    size_sqm NUMERIC(5,2) NOT NULL DEFAULT 4,
    price_per_day NUMERIC(10,2) NOT NULL DEFAULT 650,
    regular_price_per_day NUMERIC(10,2) NOT NULL DEFAULT 450,
    active BOOLEAN NOT NULL DEFAULT TRUE
  )`,
  `CREATE TABLE IF NOT EXISTS market_layouts (
    layout_id SERIAL PRIMARY KEY,
    layout_data JSONB NOT NULL,
    updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS pictures (
    picture_id SERIAL PRIMARY KEY,
    picture_type VARCHAR(20) NOT NULL CHECK (picture_type IN ('slip','promptpay_qr')),
    mime_type VARCHAR(50) NOT NULL,
    data BYTEA NOT NULL,
    uploaded_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
    booking_id SERIAL PRIMARY KEY,
    stall_id INTEGER NOT NULL REFERENCES stalls(stall_id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES users(user_id),
    category_id INTEGER REFERENCES categories(category_id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    rate_type VARCHAR(10) NOT NULL DEFAULT 'walkin' CHECK (rate_type IN ('walkin','regular')),
    total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    note TEXT,
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    approved_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
    payment_id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(booking_id) ON DELETE CASCADE,
    method VARCHAR(10) NOT NULL CHECK (method IN ('promptpay','transfer','cash')),
    amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    slip_picture_id INTEGER REFERENCES pictures(picture_id) ON DELETE SET NULL,
    slip_ref VARCHAR(50),
    slip_bank VARCHAR(3),
    slip_check VARCHAR(10) CHECK (slip_check IN ('ok','not_slip','no_qr','duplicate')),
    status VARCHAR(10) NOT NULL CHECK (status IN ('paid','confirmed')),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    confirmed_at TIMESTAMPTZ
  )`,
  // e-Slip (level 1): the transaction reference read from the slip's QR code. One slip pays one booking.
  'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_ref VARCHAR(50)',
  'ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_bank VARCHAR(3)',
  `ALTER TABLE payments ADD COLUMN IF NOT EXISTS slip_check VARCHAR(10) CHECK (slip_check IN ('ok','not_slip','no_qr','duplicate'))`,
  'CREATE UNIQUE INDEX IF NOT EXISTS payments_slip_ref_key ON payments (slip_ref) WHERE slip_ref IS NOT NULL',
  `CREATE TABLE IF NOT EXISTS inspections (
    inspection_id SERIAL PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
    inspect_date DATE NOT NULL,
    present BOOLEAN NOT NULL DEFAULT TRUE,
    category_match BOOLEAN NOT NULL DEFAULT TRUE,
    fine_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    fine_reason TEXT,
    inspected_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (booking_id, inspect_date)
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    announcement_id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'news',
    body TEXT NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`
];

// Used by backup/restore, in foreign-key-safe insert order. `pk` is the serial key whose sequence is reset after a restore.
db.TABLES = [
  { name: 'roles', cols: ['role_id', 'role_name', 'menu_access', 'description'] },
  { name: 'categories', pk: 'category_id', cols: ['category_id', 'parent_id', 'category_name', 'sort_order'] },
  { name: 'users', pk: 'user_id', cols: ['user_id', 'role_id', 'username', 'password_hash', 'first_name', 'last_name', 'phone', 'address', 'line_id', 'category_id', 'is_regular', 'active', 'consent_at', 'created_at'] },
  { name: 'zones', pk: 'zone_id', cols: ['zone_id', 'zone_name', 'description', 'color', 'sort_order'] },
  { name: 'zone_categories', cols: ['zone_id', 'category_id'] },
  { name: 'stalls', pk: 'stall_id', cols: ['stall_id', 'zone_id', 'stall_code', 'size_sqm', 'price_per_day', 'regular_price_per_day', 'active'] },
  { name: 'market_layouts', pk: 'layout_id', cols: ['layout_id', 'layout_data', 'updated_by', 'updated_at'] },
  { name: 'pictures', pk: 'picture_id', binary: true, cols: ['picture_id', 'picture_type', 'mime_type', 'uploaded_by', 'created_at'] },
  { name: 'bookings', pk: 'booking_id', cols: ['booking_id', 'stall_id', 'vendor_id', 'category_id', 'start_date', 'end_date', 'rate_type', 'total_amount', 'note', 'status', 'created_by', 'approved_by', 'created_at', 'decided_at'] },
  { name: 'payments', pk: 'payment_id', cols: ['payment_id', 'booking_id', 'method', 'amount', 'slip_picture_id', 'slip_ref', 'slip_bank', 'slip_check', 'status', 'paid_at', 'confirmed_by', 'confirmed_at'] },
  { name: 'inspections', pk: 'inspection_id', cols: ['inspection_id', 'booking_id', 'inspect_date', 'present', 'category_match', 'fine_amount', 'fine_reason', 'inspected_by', 'recorded_at'] },
  { name: 'announcements', pk: 'announcement_id', cols: ['announcement_id', 'title', 'type', 'body', 'pinned', 'created_by', 'created_at'] }
];

// Menus of the staff side ("ระบบจัดการข้อมูล"). roles.menu_access lists the keys a role may open.
db.MENUS = ['users', 'market', 'bookings', 'payments', 'inspections', 'announcements', 'reports', 'settings'];
db.ROLE = { ADMIN: 1, STAFF: 2, VENDOR: 3 };
const DEFAULT_ROLES = [
  [1, 'ผู้ดูแลระบบ', db.MENUS.join(','), 'จัดการข้อมูลได้ทุกส่วนของระบบ รวมถึงผู้ใช้ สิทธิ์ และการตั้งค่าระบบ'],
  [2, 'เจ้าหน้าที่ตลาด', 'users,market,bookings,payments,inspections,announcements,reports', 'อนุมัติการจอง ยืนยันการรับเงิน ตรวจตลาด และจัดการข้อมูลผู้ค้า ผังตลาด และประกาศ'],
  [3, 'ผู้ค้า', 'map,mine', 'ดูผังตลาด จองล็อก ชำระเงิน และติดตามการจองของตนเอง']
];

// Goods: top-level categories, and kinds of food under "อาหารและเครื่องดื่ม".
const DEFAULT_CATEGORIES = [
  { key: 'food', name: 'อาหารและเครื่องดื่ม', subs: [
    ['ready_meal', 'ข้าวแกง / อาหารปรุงสำเร็จ'], ['made_to_order', 'อาหารตามสั่ง / ก๋วยเตี๋ยว'], ['grill_fried', 'ปิ้งย่าง / ของทอด'],
    ['dessert', 'ขนมไทย / ของหวาน'], ['bakery', 'เบเกอรี่'], ['drink', 'เครื่องดื่ม'], ['fruit', 'ผลไม้'], ['fresh', 'อาหารสด (ผัก เนื้อ ปลา)']
  ] },
  { key: 'clothing', name: 'เสื้อผ้าและเครื่องประดับ' },
  { key: 'general', name: 'สินค้าทั่วไป' },
  { key: 'service', name: 'บริการ' },
  { key: 'other', name: 'อื่นๆ' }
];

// Inserts the default categories; returns a map from the old text keys ('food', 'food:drink') to category ids.
async function seedCategories(t) {
  const map = {};
  let order = 0;
  for (const c of DEFAULT_CATEGORIES) {
    const top = await t.get('INSERT INTO categories (parent_id, category_name, sort_order) VALUES (NULL,?,?) RETURNING category_id', [c.name, ++order]);
    map[c.key] = top.category_id;
    let sub = 0;
    for (const [key, name] of c.subs || []) {
      const row = await t.get('INSERT INTO categories (parent_id, category_name, sort_order) VALUES (?,?,?) RETURNING category_id', [top.category_id, name, ++sub]);
      map[`food:${key}`] = row.category_id;
    }
  }
  return map;
}

// The market starts with 55 stalls: F1–F28 in the food zone and G1–G27 in the general zone.
const DEFAULT_ZONES = [
  { name: 'โซนอาหารสดและสำเร็จรูป', description: 'อาหารปรุงสำเร็จ ของว่าง และเครื่องดื่ม ใต้เต็นท์หลัก', color: 'zone-1', prefix: 'F', count: 28, allowed: ['food'] },
  { name: 'โซนสินค้าทั่วไป', description: 'เสื้อผ้า ของใช้ในบ้าน และสินค้าทั่วไป', color: 'zone-2', prefix: 'G', count: 27, allowed: ['clothing', 'general', 'service', 'other'] }
];

db.splitName = function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  return { first: (parts.shift() || '-').slice(0, 100), last: parts.join(' ').slice(0, 100) };
};
db.cleanPhone = (p) => String(p || '').replace(/[^0-9+]/g, '').slice(0, 15);
// Guests who book without an account prove who they are with a random token kept in their browser.
// Only its hash is stored, in password_hash, so it cannot be used to sign in.
db.guestHash = (token) => 'tok:' + crypto.createHash('sha256').update(String(token)).digest('hex');

async function seed() {
  for (const r of DEFAULT_ROLES) {
    await db.run('INSERT INTO roles (role_id, role_name, menu_access, description) VALUES (?,?,?,?) ON CONFLICT (role_id) DO NOTHING', r);
  }
  // Settings stay with the head of the system, whatever was saved.
  await db.run('UPDATE roles SET menu_access = ? WHERE role_id = 1', [db.MENUS.join(',')]);

  const hasCategories = (await db.get('SELECT COUNT(*)::int AS c FROM categories')).c > 0;
  const hasZones = (await db.get('SELECT COUNT(*)::int AS c FROM zones')).c > 0;
  if (!hasCategories || !hasZones) {
    await db.tx(async (t) => {
      let map = {};
      if (!hasCategories) map = await seedCategories(t);
      if (hasZones) return;
      let order = 0;
      for (const z of DEFAULT_ZONES) {
        const zone = await t.get('INSERT INTO zones (zone_name, description, color, sort_order) VALUES (?,?,?,?) RETURNING zone_id', [z.name, z.description, z.color, ++order]);
        for (const key of z.allowed) {
          if (map[key]) await t.run('INSERT INTO zone_categories (zone_id, category_id) VALUES (?,?)', [zone.zone_id, map[key]]);
        }
        for (let i = 1; i <= z.count; i++) {
          await t.run('INSERT INTO stalls (zone_id, stall_code) VALUES (?,?) ON CONFLICT (stall_code) DO NOTHING', [zone.zone_id, `${z.prefix}${i}`]);
        }
      }
    });
  }

  if ((await db.get('SELECT COUNT(*)::int AS c FROM users')).c === 0) {
    await db.run(
      'INSERT INTO users (role_id, username, password_hash, first_name, last_name) VALUES (1,?,?,?,?)',
      ['ongsa', bcrypt.hashSync('GGEZ', 10), 'OngSa', '']
    );
  }

  if ((await db.get('SELECT COUNT(*)::int AS c FROM announcements')).c === 0) {
    await db.run('INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,TRUE)', [
      'ยินดีต้อนรับสู่ตลาดปิ่นเกล้า', 'news',
      'ระบบจองล็อกเปิดให้ผู้ค้าใช้งานแล้ว สามารถส่งคำขอจองล็อกได้ที่แท็บ "ผังตลาด" และเจ้าหน้าที่ตลาดจะตรวจสอบให้ในเร็วๆ นี้'
    ]);
    await db.run('INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,FALSE)', [
      'กฎของตลาด: ทางเดินต้องโล่ง', 'rule',
      'กรุณาดูแลให้ทางเดินระหว่างล็อกโล่ง ไม่มีกล่องหรืออุปกรณ์กีดขวาง เพื่อความสะดวกของผู้ป่วยและผู้เยี่ยมชมตลอดเวลา'
    ]);
  }
}

// ---------------------------------------------------------------------------------------------
// One-time move from the first version's tables (admins, vendors, settings, files, audit_logs …)
// to the 12 tables above. The old tables are kept, renamed legacy_*, so nothing is lost.
// ---------------------------------------------------------------------------------------------
const LEGACY = ['admins', 'vendors', 'zones', 'stalls', 'bookings', 'announcements', 'audit_logs', 'settings', 'files'];

async function hasTable(t, name) {
  return !!(await t.get('SELECT to_regclass(?) AS r', [`public.${name}`])).r;
}

async function moveLegacyTablesAside(t) {
  for (const name of LEGACY) {
    if (!(await hasTable(t, name))) continue;
    await t.run(`ALTER TABLE ${name} RENAME TO legacy_${name}`);
    // Index and sequence names would clash with the new tables (e.g. zones_pkey).
    for (const ix of await t.all('SELECT indexname FROM pg_indexes WHERE schemaname = \'public\' AND tablename = ?', [`legacy_${name}`])) {
      if (!ix.indexname.startsWith('legacy_')) await t.run(`ALTER INDEX "${ix.indexname}" RENAME TO "legacy_${ix.indexname}"`);
    }
    for (const sq of await t.all(
      `SELECT c.relname FROM pg_class c JOIN pg_depend d ON d.objid = c.oid
       JOIN pg_class tb ON tb.oid = d.refobjid WHERE c.relkind = 'S' AND tb.relname = ?`, [`legacy_${name}`])) {
      if (!sq.relname.startsWith('legacy_')) await t.run(`ALTER SEQUENCE "${sq.relname}" RENAME TO "legacy_${sq.relname}"`);
    }
  }
}

async function copyLegacyData(t) {
  const cat = await seedCategories(t);
  const goodsId = (category, foodType) => (category === 'food' && foodType && cat[`food:${foodType}`]) || cat[category] || cat.other;

  // Zones keep their ids, so the saved map and the stalls stay linked.
  for (const z of await t.all('SELECT * FROM legacy_zones ORDER BY id')) {
    await t.run('INSERT INTO zones (zone_id, zone_name, description, color, sort_order) VALUES (?,?,?,?,?)',
      [z.id, String(z.name).slice(0, 100), z.description, `zone-${(Math.abs(z.color_index || 0) % 4) + 1}`, z.sort_order || 0]);
    const allowed = String(z.allowed_goods || '').split(',').filter(Boolean);
    const ids = new Set(allowed.map((k) => cat[k]).filter(Boolean));
    if (ids.has(cat.food)) for (const k of Object.keys(cat)) if (k.startsWith('food:')) ids.delete(cat[k]);
    for (const id of ids) await t.run('INSERT INTO zone_categories (zone_id, category_id) VALUES (?,?)', [z.id, id]);
  }
  const usedCodes = new Set();
  for (const s of await t.all('SELECT * FROM legacy_stalls ORDER BY id')) {
    let code = String(s.code).slice(0, 10);
    if (usedCodes.has(code)) code = `${code.slice(0, 6)}-${s.id}`.slice(0, 10);
    usedCodes.add(code);
    await t.run('INSERT INTO stalls (stall_id, zone_id, stall_code, size_sqm, price_per_day, regular_price_per_day, active) VALUES (?,?,?,?,?,?,?)',
      [s.id, s.zone_id, code, s.size_sqm || 4, s.price_per_day, s.regular_price_per_day, !!s.active]);
  }

  const userOf = {};
  const usernames = new Set();
  for (const a of await t.all('SELECT * FROM legacy_admins ORDER BY created_at, username')) {
    const n = db.splitName(a.name);
    const row = await t.get(
      'INSERT INTO users (role_id, username, password_hash, first_name, last_name, active, created_at) VALUES (?,?,?,?,?,?,COALESCE(?, NOW())) RETURNING user_id',
      [a.role === 'head' ? 1 : 2, a.username, a.password_hash, n.first, n.last, !!a.active, a.created_at]);
    userOf[`admin:${a.username}`] = row.user_id;
    usernames.add(a.username);
  }
  async function addVendor(id, name, phone, extra) {
    const n = db.splitName(name);
    const registered = !!(extra && extra.password_hash);
    let username = null;
    if (registered) {
      username = String(id).slice(0, 50);
      if (usernames.has(username)) username = `${username.slice(0, 46)}_v`;
      usernames.add(username);
    }
    const hash = registered ? extra.password_hash : (String(id).startsWith('walkin-') ? null : db.guestHash(id));
    const row = await t.get(
      `INSERT INTO users (role_id, username, password_hash, first_name, last_name, phone, category_id, is_regular, active, created_at)
       VALUES (3,?,?,?,?,?,?,?,?,COALESCE(?, NOW())) RETURNING user_id`,
      [username, hash, n.first, n.last, db.cleanPhone(phone), extra ? extra.category_id : null,
        !!(extra && extra.is_regular), extra ? !!extra.active : true, extra ? extra.joined_at : null]);
    userOf[`vendor:${id}`] = row.user_id;
    return row.user_id;
  }
  for (const v of await t.all('SELECT * FROM legacy_vendors ORDER BY joined_at, id')) {
    const cats = String(v.categories || v.category || '').split(',').filter(Boolean);
    const foods = String(v.food_types || '').split(',').filter(Boolean);
    // One category per vendor now; someone who sold several kinds of food keeps "food" so all their kinds stay allowed.
    // Older accounts that listed several categories keep no restriction.
    const categoryId = v.password_hash && cats.length === 1 ? (foods.length > 1 ? cat.food : goodsId(cats[0], foods[0])) : null;
    await addVendor(v.id, v.name, v.phone, { ...v, category_id: categoryId });
  }

  const pictureOf = {};
  async function copyPicture(path, type) {
    const fileId = String(path || '').replace('/files/', '');
    if (!fileId) return null;
    if (pictureOf[fileId]) return pictureOf[fileId];
    const f = await t.get('SELECT mime, data, created_at FROM legacy_files WHERE id = ?', [fileId]);
    if (!f) return null;
    const row = await t.get('INSERT INTO pictures (picture_type, mime_type, data, created_at) VALUES (?,?,?,COALESCE(?, NOW())) RETURNING picture_id',
      [type, f.mime, f.data, f.created_at]);
    pictureOf[fileId] = row.picture_id;
    return row.picture_id;
  }

  for (const b of await t.all('SELECT * FROM legacy_bookings ORDER BY id')) {
    const vendorId = userOf[`vendor:${b.vendor_token}`] || (await addVendor(b.vendor_token, b.vendor_name, b.vendor_phone, null));
    await t.run(
      `INSERT INTO bookings (booking_id, stall_id, vendor_id, category_id, start_date, end_date, rate_type, total_amount, note, status, created_by, created_at, decided_at)
       VALUES (?,?,?,?,?::date,?::date,?,?,?,?,?,COALESCE(?, NOW()),?)`,
      [b.id, b.stall_id, vendorId, goodsId(b.category, b.food_type), b.start_date, b.end_date,
        b.rate_type === 'regular' ? 'regular' : 'walkin', b.deposit_amount || 0, b.note, b.status,
        b.created_by ? userOf[`admin:${b.created_by}`] || null : null, b.created_at, b.decided_at]);
    if (b.payment_status === 'paid' || b.payment_status === 'confirmed') {
      const slip = b.receipt_path ? await copyPicture(b.receipt_path, 'slip') : null;
      const method = b.payment_method === 'bank' ? 'transfer' : (['promptpay', 'cash'].includes(b.payment_method) ? b.payment_method : 'promptpay');
      await t.run(
        `INSERT INTO payments (booking_id, method, amount, slip_picture_id, status, paid_at, confirmed_at)
         VALUES (?,?,?,?,?,COALESCE(?, NOW()),?)`,
        [b.id, method, b.deposit_amount || 0, slip, b.payment_status, b.decided_at || b.created_at,
          b.payment_status === 'confirmed' ? (b.decided_at || b.created_at) : null]);
    }
  }

  const settings = await t.get('SELECT * FROM legacy_settings WHERE id = 1');
  if (settings && settings.map_layout) {
    try {
      await t.run('INSERT INTO market_layouts (layout_data) VALUES (?::jsonb)', [JSON.stringify(JSON.parse(settings.map_layout))]);
    } catch (e) { /* unreadable old map: the market starts from the automatic layout */ }
  }
  if (settings && settings.prompt_pay_qr_path) await copyPicture(settings.prompt_pay_qr_path, 'promptpay_qr');

  for (const l of await t.all('SELECT * FROM legacy_audit_logs ORDER BY recorded_at')) {
    await t.run(
      `INSERT INTO inspections (booking_id, inspect_date, present, category_match, fine_amount, fine_reason, recorded_at)
       VALUES (?,?::date,?,?,?,?,COALESCE(?, NOW())) ON CONFLICT (booking_id, inspect_date) DO NOTHING`,
      [l.booking_id, l.date, !!l.present, !!l.category_match, l.fine_amount || 0, l.fine_reason, l.recorded_at]);
  }
  for (const a of await t.all('SELECT * FROM legacy_announcements ORDER BY id')) {
    await t.run('INSERT INTO announcements (announcement_id, title, type, body, pinned, created_at) VALUES (?,?,?,?,?,COALESCE(?, NOW()))',
      [a.id, String(a.title).slice(0, 200), String(a.type || 'news').slice(0, 20), a.body, !!a.pinned, a.created_at]);
  }
  await db.resetSequences(t);
}

db.resetSequences = async function resetSequences(t) {
  for (const table of db.TABLES) {
    if (!table.pk) continue;
    await t.run(`SELECT setval(pg_get_serial_sequence('${table.name}', '${table.pk}'), COALESCE(MAX(${table.pk}), 0) + 1, false) FROM ${table.name}`);
  }
};

async function upgradeFromFirstVersion() {
  await db.tx(async (t) => {
    if (!(await hasTable(t, 'admins')) || (await hasTable(t, 'users'))) return;
    console.log('Upgrading database to the users/roles design (old tables are kept as legacy_*) …');
    await moveLegacyTablesAside(t);
    for (const stmt of SCHEMA) await t.run(stmt);
    for (const r of DEFAULT_ROLES) await t.run('INSERT INTO roles (role_id, role_name, menu_access, description) VALUES (?,?,?,?)', r);
    await copyLegacyData(t);
    console.log('Upgrade finished.');
  });
}

// Required profile fields (first name, last name, phone, address) are NOT NULL; address became required later.
async function tightenUsers() {
  await db.run("UPDATE users SET address = '' WHERE address IS NULL");
  await db.run("ALTER TABLE users ALTER COLUMN address SET DEFAULT ''");
  await db.run('ALTER TABLE users ALTER COLUMN address SET NOT NULL');
  // Phones are unique among accounts. Older data may hold duplicates; then the app check still applies
  // and the index is added on a later start, once the admin has corrected those numbers.
  try {
    await db.run("CREATE UNIQUE INDEX IF NOT EXISTS users_account_phone_key ON users (phone) WHERE username IS NOT NULL AND phone <> ''");
  } catch (e) {
    console.warn('Duplicate phone numbers among accounts — unique index not created yet:', e.message);
  }
}

db.init = async function init() {
  backend = await connect();
  await upgradeFromFirstVersion();
  for (const stmt of SCHEMA) await db.run(stmt);
  await tightenUsers();
  await seed();
};

module.exports = db;
