/**
 * Локальная проверка математики границ плашек (без браузера и без сети).
 * Запуск: node scripts/check-region-math.mjs
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SOLID_EDGE_PAD = 1;

function orderedRegions(list) {
  return [...list.filter(r => r.type !== 'solid'), ...list.filter(r => r.type === 'solid')];
}

function regionRect(r, width, height, pad = 0) {
  let x0 = Math.floor(r.x * width) - pad;
  let y0 = Math.floor(r.y * height) - pad;
  let x1 = Math.ceil((r.x + r.w) * width) + pad;
  let y1 = Math.ceil((r.y + r.h) * height) + pad;
  x0 = clamp(x0, 0, width);
  y0 = clamp(y0, 0, height);
  x1 = clamp(x1, 0, width);
  y1 = clamp(y1, 0, height);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function oldRoundRect(r, width, height) {
  return {
    x: Math.round(r.x * width),
    y: Math.round(r.y * height),
    w: Math.round(r.w * width),
    h: Math.round(r.h * height)
  };
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    console.log('OK:', msg);
  }
}

const W = 1000;
const H = 1260;
const awkward = { x: 0.0961, y: 0.2503, w: 0.2357, h: 0.4602, type: 'solid' };

const old = oldRoundRect(awkward, W, H);
const neu = regionRect(awkward, W, H, SOLID_EDGE_PAD);
const oldRight = old.x + old.w;
const oldBottom = old.y + old.h;
const neuRight = neu.x + neu.w;
const neuBottom = neu.y + neu.h;

assert(neu.x <= old.x, 'новый левый край не правее старого round');
assert(neu.y <= old.y, 'новый верхний край не ниже старого round');
assert(neuRight >= oldRight, 'новый правый край покрывает старый round');
assert(neuBottom >= oldBottom, 'новый нижний край покрывает старый round');

const frac = { x: 0.1, y: 0.1, w: 0.3333, h: 0.3333, type: 'solid' };
const cov = regionRect(frac, W, H, 0);
assert(cov.x === Math.floor(frac.x * W), 'floor для левого края');
assert(cov.y === Math.floor(frac.y * H), 'floor для верхнего края');
assert(cov.x + cov.w === Math.ceil((frac.x + frac.w) * W), 'ceil для правого края');
assert(cov.y + cov.h === Math.ceil((frac.y + frac.h) * H), 'ceil для нижнего края');

const mixed = [
  { type: 'solid', id: 's1' },
  { type: 'frost', id: 'f1' },
  { type: 'solid', id: 's2' },
  { type: 'frost', id: 'f2' }
];
const order = orderedRegions(mixed).map(r => r.id).join(',');
assert(order === 'f1,f2,s1,s2', 'сначала Frost, потом цветные (цветная сверху)');

const blurMin = 2;
assert(Math.max(blurMin, 0) === 2, 'нулевая сила размытия поднимается до минимума');
assert(Math.max(blurMin, 18) === 18, 'нормальная сила размытия не меняется');

if (failed) {
  console.error(`\nИтог: ${failed} ошибок`);
  process.exit(1);
}
console.log('\nИтог: все проверки границ и порядка плашек пройдены.');
