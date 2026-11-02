// Shared rules for the users table (D2): what the API returns and the checks on names, phones and usernames.
const db = require('./db');
const { splitGoods } = require('./goods');

const USER_COLS = `u.user_id, u.role_id, r.role_name, u.username, u.password_hash, u.first_name, u.last_name, u.phone, u.address,
  u.line_id, u.category_id, u.is_regular, u.active, u.consent_at, u.created_at`;

function publicUser(u, cats) {
  const goods = cats && u.category_id ? splitGoods(cats, u.category_id) : { category: null, kind: null };
  return {
    id: u.user_id,
    roleId: u.role_id,
    roleName: u.role_name,
    username: u.username,
    firstName: u.first_name,
    lastName: u.last_name,
    name: `${u.first_name} ${u.last_name}`.trim(),
    phone: u.phone,
    address: u.address || '',
    lineId: u.line_id || '',
    category: goods.category,
    foodType: goods.kind,
    isRegular: !!u.is_regular,
    active: !!u.active,
    consentAt: u.consent_at,
    createdAt: u.created_at,
    // Guests who booked without an account have no username; they cannot sign in.
    hasLogin: !!(u.username && u.password_hash && !String(u.password_hash).startsWith('tok:'))
  };
}

function getUser(id, t = db) {
  return t.get(`SELECT ${USER_COLS} FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?`, [id]);
}

function sanitizeUsername(u) {
  return String(u || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
}

// Trimmed text fields from a request body; undefined when the field was not sent.
function readProfile(body) {
  const text = (v, max) => (v === undefined ? undefined : String(v == null ? '' : v).trim().slice(0, max));
  return {
    firstName: text(body.firstName, 100),
    lastName: text(body.lastName, 100),
    phone: body.phone === undefined ? undefined : db.cleanPhone(body.phone),
    address: text(body.address, 500),
    lineId: text(body.lineId, 50)
  };
}

function phoneError(phone) {
  return /^0\d{8,9}$/.test(phone) ? null : 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 9–10 หลัก ขึ้นต้นด้วย 0';
}

// Phones must be unique among accounts. Guests who only booked once (token users) don't count.
async function phoneTaken(phone, exceptId) {
  if (!phone) return false;
  return !!(await db.get(
    "SELECT user_id FROM users WHERE phone = ? AND user_id <> ? AND (password_hash IS NULL OR password_hash NOT LIKE 'tok:%')",
    [phone, exceptId || -1]));
}

async function usernameTaken(username, exceptId) {
  return !!(await db.get('SELECT user_id FROM users WHERE username = ? AND user_id <> ?', [username, exceptId || -1]));
}

async function sameNameUser(firstName, lastName, exceptId) {
  return db.get(
    `SELECT u.user_id, r.role_name FROM users u JOIN roles r ON r.role_id = u.role_id
     WHERE lower(u.first_name) = lower(?) AND lower(u.last_name) = lower(?) AND u.user_id <> ?
       AND (u.password_hash IS NULL OR u.password_hash NOT LIKE 'tok:%')`,
    [firstName, lastName, exceptId || -1]);
}

module.exports = { USER_COLS, publicUser, getUser, sanitizeUsername, readProfile, phoneError, phoneTaken, usernameTaken, sameNameUser };
