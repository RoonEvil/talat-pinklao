const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'market.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  username TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('staff','head')) DEFAULT 'staff',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  is_regular INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT DEFAULT (datetime('now')),
  last_booking_at TEXT
);

CREATE TABLE IF NOT EXISTS zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  color_index INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stalls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  size_sqm REAL DEFAULT 4,
  category TEXT NOT NULL DEFAULT 'other',
  price_per_day REAL NOT NULL DEFAULT 650,
  regular_price_per_day REAL NOT NULL DEFAULT 450,
  pos_row INTEGER DEFAULT 0,
  pos_col INTEGER DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(zone_id, code)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stall_id INTEGER NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  vendor_token TEXT NOT NULL,
  vendor_name TEXT NOT NULL,
  vendor_phone TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  note TEXT,
  deposit_amount REAL NOT NULL DEFAULT 0,
  rate_type TEXT NOT NULL DEFAULT 'guest',
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL CHECK(payment_status IN ('unpaid','paid','confirmed')) DEFAULT 'unpaid',
  receipt_path TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','cancelled')) DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'news',
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  stall_id INTEGER,
  stall_code TEXT,
  zone_id INTEGER,
  date TEXT NOT NULL,
  vendor_name TEXT,
  present INTEGER NOT NULL DEFAULT 1,
  category_match INTEGER NOT NULL DEFAULT 1,
  fine_amount REAL NOT NULL DEFAULT 0,
  fine_reason TEXT,
  recorded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  prompt_pay_qr_path TEXT
);
`);

function seed() {
  const zoneCount = db.prepare('SELECT COUNT(*) c FROM zones').get().c;
  if (zoneCount === 0) {
    const insertZone = db.prepare(
      'INSERT INTO zones (name, description, color_index, sort_order) VALUES (?,?,?,?)'
    );
    const zones = [
      ['Fresh & Prepared Food Zone', 'Cooked food, snacks and drinks under the main tents (โซนอาหารสดและสำเร็จรูป)', 0, 1, 'F', 'food'],
      ['General Goods Zone', 'Clothing, household items and general merchandise (โซนสินค้าทั่วไป)', 1, 2, 'G', 'general']
    ];
    const insertStall = db.prepare(
      `INSERT INTO stalls (zone_id, code, size_sqm, category, price_per_day, regular_price_per_day, pos_row, pos_col, active)
       VALUES (?,?,4,?,650,450,?,?,1)`
    );
    const tx = db.transaction(() => {
      zones.forEach((z, zi) => {
        const info = insertZone.run(z[0], z[1], z[2], z[3]);
        for (let i = 0; i < 8; i++) {
          const code = `${z[4]}${i + 1}`;
          const cat = z[5] === 'general' ? (i % 2 === 0 ? 'general' : 'clothing') : z[5];
          insertStall.run(info.lastInsertRowid, code, cat, Math.floor(i / 4), i % 4);
        }
      });
    });
    tx();
  }

  const adminCount = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
  if (adminCount === 0) {
    db.prepare('INSERT INTO admins (username, name, password_hash, role, active) VALUES (?,?,?,?,1)').run(
      'ongsa', 'OngSa', bcrypt.hashSync('GGEZ', 10), 'head'
    );
  }

  const announceCount = db.prepare('SELECT COUNT(*) c FROM announcements').get().c;
  if (announceCount === 0) {
    db.prepare('INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,1)').run(
      'Welcome to Talat Pinklao', 'news',
      'This booking system is now open for vendors. Submit a stall request from the Market Map tab and market staff will review it shortly.'
    );
    db.prepare('INSERT INTO announcements (title, type, body, pinned) VALUES (?,?,?,0)').run(
      'Market rule: keep aisles clear', 'rule',
      'Please keep walkways between stalls clear of boxes and equipment at all times for patient and visitor access.'
    );
  }

  const settingsRow = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!settingsRow) {
    db.prepare('INSERT INTO settings (id, prompt_pay_qr_path) VALUES (1, NULL)').run();
  }
}

seed();

module.exports = db;
