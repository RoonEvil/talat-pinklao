// What vendors sell. Keep ids and labels in sync with CATEGORIES / FOOD_TYPES in public/app.js.
const CATEGORY_LABELS = {
  food: 'อาหารและเครื่องดื่ม',
  clothing: 'เสื้อผ้าและเครื่องประดับ',
  general: 'สินค้าทั่วไป',
  service: 'บริการ',
  other: 'อื่นๆ'
};
const FOOD_TYPE_LABELS = {
  ready_meal: 'ข้าวแกง / อาหารปรุงสำเร็จ',
  made_to_order: 'อาหารตามสั่ง / ก๋วยเตี๋ยว',
  grill_fried: 'ปิ้งย่าง / ของทอด',
  dessert: 'ขนมไทย / ของหวาน',
  bakery: 'เบเกอรี่',
  drink: 'เครื่องดื่ม',
  fruit: 'ผลไม้',
  fresh: 'อาหารสด (ผัก เนื้อ ปลา)'
};
const CATEGORY_IDS = Object.keys(CATEGORY_LABELS);
const FOOD_TYPE_IDS = Object.keys(FOOD_TYPE_LABELS);

function splitList(s) {
  return s ? String(s).split(',').filter(Boolean) : [];
}

// Two bookings sell "the same thing" when their keys match. Food is compared by food type;
// "other" is too vague to compare, so it never counts as the same.
function goodsKey(category, foodType) {
  if (!category || category === 'other') return null;
  if (category === 'food') return foodType ? `food:${foodType}` : null;
  return category;
}

function goodsLabel(category, foodType) {
  if (category === 'food' && FOOD_TYPE_LABELS[foodType]) return FOOD_TYPE_LABELS[foodType];
  return CATEGORY_LABELS[category] || category;
}

module.exports = { CATEGORY_IDS, FOOD_TYPE_IDS, splitList, goodsKey, goodsLabel };
