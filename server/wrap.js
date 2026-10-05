// Express 4 doesn't catch rejected promises from async handlers; forward them to the error handler.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Postgres rejects non-numeric or out-of-range ids instead of returning nothing.
wrap.isId = (v) => /^\d{1,9}$/.test(String(v));
wrap.numericIdParam = (req, res, next, id) =>
  (wrap.isId(id) ? next() : res.status(404).json({ error: 'ไม่พบข้อมูล' }));

module.exports = wrap;
