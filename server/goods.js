// What vendors sell, from the categories table: top-level categories (parent_id NULL) and kinds under them
// (e.g. kinds of food under "อาหารและเครื่องดื่ม"). A booking stores one category id: the kind when the
// category has kinds, otherwise the category itself.
const db = require('./db');

async function loadCategories(t = db) {
  const rows = await t.all('SELECT category_id, parent_id, category_name, sort_order FROM categories ORDER BY sort_order, category_id');
  const byId = new Map(rows.map((r) => [r.category_id, r]));
  const hasKinds = new Set(rows.filter((r) => r.parent_id).map((r) => r.parent_id));
  return { rows, byId, hasKinds };
}

// { category, kind } for the API: the top-level category id and the kind id (or null).
function splitGoods(cats, categoryId) {
  const c = cats.byId.get(Number(categoryId));
  if (!c) return { category: null, kind: null };
  return c.parent_id ? { category: c.parent_id, kind: c.category_id } : { category: c.category_id, kind: null };
}

// Reads { category, foodType } from a request; returns { categoryId } or { error }.
function readGoods(cats, body) {
  const top = cats.byId.get(Number(body.category));
  if (!top || top.parent_id) return { error: 'กรุณาเลือกประเภทสินค้า' };
  if (!cats.hasKinds.has(top.category_id)) return { categoryId: top.category_id };
  const kind = cats.byId.get(Number(body.foodType));
  if (!kind || kind.parent_id !== top.category_id) return { error: `กรุณาเลือกชนิดของ${top.category_name}` };
  return { categoryId: kind.category_id };
}

function goodsLabel(cats, categoryId) {
  const c = cats.byId.get(Number(categoryId));
  return c ? c.category_name : 'ไม่ระบุ';
}

// Two bookings sell "the same thing" when their category ids match. "อื่นๆ" is too vague to compare.
function goodsKey(cats, categoryId) {
  const c = cats.byId.get(Number(categoryId));
  if (!c) return null;
  const top = c.parent_id ? cats.byId.get(c.parent_id) : c;
  if (top && top.category_name === 'อื่นๆ') return null;
  return c.category_id;
}

// A zone accepts a category when it lists it, or lists its parent. A zone with no rows accepts anything.
function allowsGoods(cats, allowedIds, categoryId) {
  if (!allowedIds.length) return true;
  const c = cats.byId.get(Number(categoryId));
  if (!c) return false;
  return allowedIds.includes(c.category_id) || (c.parent_id != null && allowedIds.includes(c.parent_id));
}

function allowedLabel(cats, allowedIds) {
  return allowedIds.map((id) => goodsLabel(cats, id)).join(', ');
}

async function zoneAllowedIds(zoneId, t = db) {
  return (await t.all('SELECT category_id FROM zone_categories WHERE zone_id = ? ORDER BY category_id', [zoneId])).map((r) => r.category_id);
}

module.exports = { loadCategories, splitGoods, readGoods, goodsLabel, goodsKey, allowsGoods, allowedLabel, zoneAllowedIds };
