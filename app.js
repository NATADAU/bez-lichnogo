'use strict';
/**
 * «Без личного» — локальная обработка сканов.
 * PDF.js 6.x подключается только из ./vendor/ (без CDN).
 */
const $ = id => document.getElementById(id);
const display = $('display');
const ctx = display.getContext('2d');
const src = document.createElement('canvas');
const sctx = src.getContext('2d', { willReadFrequently: true });
const layer = $('editlayer');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/** Минимальная сила Frost (исключаем нулевое «размытие»). */
const BLUR_MIN = 2;
/** Запас пикселей у цветной плашки, чтобы закрыть щели от округления. */
const SOLID_EDGE_PAD = 1;

let generatedURL = null;
let regionsByPage = {};
let selected = -1;
let mode = 'frost';
let color = '#f7f7f4';
let blur = 18;
let original = false;
let picker = false;
let pdf = null;
let pages = 1;
let pdfPage = 1;
let sourceMode = 'demo';
let operation = null;
let loading = false;
let fileBase = 'document';
let pdfjsModule = null;

const dirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const regions = () => regionsByPage[pdfPage] || (regionsByPage[pdfPage] = []);

function busy(t) {
  loading = !!t;
  $('loading').classList.toggle('visible', loading);
  if (t) $('loadingText').textContent = t;
}
function status(t) { $('status').textContent = t || ''; }
function renderResize() { display.width = src.width; display.height = src.height; }
function pageControls() {
  $('pageInfo').textContent = `${pdfPage} из ${pages}`;
  $('prev').disabled = pdfPage === 1;
  $('next').disabled = pdfPage === pages;
}

/** Сначала Frost, затем цветные — цветная плашка всегда перекрывает размытие. */
function orderedRegions(list) {
  return [...list.filter(r => r.type !== 'solid'), ...list.filter(r => r.type === 'solid')];
}

/**
 * Пиксельный прямоугольник области.
 * floor/ceil вместо round — без дыр на границах; pad — только для непрозрачных плашек.
 */
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

function effectiveBlurPx(canvasWidth) {
  return Math.max(BLUR_MIN, blur) * canvasWidth / 1000;
}

function setMode(next) {
  if (picker) stopPicker();
  mode = next;
  $('frostMode').classList.toggle('active', mode === 'frost');
  $('solidMode').classList.toggle('active', mode === 'solid');
  $('frostControls').classList.toggle('hidden', mode !== 'frost');
  $('solidControls').classList.toggle('hidden', mode !== 'solid');
  if (selected >= 0 && regions()[selected]) {
    regions()[selected].type = mode;
    if (mode === 'solid') regions()[selected].color = color;
  }
  paint();
}

function setColor(c) {
  color = c;
  $('color').value = color;
  $('hex').textContent = color.toUpperCase();
  if (selected >= 0 && regions()[selected] && regions()[selected].type === 'solid') {
    regions()[selected].color = color;
    paint();
  }
}

function updateSelection() {
  const r = regions()[selected];
  if (r) {
    mode = r.type || 'frost';
    if (r.color) color = r.color;
    $('color').value = color;
    $('hex').textContent = color.toUpperCase();
  }
  $('frostMode').classList.toggle('active', mode === 'frost');
  $('solidMode').classList.toggle('active', mode === 'solid');
  $('frostControls').classList.toggle('hidden', mode !== 'frost');
  $('solidControls').classList.toggle('hidden', mode !== 'solid');
}

function paint() {
  if (!src.width) return;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, display.width, display.height);
  ctx.drawImage(src, 0, 0);
  if (!original) {
    for (const r of orderedRegions(regions())) {
      const pad = r.type === 'solid' ? SOLID_EDGE_PAD : 0;
      const { x, y, w, h } = regionRect(r, display.width, display.height, pad);
      if (w <= 0 || h <= 0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      if (r.type === 'solid') {
        ctx.fillStyle = r.color || color;
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.filter = `blur(${effectiveBlurPx(display.width)}px)`;
        ctx.drawImage(src, 0, 0);
        ctx.filter = 'none';
      }
      ctx.restore();
    }
  }
  renderRegions();
}

function renderRegions() {
  layer.replaceChildren();
  if (original) return;
  regions().forEach((r, i) => {
    const el = document.createElement('div');
    el.className = 'region' + (i === selected ? ' selected' : '');
    el.dataset.index = i;
    el.style.left = (r.x * 100) + '%';
    el.style.top = (r.y * 100) + '%';
    el.style.width = (r.w * 100) + '%';
    el.style.height = (r.h * 100) + '%';
    if (i === selected) {
      dirs.forEach(d => {
        const h = document.createElement('span');
        h.className = 'handle';
        h.dataset.dir = d;
        el.append(h);
      });
    }
    layer.append(el);
  });
}

function pos(e) {
  const b = layer.getBoundingClientRect();
  return {
    x: clamp((e.clientX - b.left) / b.width, 0, 1),
    y: clamp((e.clientY - b.top) / b.height, 0, 1)
  };
}

function start(e) {
  if (original || loading) return;
  if (picker) { pickColor(e); return; }
  e.preventDefault();
  const p = pos(e);
  const el = e.target.closest('.region');
  if (el) {
    selected = +el.dataset.index;
    updateSelection();
    operation = {
      kind: e.target.dataset.dir || 'move',
      p,
      initial: { ...regions()[selected] },
      index: selected
    };
  } else {
    selected = regions().length;
    regions().push({ x: p.x, y: p.y, w: 0.001, h: 0.001, type: mode, color });
    operation = { kind: 'draw', p, index: selected };
  }
  layer.setPointerCapture(e.pointerId);
  paint();
}

function move(e) {
  if (!operation) return;
  const p = pos(e);
  const o = operation;
  const r = regions()[o.index];
  if (!r) return;
  const dx = p.x - o.p.x;
  const dy = p.y - o.p.y;
  const min = 0.006;
  if (o.kind === 'draw') {
    r.x = Math.min(o.p.x, p.x);
    r.y = Math.min(o.p.y, p.y);
    r.w = Math.abs(p.x - o.p.x);
    r.h = Math.abs(p.y - o.p.y);
  } else if (o.kind === 'move') {
    r.x = clamp(o.initial.x + dx, 0, 1 - r.w);
    r.y = clamp(o.initial.y + dy, 0, 1 - r.h);
  } else {
    let l = o.initial.x;
    let t = o.initial.y;
    let rr = l + o.initial.w;
    let bb = t + o.initial.h;
    const d = o.kind;
    if (d.includes('w')) l = clamp(l + dx, 0, rr - min);
    if (d.includes('e')) rr = clamp(rr + dx, l + min, 1);
    if (d.includes('n')) t = clamp(t + dy, 0, bb - min);
    if (d.includes('s')) bb = clamp(bb + dy, t + min, 1);
    r.x = l;
    r.y = t;
    r.w = rr - l;
    r.h = bb - t;
  }
  paint();
}

function end() {
  if (!operation) return;
  if (operation.kind === 'draw') {
    const r = regions()[operation.index];
    if (r && (r.w < 0.008 || r.h < 0.008)) regions().splice(operation.index, 1);
  }
  operation = null;
  selected = Math.min(selected, regions().length - 1);
  updateSelection();
  paint();
}

function sampledColor(e) {
  const p = pos(e);
  const x = Math.round(p.x * (src.width - 1));
  const y = Math.round(p.y * (src.height - 1));
  const rad = 4;
  const x0 = Math.max(0, x - rad);
  const y0 = Math.max(0, y - rad);
  const w = Math.min(src.width - x0, 2 * rad + 1);
  const h = Math.min(src.height - y0, 2 * rad + 1);
  const data = sctx.getImageData(x0, y0, w, h).data;
  const c = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    for (let j = 0; j < 3; j++) c[j] += data[i + j];
    n++;
  }
  return n ? '#' + c.map(v => Math.round(v / n).toString(16).padStart(2, '0')).join('') : '#ffffff';
}

function stopPicker() {
  picker = false;
  $('paper').classList.remove('picking');
  $('pipette').classList.remove('active');
  $('pipette').textContent = '◉ Пипетка';
  $('pickerPreview').classList.remove('visible');
  $('pickerHint').classList.remove('picking');
}

function togglePicker() {
  if (picker) { stopPicker(); status('Пипетка выключена.'); return; }
  if (original) {
    original = false;
    $('original').textContent = 'Показать оригинал: выкл.';
    paint();
  }
  if (mode !== 'solid') setMode('solid');
  picker = true;
  $('paper').classList.add('picking');
  $('pipette').classList.add('active');
  $('pipette').textContent = '✓ Выбери цвет на листе';
  $('pickerHint').classList.add('picking');
  status('Пипетка включена. Наведи курсор на чистый участок бумаги и щёлкни один раз.');
}

function previewPicker(e) {
  if (!picker || !src.width) return;
  const b = layer.getBoundingClientRect();
  if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) {
    $('pickerPreview').classList.remove('visible');
    return;
  }
  const c = sampledColor(e);
  const pop = $('pickerPreview');
  $('pickerSample').style.backgroundColor = c;
  $('pickerHex').textContent = c.toUpperCase();
  const x = e.clientX + 22;
  const y = e.clientY + 22;
  pop.style.left = Math.min(x, window.innerWidth - 185) + 'px';
  pop.style.top = Math.min(y, window.innerHeight - 74) + 'px';
  pop.classList.add('visible');
}

function pickColor(e) {
  e.preventDefault();
  e.stopPropagation();
  const chosen = sampledColor(e);
  setColor(chosen);
  stopPicker();
  status('✓ Цвет ' + chosen.toUpperCase() + ' выбран и применён к плашке. Можно продолжать работу.');
}

function scribble(x, y, seed) {
  sctx.save();
  sctx.beginPath();
  sctx.moveTo(x, y);
  for (let j = 0; j < 10; j++) {
    const dx = j * 9;
    const dy = Math.sin(j * 1.9 + seed) * 5 + Math.sin(j * 3 + seed) * 2;
    sctx.lineTo(x + dx, y + dy);
  }
  sctx.strokeStyle = '#577da5';
  sctx.lineWidth = 2;
  sctx.stroke();
  sctx.restore();
}

async function closePdf() {
  const doc = pdf;
  // Сразу обнуляем ссылку, чтобы параллельный destroy не ломал UI и листание.
  pdf = null;
  if (!doc) return;
  try {
    await doc.loadingTask.destroy();
  } catch (_) { /* уже закрыт */ }
}

function demo() {
  stopPicker();
  resetDownload();
  void closePdf();
  sourceMode = 'demo';
  pages = 1;
  pdfPage = 1;
  fileBase = 'primer';
  $('filename').textContent = 'Демонстрационная ведомость';
  src.width = 1000;
  src.height = 1260;
  sctx.fillStyle = '#fdfdfb';
  sctx.fillRect(0, 0, 1000, 1260);
  sctx.fillStyle = '#283c42';
  sctx.textAlign = 'center';
  sctx.font = 'bold 28px Georgia';
  sctx.fillText('ЛИСТ РЕГИСТРАЦИИ УЧАСТНИКОВ', 500, 116);
  sctx.font = '19px Georgia';
  sctx.fillText('Пример учебного документа · вымышленные данные', 500, 156);
  sctx.textAlign = 'left';
  sctx.fillStyle = '#3b4750';
  sctx.font = '20px Georgia';
  ['Тема: Семинар по педагогике', 'Место: Учебный центр', 'Дата: 21.11.2026'].forEach((t, i) => sctx.fillText(t, 72, 208 + i * 37));
  const xs = [60, 96, 332, 549, 756, 904, 949];
  const y0 = 315;
  const rh = 68;
  const headers = ['№', 'Фамилия, имя', 'Место работы и должность', 'Электронная почта', 'Телефон', 'Подпись'];
  sctx.strokeStyle = '#6c7675';
  sctx.lineWidth = 1.5;
  xs.forEach(x => {
    sctx.beginPath();
    sctx.moveTo(x, y0);
    sctx.lineTo(x, y0 + rh * 11);
    sctx.stroke();
  });
  for (let j = 0; j <= 11; j++) {
    sctx.beginPath();
    sctx.moveTo(xs[0], y0 + j * rh);
    sctx.lineTo(xs[xs.length - 1], y0 + j * rh);
    sctx.stroke();
  }
  sctx.textAlign = 'center';
  sctx.fillStyle = '#37454c';
  sctx.font = 'bold 15px Georgia';
  headers.forEach((t, i) => {
    const xx = (xs[i] + xs[i + 1]) / 2;
    const lines = t === 'Место работы и должность'
      ? ['Место работы', 'и должность']
      : t === 'Электронная почта'
        ? ['Электронная', 'почта']
        : [t];
    lines.forEach((line, k) => sctx.fillText(line, xx, 345 + k * 19));
  });
  const names = ['Иванова Елена', 'Петров Максим', 'Соколова Анна', 'Орлов Андрей', 'Миронова Софья', 'Белов Артём', 'Захарова Мария', 'Никитин Павел', 'Ким Ольга', 'Фёдоров Игорь'];
  const job = ['Учитель', 'Методист', 'Психолог', 'Логопед', 'Педагог', 'Тьютор', 'Дефектолог', 'Координатор', 'Методист', 'Психолог'];
  const mails = ['ivanova', 'petrov', 'sokolova', 'orlov', 'mironova', 'belov', 'zakharova', 'nikitin', 'kim', 'fedorov'];
  sctx.font = '16px Georgia';
  sctx.textAlign = 'left';
  for (let i = 0; i < 10; i++) {
    const yy = y0 + rh * (i + 1) + 39;
    sctx.fillText(String(i + 1), 68, yy);
    sctx.fillText(names[i], 104, yy);
    sctx.fillText(job[i], 342, yy);
    sctx.fillText(mails[i] + '@test.ru', 557, yy);
    sctx.fillText('+7 (900) 123-' + String(10 + i).padStart(2, '0') + '-45', 762, yy);
    scribble(909, yy - 8, i);
  }
  for (let i = 0; i < 850; i++) {
    const x = (i * 179.7) % 1000;
    const y = (i * 233.9) % 1260;
    sctx.fillStyle = 'rgba(80,93,97,.07)';
    sctx.fillRect(x, y, 1, 1);
  }
  renderResize();
  regionsByPage = {
    1: [
      { x: 0.096, y: 0.25, w: 0.235, h: 0.46, type: 'frost', color: '#ffffff' },
      { x: 0.405, y: 0.25, w: 0.215, h: 0.46, type: 'frost', color: '#ffffff' },
      { x: 0.76, y: 0.25, w: 0.135, h: 0.46, type: 'frost', color: '#ffffff' }
    ]
  };
  selected = 0;
  pageControls();
  updateSelection();
  paint();
  status('Готов демонстрационный документ.');
}

async function pdfJs() {
  if (pdfjsModule) return pdfjsModule;
  try {
    // PDF.js 6: только ES-модули (.mjs), локально из vendor/.
    const mod = await import('./vendor/pdf.min.mjs');
    mod.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
    pdfjsModule = mod;
    return mod;
  } catch (err) {
    console.error(err);
    throw new Error('Не найдена локальная PDF-библиотека (vendor/pdf.min.mjs). См. README.');
  }
}

async function showPage(n) {
  if (!pdf || n < 1 || n > pages) return;
  busy('Открываю страницу…');
  try {
    const page = await pdf.getPage(n);
    const v = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1600 / v.width, 2200 / v.height);
    const vp = page.getViewport({ scale });
    src.width = Math.round(vp.width);
    src.height = Math.round(vp.height);
    // PDF.js 5+/6: предпочтителен параметр canvas (canvasContext устарел).
    await page.render({ canvas: src, viewport: vp }).promise;
    pdfPage = n;
    renderResize();
    selected = -1;
    pageControls();
    updateSelection();
    paint();
    status('Страница открыта.');
  } catch (e) {
    status('Ошибка: ' + e.message);
  } finally {
    busy(null);
  }
}

$('upload').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024) {
    status('Файл слишком большой: максимум 25 МБ.');
    e.target.value = '';
    return;
  }
  stopPicker();
  resetDownload();
  busy('Открываю файл…');
  try {
    fileBase = file.name.replace(/\.[^.]+$/, '') || 'document';
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const lib = await pdfJs();
      await closePdf();
      // isEvalSupported удалён в PDF.js 5+/6: eval отключён в движке.
      const loadingTask = lib.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        enableXfa: false,
        disableFontFace: false
      });
      pdf = await loadingTask.promise;
      pages = pdf.numPages;
      if (pages > 10) {
        await closePdf();
        throw new Error('Для этой версии максимум 10 страниц PDF.');
      }
      pdfPage = 1;
      sourceMode = 'pdf';
      regionsByPage = {};
      busy(null);
      await showPage(1);
    } else {
      if (!/^image\/(png|jpeg|webp)$/i.test(file.type) && !/\.(png|jpe?g|webp)$/i.test(file.name)) {
        throw new Error('Поддерживаются PDF, PNG, JPG и WebP.');
      }
      await closePdf();
      const url = URL.createObjectURL(file);
      const img = new Image();
      try {
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = url;
        });
        src.width = img.naturalWidth;
        src.height = img.naturalHeight;
        sctx.drawImage(img, 0, 0);
      } finally {
        URL.revokeObjectURL(url);
      }
      sourceMode = 'image';
      pages = 1;
      pdfPage = 1;
      regionsByPage = { 1: [] };
      selected = -1;
      renderResize();
      pageControls();
      paint();
    }
    $('filename').textContent = file.name;
    status('Файл открыт.');
  } catch (err) {
    console.error(err);
    status('Не удалось открыть: ' + err.message);
  } finally {
    busy(null);
    e.target.value = '';
  }
});

function resetDownload() {
  if (generatedURL) {
    URL.revokeObjectURL(generatedURL);
    generatedURL = null;
  }
  const a = $('downloadReady');
  a.removeAttribute('href');
  $('retryArea').classList.add('hidden');
  $('retryLink').removeAttribute('href');
}

function jpegData(canvas) {
  const data = canvas.toDataURL('image/jpeg', 0.94).split(',')[1];
  const binary = atob(data);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) result[i] = binary.charCodeAt(i);
  return result;
}

function buildPDF(images) {
  // PDF 1.4: только растровые JPEG, без исходных объектов/текста/аннотаций.
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [0];
  let byteCount = 0;
  function write(v) {
    const b = typeof v === 'string' ? enc.encode(v) : v;
    chunks.push(b);
    byteCount += b.length;
  }
  function obj(id, body) {
    offsets[id] = byteCount;
    write(`${id} 0 obj\n`);
    write(body);
    write('\nendobj\n');
  }
  write('%PDF-1.4\n%\xC2\xA5\xC2\xB1\n');
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [ ${kids} ] /Count ${images.length} >>`);
  for (let i = 0; i < images.length; i++) {
    const { jpg, w, h } = images[i];
    const page = 3 + i * 3;
    const img = page + 1;
    const contents = page + 2;
    const k = Math.min(595.28 / w, 841.89 / h);
    const W = +((w * k).toFixed(3));
    const H = +((h * k).toFixed(3));
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${contents} 0 R >>`);
    offsets[img] = byteCount;
    write(`${img} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`);
    write(jpg);
    write('\nendstream\nendobj\n');
    const commands = `q\n${W} 0 0 ${H} 0 0 cm\n/Im0 Do\nQ\n`;
    obj(contents, `<< /Length ${enc.encode(commands).length} >>\nstream\n${commands}endstream`);
  }
  const xref = byteCount;
  write(`xref\n0 ${images.length * 3 + 3}\n0000000000 65535 f \n`);
  for (let i = 1; i < images.length * 3 + 3; i++) {
    write(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  write(`trailer\n<< /Size ${images.length * 3 + 3} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

function drawProcessed(dest, source, rs) {
  dest.width = source.width;
  dest.height = source.height;
  const c = dest.getContext('2d');
  c.filter = 'none';
  c.drawImage(source, 0, 0);
  for (const r of orderedRegions(rs)) {
    const pad = r.type === 'solid' ? SOLID_EDGE_PAD : 0;
    const { x, y, w, h } = regionRect(r, dest.width, dest.height, pad);
    if (w <= 0 || h <= 0) continue;
    c.save();
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    if (r.type === 'solid') {
      c.fillStyle = r.color || '#ffffff';
      c.fillRect(x, y, w, h);
    } else {
      c.filter = `blur(${effectiveBlurPx(dest.width)}px)`;
      c.drawImage(source, 0, 0);
      c.filter = 'none';
    }
    c.restore();
  }
}

async function save() {
  if (loading) return;
  const anyFrost = Object.values(regionsByPage).some(arr => arr.some(r => r.type === 'frost'));
  if (anyFrost && !confirm('ВНИМАНИЕ: Frost-размытие не гарантирует обезличивания. Такой PDF нельзя считать безопасным для передачи третьим лицам. Сохранить визуальный вариант?')) return;
  resetDownload();
  busy('Подготавливаю PDF…');
  try {
    const images = [];
    for (let i = 1; i <= pages; i++) {
      busy(`Сохраняю страницу ${i} из ${pages}…`);
      let pageSource = src;
      if (sourceMode === 'pdf') {
        const p = await pdf.getPage(i);
        const v = p.getViewport({ scale: 1 });
        const scale = Math.min(2, 1600 / v.width, 2200 / v.height);
        const vp = p.getViewport({ scale });
        pageSource = document.createElement('canvas');
        pageSource.width = Math.round(vp.width);
        pageSource.height = Math.round(vp.height);
        await p.render({ canvas: pageSource, viewport: vp }).promise;
      }
      const target = document.createElement('canvas');
      drawProcessed(target, pageSource, regionsByPage[i] || []);
      images.push({ jpg: jpegData(target), w: target.width, h: target.height });
    }
    const blob = buildPDF(images);
    generatedURL = URL.createObjectURL(blob);
    const a = $('downloadReady');
    a.href = generatedURL;
    a.download = fileBase + '_обработано.pdf';
    $('retryLink').href = generatedURL;
    $('retryLink').download = a.download;
    a.click();
    $('retryArea').classList.remove('hidden');
    status(
      'PDF создан (' + (blob.size / 1024 / 1024).toFixed(1) + ' МБ), скачивание запущено. ' +
      (anyFrost
        ? 'Frost остаётся визуальным размытием, не безопасным удалением данных.'
        : 'Цветные плашки заменили исходные пиксели.')
    );
  } catch (e) {
    console.error(e);
    status('Ошибка сохранения: ' + e.message);
  } finally {
    busy(null);
  }
}

layer.addEventListener('pointerdown', start);
layer.addEventListener('pointermove', move);
layer.addEventListener('pointerup', end);
layer.addEventListener('pointercancel', end);
$('frostMode').addEventListener('click', () => setMode('frost'));
$('solidMode').addEventListener('click', () => setMode('solid'));
$('blur').addEventListener('input', e => {
  blur = Math.max(BLUR_MIN, +e.target.value);
  e.target.value = String(blur);
  $('blurValue').textContent = blur + ' px';
  paint();
});
$('color').addEventListener('input', e => setColor(e.target.value));
$('pipette').addEventListener('click', togglePicker);
layer.addEventListener('pointermove', previewPicker);
layer.addEventListener('pointerleave', () => { $('pickerPreview').classList.remove('visible'); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && picker) {
    stopPicker();
    status('Пипетка отменена.');
  }
});
$('add').addEventListener('click', () => {
  regions().push({ x: 0.20, y: 0.25, w: 0.19, h: 0.17, type: mode, color });
  selected = regions().length - 1;
  updateSelection();
  paint();
});
$('remove').addEventListener('click', () => {
  if (selected >= 0) {
    regions().splice(selected, 1);
    selected = Math.min(regions().length - 1, selected);
    updateSelection();
    paint();
  }
});
$('copy').addEventListener('click', () => {
  if (pages < 2) {
    status('В файле только одна страница.');
    return;
  }
  if (!confirm('Заменить области на всех остальных страницах выделениями с текущей страницы?')) return;
  const sample = regions().map(r => ({ ...r }));
  for (let i = 1; i <= pages; i++) {
    if (i !== pdfPage) regionsByPage[i] = sample.map(r => ({ ...r }));
  }
  status('Области скопированы на остальные страницы.');
});
$('original').addEventListener('click', () => {
  if (picker) stopPicker();
  original = !original;
  $('original').textContent = 'Показать оригинал: ' + (original ? 'вкл.' : 'выкл.');
  paint();
});
$('prev').addEventListener('click', () => {
  if (!pdf) { status('Сначала откройте PDF.'); return; }
  showPage(pdfPage - 1);
});
$('next').addEventListener('click', () => {
  if (!pdf) { status('Сначала откройте PDF.'); return; }
  showPage(pdfPage + 1);
});
$('save').addEventListener('click', save);
$('demo').addEventListener('click', () => { demo(); });
window.addEventListener('keydown', e => {
  const tag = document.activeElement?.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) {
    e.preventDefault();
    regions().splice(selected, 1);
    selected = Math.min(selected, regions().length - 1);
    paint();
    return;
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) || selected < 0) return;
  e.preventDefault();
  const r = regions()[selected];
  const step = e.shiftKey ? 10 : 1;
  const dx = (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0) / display.width;
  const dy = (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0) / display.height;
  r.x = clamp(r.x + dx, 0, 1 - r.w);
  r.y = clamp(r.y + dy, 0, 1 - r.h);
  paint();
});

demo();

// Тестовый API только при ?testapi=1 (для автопроверок; обычные пользователи не затронуты).
if (new URLSearchParams(location.search).get('testapi') === '1') {
  window.__BEZ__ = {
    setMode,
    setColor,
    demo,
    save,
    showPage: (n) => showPage(n),
    getPdfLoaded: () => !!pdf,
    getPages: () => pages,
    getPage: () => pdfPage,
    getMode: () => mode,
    getBlur: () => blur,
    getRegions: () => JSON.parse(JSON.stringify(regionsByPage)),
    setRegions: (map) => { regionsByPage = map; paint(); },
    paint,
    displayCanvas: () => display,
    sourceCanvas: () => src
  };
}
