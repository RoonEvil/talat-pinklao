// e-Slip, level 1: read the mini QR code that Thai bank transfer slips carry.
// The QR holds only the sending bank and the transaction reference (no amount), so this can:
//  - tell whether the picture is a bank slip at all,
//  - stop the same slip from being used for two payments (the reference is unique).
// The amount on the slip is still checked by staff.
const jsQR = require('jsqr');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const BANKS = {
  '002': 'ธนาคารกรุงเทพ', '004': 'ธนาคารกสิกรไทย', '006': 'ธนาคารกรุงไทย', '011': 'ธนาคารทหารไทยธนชาต',
  '014': 'ธนาคารไทยพาณิชย์', '022': 'ธนาคารซีไอเอ็มบี ไทย', '024': 'ธนาคารยูโอบี', '025': 'ธนาคารกรุงศรีอยุธยา',
  '030': 'ธนาคารออมสิน', '033': 'ธนาคารอาคารสงเคราะห์', '034': 'ธ.ก.ส.', '067': 'ธนาคารทิสโก้',
  '069': 'ธนาคารเกียรตินาคินภัทร', '073': 'ธนาคารแลนด์ แอนด์ เฮ้าส์'
};

// Two-digit tag, two-digit length, value — the EMVCo style used by Thai QR codes.
function parseTlv(s) {
  const out = {};
  let i = 0;
  while (i + 4 <= s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(tag) || !Number.isInteger(len) || i + 4 + len > s.length) return null;
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return i === s.length ? out : null;
}

// { bank, ref } for a bank transfer slip QR, otherwise null.
function parseSlipQr(text) {
  const top = parseTlv(String(text || '').trim());
  if (!top || !top['00'] || top['51'] !== 'TH') return null;
  const inner = parseTlv(top['00']);
  if (!inner || inner['00'] !== '000001' || !/^\d{3}$/.test(inner['01'] || '') || !inner['02']) return null;
  if (!/^[0-9A-Za-z]{6,50}$/.test(inner['02'])) return null;
  return { bank: inner['01'], ref: inner['02'] };
}

function decodePixels(buffer, mime) {
  try {
    if (mime === 'image/png') {
      const png = PNG.sync.read(buffer);
      return { data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), width: png.width, height: png.height };
    }
    if (mime === 'image/jpeg') {
      const img = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256, maxResolutionInMP: 40 });
      return { data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.length), width: img.width, height: img.height };
    }
  } catch (e) { /* unreadable picture: treated as "no QR" */ }
  return null; // WEBP / GIF are not decoded
}

// Halves the picture (box filter). Large phone photos decode faster and more reliably a bit smaller.
function half(img) {
  const w = img.width >> 1, h = img.height >> 1;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const a = ((2 * y) * img.width + 2 * x) * 4 + c;
        const b = a + img.width * 4;
        out[(y * w + x) * 4 + c] = (img.data[a] + img.data[a + 4] + img.data[b] + img.data[b + 4]) >> 2;
      }
    }
  }
  return { data: out, width: w, height: h };
}

function findQrText(img) {
  let cur = img;
  for (let pass = 0; pass < 3 && cur && cur.width >= 120; pass++) {
    const hit = jsQR(cur.data, cur.width, cur.height, { inversionAttempts: 'attemptBoth' });
    if (hit && hit.data) return hit.data;
    cur = cur.width > 900 ? half(cur) : null;
  }
  return null;
}

// Result stored in payments.slip_check: 'ok' (bank slip QR read), 'not_slip' (a QR that is not a slip),
// 'no_qr' (no readable QR: staff check the picture themselves).
function checkSlip(buffer, mime) {
  const img = decodePixels(buffer, mime);
  if (!img) return { check: 'no_qr' };
  const text = findQrText(img);
  if (!text) return { check: 'no_qr' };
  const slip = parseSlipQr(text);
  if (!slip) return { check: 'not_slip' };
  return { check: 'ok', bank: slip.bank, ref: slip.ref };
}

function bankName(code) {
  return BANKS[code] || (code ? `ธนาคารรหัส ${code}` : '');
}

// Slips uploaded before this check existed are read once at start-up (no duplicates are rejected here;
// a reference that is already used is only marked).
async function backfill(db) {
  const rows = await db.all(
    `SELECT p.payment_id, pic.mime_type, pic.data FROM payments p JOIN pictures pic ON pic.picture_id = p.slip_picture_id
     WHERE p.slip_check IS NULL`);
  for (const r of rows) {
    const res = checkSlip(Buffer.from(r.data), r.mime_type);
    let check = res.check;
    let ref = res.ref || null;
    if (ref && (await db.get('SELECT 1 FROM payments WHERE slip_ref = ? AND payment_id <> ?', [ref, r.payment_id]))) {
      check = 'duplicate'; ref = null;
    }
    await db.run('UPDATE payments SET slip_check = ?, slip_ref = ?, slip_bank = ? WHERE payment_id = ?',
      [check, ref, res.bank || null, r.payment_id]);
  }
  return rows.length;
}

module.exports = { checkSlip, parseSlipQr, bankName, backfill, BANKS };
