// 케이크 캔버스 + 검색 브라우저 연결
const W = 900, H = 1000, RES = 2;
const CAKE = { cx: 450, topY: 610, rx: 340, ry: 112, bodyH: 175 };
const PLATE = { cy: CAKE.topY + CAKE.bodyH + 24, rx: 425, ry: 142 };
const BORDER = 8;
const TAG_COLORS = ['#D93A64', '#2F7FC1', '#2F8F5B', '#C9771C', '#7A4FC4', '#C23B9A', '#1E8C8C', '#8A5A2B'];

const ENGINES = {
  google: (q) => `https://www.google.com/search?tbm=isch&hl=ko&q=${encodeURIComponent(q)}`,
  naver: (q) => `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(q)}`,
  pinterest: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
  namu: (q) => `https://namu.wiki/Search?q=${encodeURIComponent(q)}`,
};
const HOMES = {
  google: 'https://www.google.com/imghp?hl=ko',
  naver: 'https://search.naver.com/search.naver?where=image',
  pinterest: 'https://www.pinterest.com/',
  namu: 'https://namu.wiki/',
};

const $ = (id) => document.getElementById(id);
const canvas = $('cake');
const ctx = canvas.getContext('2d');
const web = $('web');
const SMOKE = new URLSearchParams(location.search).has('smoke');

const state = { title: '', who: '', showNames: true, engine: 'google', stickers: [] };
let selected = null;
let drag = null;
let dirty = true;
const imgCache = new Map();    // id -> HTMLImageElement
const cutCache = new Map();    // key -> 누끼 테두리 캔버스

// ---------- 유틸 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutBack = (t) => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function hash(str) { let h = 0; for (const ch of str) h = (h * 31 + ch.codePointAt(0)) | 0; return Math.abs(h); }
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }

let toastTimer;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 3600 : 1800);
}

// ---------- 저장 ----------
let saveTimer;
function save() {
  if (SMOKE) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.cake.saveState({
      title: state.title, who: state.who, showNames: state.showNames, engine: state.engine,
      stickers: state.stickers.map(({ born, ...s }) => s),
    });
  }, 500);
}

// ---------- 그리기: 배경 / 접시 / 케이크 ----------
function drawBackdrop(c) {
  const wall = c.createLinearGradient(0, 0, 0, 640);
  wall.addColorStop(0, '#FBE3E8');
  wall.addColorStop(1, '#FDEEEF');
  c.fillStyle = wall;
  c.fillRect(0, 0, W, H);

  // 벽에 걸린 가랜드
  c.save();
  c.strokeStyle = 'rgba(140, 70, 90, 0.35)';
  c.lineWidth = 1.5;
  c.beginPath(); c.moveTo(-10, 30); c.quadraticCurveTo(W / 2, 110, W + 10, 30); c.stroke();
  const flags = ['#F2A9BC', '#FFE29A', '#A9D8F2', '#BDE6C3', '#D9C2F2'];
  for (let i = 0; i < 13; i++) {
    const t = (i + 0.5) / 13, x = t * W, y = 30 + 4 * t * (1 - t) * 80 * 0.98;
    c.fillStyle = flags[i % flags.length];
    c.beginPath(); c.moveTo(x - 20, y); c.lineTo(x + 20, y); c.lineTo(x, y + 38); c.closePath(); c.fill();
  }
  c.restore();

  // 체크무늬 식탁보
  const tableY = 700;
  c.fillStyle = '#FFF9F6';
  c.fillRect(0, tableY, W, H - tableY);
  c.fillStyle = 'rgba(226, 92, 128, 0.16)';
  for (let x = 0; x < W; x += 60) c.fillRect(x, tableY, 30, H - tableY);
  for (let y = tableY; y < H; y += 44) c.fillRect(0, y, W, 22);
  const shade = c.createLinearGradient(0, tableY, 0, tableY + 40);
  shade.addColorStop(0, 'rgba(120, 40, 60, 0.18)');
  shade.addColorStop(1, 'rgba(120, 40, 60, 0)');
  c.fillStyle = shade;
  c.fillRect(0, tableY, W, 40);
}

function drawPlate(c) {
  const { cx } = CAKE, { cy, rx, ry } = PLATE;
  c.save();
  c.fillStyle = 'rgba(80, 20, 40, 0.18)';
  c.beginPath(); c.ellipse(cx, cy + 16, rx + 6, ry + 4, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#E9E3E6';
  c.beginPath(); c.ellipse(cx, cy + 8, rx, ry, 0, 0, Math.PI * 2); c.fill();
  const g = c.createRadialGradient(cx - 80, cy - 40, 40, cx, cy, rx);
  g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#F1ECEE');
  c.fillStyle = g;
  c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(160, 120, 135, 0.35)';
  c.lineWidth = 2;
  c.beginPath(); c.ellipse(cx, cy, rx - 26, ry - 10, 0, 0, Math.PI * 2); c.stroke();
  c.restore();
}

function drawCake(c) {
  const { cx, topY, rx, ry, bodyH } = CAKE;
  const botY = topY + bodyH;

  // 옆면
  c.save();
  c.beginPath();
  c.moveTo(cx + rx, topY);
  c.lineTo(cx + rx, botY);
  c.ellipse(cx, botY, rx, ry, 0, 0, Math.PI);
  c.lineTo(cx - rx, topY);
  c.closePath();
  const side = c.createLinearGradient(cx - rx, 0, cx + rx, 0);
  side.addColorStop(0, '#E9A3B5');
  side.addColorStop(0.35, '#F8C6D3');
  side.addColorStop(0.7, '#F4B4C5');
  side.addColorStop(1, '#D98DA2');
  c.fillStyle = side;
  c.fill();
  c.clip();
  // 옆면 가로 크림 라인
  c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  c.lineWidth = 7;
  c.beginPath(); c.ellipse(cx, topY + bodyH * 0.58, rx, ry, 0, 0, Math.PI); c.stroke();
  c.restore();

  // 딸기 소스 드립
  const r = mulberry(7);
  const drips = Array.from({ length: 22 }, () => ({ t: r() * Math.PI, len: 30 + r() * 70, w: 0.05 + r() * 0.07 }));
  c.save();
  c.beginPath();
  const N = 160;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI;
    c.lineTo(cx + rx * Math.cos(t), topY + ry * Math.sin(t) - 2);
  }
  for (let i = N; i >= 0; i--) {
    const t = (i / N) * Math.PI;
    let d = 16 + 5 * Math.sin(t * 13);
    for (const dr of drips) {
      const k = (t - dr.t) / dr.w;
      d += dr.len * Math.exp(-k * k * 2.2);
    }
    d *= 0.35 + 0.65 * Math.sin(t);
    c.lineTo(cx + rx * Math.cos(t), topY + ry * Math.sin(t) + d);
  }
  c.closePath();
  const sauce = c.createLinearGradient(0, topY, 0, topY + ry + 90);
  sauce.addColorStop(0, '#C9264F');
  sauce.addColorStop(1, '#E2466F');
  c.fillStyle = sauce;
  c.fill();
  c.restore();

  // 아래쪽 크림 짜기
  c.save();
  for (let i = 0; i <= 26; i++) {
    const t = (i / 26) * Math.PI;
    const x = cx + rx * Math.cos(t), y = botY + ry * Math.sin(t) - 4;
    const g = c.createRadialGradient(x - 4, y - 5, 2, x, y, 17);
    g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#F3E3E2');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, 15, 0, Math.PI * 2); c.fill();
  }
  c.restore();

  // 윗면
  c.save();
  const top = c.createRadialGradient(cx - 90, topY - 40, 30, cx, topY, rx);
  top.addColorStop(0, '#FFFFFF');
  top.addColorStop(1, '#FBEDEA');
  c.fillStyle = top;
  c.beginPath(); c.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2); c.fill();
  // 윗면 테두리 소스
  c.strokeStyle = '#D23560';
  c.lineWidth = 6;
  c.beginPath(); c.ellipse(cx, topY, rx - 2, ry - 2, 0, 0, Math.PI * 2); c.stroke();
  // 스프링클
  const sr = mulberry(42);
  const cols = ['#F7C948', '#5BC0EB', '#9BC53D', '#FF8FAB', '#B388EB', '#FFFFFF'];
  for (let i = 0; i < 120; i++) {
    const a = sr() * Math.PI * 2, rr = Math.sqrt(sr()) * 0.9;
    const x = cx + Math.cos(a) * rr * rx, y = topY + Math.sin(a) * rr * ry;
    c.save();
    c.translate(x, y);
    c.rotate(sr() * Math.PI);
    c.fillStyle = cols[i % cols.length];
    roundRect(c, -6, -2, 12, 4, 2);
    c.fill();
    c.restore();
  }
  c.restore();
}

function drawTitle(c) {
  const text = state.title.trim() || '우리들의 가능 케이크';
  c.save();
  c.font = '400 40px Jua, "Malgun Gothic", sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const w = Math.min(W - 80, c.measureText(text).width + 70);
  const y = 960;
  c.fillStyle = '#B82A51';
  c.beginPath();
  c.moveTo(W / 2 - w / 2 - 26, y - 22); c.lineTo(W / 2 - w / 2, y - 26); c.lineTo(W / 2 - w / 2, y + 22); c.lineTo(W / 2 - w / 2 - 26, y + 26); c.lineTo(W / 2 - w / 2 - 12, y + 2); c.closePath();
  c.moveTo(W / 2 + w / 2 + 26, y - 22); c.lineTo(W / 2 + w / 2, y - 26); c.lineTo(W / 2 + w / 2, y + 22); c.lineTo(W / 2 + w / 2 + 26, y + 26); c.lineTo(W / 2 + w / 2 + 12, y + 2); c.closePath();
  c.fill();
  c.fillStyle = '#D93A64';
  roundRect(c, W / 2 - w / 2, y - 30, w, 58, 6);
  c.fill();
  c.fillStyle = '#FFFFFF';
  c.fillText(text, W / 2, y + 1, w - 30);
  c.restore();
}

// ---------- 스티커 ----------
function dims(s) {
  if (s.shape === 'circle') return { w: s.size, h: s.size };
  const ar = clamp(s.ar, 0.55, 1.7);
  return { w: s.size, h: s.size * ar };
}

function dropOffset(s, now) {
  if (!s.born) return 0;
  const p = clamp((now - s.born) / 520, 0, 1);
  if (p >= 1) { s.born = 0; return 0; }
  dirty = true;
  return 420 * (1 - easeOutBack(p));
}

function geom(s, now) {
  const d = dropOffset(s, now);
  const { w, h } = dims(s);
  const base = { x: s.bx, y: s.by - d };
  const top = { x: s.bx + s.lean, y: s.by - s.len - d };
  const center = { x: top.x, y: top.y - h / 2 + 14 };
  return { base, top, center, w, h, landed: d < 4 };
}

function drawCover(c, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s, sh = h / s;
  c.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function cutoutCanvas(s, img, w, h) {
  const key = `${s.id}:${Math.round(w)}:${Math.round(h)}`;
  if (cutCache.has(key)) return cutCache.get(key);
  const pad = BORDER + 2;
  const cw = Math.ceil((w + pad * 2) * RES), ch = Math.ceil((h + pad * 2) * RES);
  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  const o = out.getContext('2d');
  const fit = Math.min(w / img.width, h / img.height);
  const iw = img.width * fit * RES, ih = img.height * fit * RES;
  const ix = (cw - iw) / 2, iy = (ch - ih) / 2;
  // 흰 테두리: 실루엣을 둥글게 여러 방향으로 찍기
  const sil = document.createElement('canvas');
  sil.width = cw; sil.height = ch;
  const sc = sil.getContext('2d');
  sc.drawImage(img, ix, iy, iw, ih);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = '#fff';
  sc.fillRect(0, 0, cw, ch);
  const br = BORDER * RES;
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    o.drawImage(sil, Math.cos(t) * br, Math.sin(t) * br);
  }
  o.drawImage(img, ix, iy, iw, ih);
  const entry = { canvas: out, pad };
  cutCache.set(key, entry);
  return entry;
}

function drawStick(c, base, top) {
  const dx = top.x - base.x, dy = top.y - base.y;
  const len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  const wb = 3.2, wt = 4.6;
  c.save();
  c.shadowColor = 'rgba(60, 20, 30, 0.25)';
  c.shadowBlur = 4;
  c.shadowOffsetX = 2;
  c.beginPath();
  c.moveTo(base.x + nx * wb, base.y + ny * wb);
  c.lineTo(top.x + nx * wt, top.y + ny * wt);
  c.lineTo(top.x - nx * wt, top.y - ny * wt);
  c.lineTo(base.x - nx * wb, base.y - ny * wb);
  c.closePath();
  const g = c.createLinearGradient(base.x - 5, 0, base.x + 5, 0);
  g.addColorStop(0, '#C4955C'); g.addColorStop(0.45, '#E8C795'); g.addColorStop(1, '#B98950');
  c.fillStyle = g;
  c.fill();
  c.restore();
}

function drawNameTag(c, s, base, top) {
  const name = (s.who || '').trim();
  if (!state.showNames || !name) return;
  const x = base.x + (top.x - base.x) * 0.42, y = base.y + (top.y - base.y) * 0.42;
  c.save();
  c.font = '400 19px Jua, "Malgun Gothic", sans-serif';
  c.textBaseline = 'middle';
  const tw = c.measureText(name).width;
  const w = tw + 20, h = 28;
  c.fillStyle = TAG_COLORS[hash(name) % TAG_COLORS.length];
  c.shadowColor = 'rgba(60, 20, 30, 0.25)';
  c.shadowBlur = 5; c.shadowOffsetY = 2;
  c.beginPath();
  c.moveTo(x, y - h / 2);
  c.lineTo(x + w, y - h / 2);
  c.lineTo(x + w - 7, y);
  c.lineTo(x + w, y + h / 2);
  c.lineTo(x, y + h / 2);
  c.closePath();
  c.fill();
  c.shadowColor = 'transparent';
  c.fillStyle = '#fff';
  c.fillText(name, x + 8, y + 1);
  c.restore();
}

function drawSticker(c, s, now) {
  const img = imgCache.get(s.id);
  if (!img) return;
  const g = geom(s, now);
  const { base, top, center, w, h } = g;

  if (g.landed) {
    c.save();
    c.fillStyle = 'rgba(120, 40, 60, 0.28)';
    c.beginPath(); c.ellipse(base.x, base.y, 9, 3.5, 0, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  drawStick(c, base, top);
  drawNameTag(c, s, base, top);

  c.save();
  c.translate(center.x, center.y);
  c.rotate(s.rot);
  if (s.shape === 'cutout') {
    const { canvas: cut, pad } = cutoutCanvas(s, img, w, h);
    c.shadowColor = 'rgba(60, 20, 30, 0.35)';
    c.shadowBlur = 10; c.shadowOffsetY = 4;
    c.drawImage(cut, -w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2);
  } else if (s.shape === 'circle') {
    const r = w / 2;
    c.shadowColor = 'rgba(60, 20, 30, 0.35)';
    c.shadowBlur = 10; c.shadowOffsetY = 4;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(0, 0, r + BORDER, 0, Math.PI * 2); c.fill();
    c.shadowColor = 'transparent';
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
    drawCover(c, img, -r, -r, w, w);
  } else {
    c.shadowColor = 'rgba(60, 20, 30, 0.35)';
    c.shadowBlur = 10; c.shadowOffsetY = 4;
    c.fillStyle = '#fff';
    roundRect(c, -w / 2 - BORDER, -h / 2 - BORDER, w + BORDER * 2, h + BORDER * 2, 8);
    c.fill();
    c.shadowColor = 'transparent';
    roundRect(c, -w / 2, -h / 2, w, h, 4);
    c.clip();
    drawCover(c, img, -w / 2, -h / 2, w, h);
  }
  c.restore();
}

function drawSelection(c, s, now) {
  const { center, w, h } = geom(s, now);
  c.save();
  c.translate(center.x, center.y);
  c.rotate(s.rot);
  c.setLineDash([8, 6]);
  c.lineWidth = 3;
  c.strokeStyle = '#D93A64';
  const p = BORDER + 7;
  if (s.shape === 'circle') { c.beginPath(); c.arc(0, 0, w / 2 + p, 0, Math.PI * 2); c.stroke(); }
  else { roundRect(c, -w / 2 - p, -h / 2 - p, w + p * 2, h + p * 2, 12); c.stroke(); }
  c.restore();
}

function render(c, { exporting = false } = {}) {
  const now = performance.now();
  c.save();
  c.setTransform(RES, 0, 0, RES, 0, 0);
  drawBackdrop(c);
  drawPlate(c);
  drawCake(c);
  const order = [...state.stickers].sort((a, b) => a.by - b.by);
  for (const s of order) drawSticker(c, s, now);
  drawTitle(c);
  if (!exporting && selected && state.stickers.includes(selected)) drawSelection(c, selected, now);
  c.restore();
}

function loop() {
  if (dirty) { dirty = false; render(ctx); }
  requestAnimationFrame(loop);
}

// ---------- 배치 ----------
function onTop(x, y, k = 0.86) {
  const u = (x - CAKE.cx) / CAKE.rx, v = (y - CAKE.topY) / CAKE.ry;
  const r = Math.hypot(u, v);
  if (r <= k) return { x, y };
  return { x: CAKE.cx + (u / r) * k * CAKE.rx, y: CAKE.topY + (v / r) * k * CAKE.ry };
}

function pickBase() {
  const others = state.stickers;
  if (!others.length) return { x: CAKE.cx + rand(-30, 30), y: CAKE.topY + rand(-10, 10) };
  let best = null, bestScore = -1;
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.84;
    const x = CAKE.cx + Math.cos(a) * r * CAKE.rx, y = CAKE.topY + Math.sin(a) * r * CAKE.ry;
    let score = Infinity;
    for (const o of others) score = Math.min(score, Math.hypot(x - o.bx, (y - o.by) * 2.4));
    score -= r * 40; // 가장자리보다 가운데 쪽을 조금 선호
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

function lenFor(y) {
  const depth = 1 - (y - (CAKE.topY - CAKE.ry)) / (CAKE.ry * 2); // 뒤쪽일수록 1
  return Math.round(170 + depth * 120 + rand(-20, 30));
}

async function normalize(dataUrl) {
  const img = await loadImg(dataUrl);
  if (img.width < 40 || img.height < 40) throw new Error('too small');
  const max = 640, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const o = c.getContext('2d');
  o.drawImage(img, 0, 0, c.width, c.height);
  let hasAlpha = false;
  try {
    const d = o.getImageData(0, 0, c.width, c.height).data;
    const pts = [[1, 1], [c.width - 2, 1], [1, c.height - 2], [c.width - 2, c.height - 2], [c.width >> 1, 1]];
    hasAlpha = pts.some(([x, y]) => d[(y * c.width + x) * 4 + 3] < 200);
  } catch { /* tainted */ }
  return { src: c.toDataURL('image/webp', 0.92), ar: c.height / c.width, hasAlpha };
}

async function addSticker(norm, who) {
  const b = pickBase();
  const n = state.stickers.length;
  const s = {
    id: Math.random().toString(36).slice(2, 10),
    src: norm.src,
    ar: norm.ar,
    bx: b.x, by: b.y,
    len: lenFor(b.y),
    lean: rand(-16, 16),
    size: n > 14 ? 115 : n > 7 ? 135 : 155,
    rot: rand(-0.12, 0.12),
    shape: norm.hasAlpha ? 'cutout' : 'card',
    who: (who || '').trim(),
    born: performance.now(),
  };
  imgCache.set(s.id, await loadImg(s.src));
  state.stickers.push(s);
  select(s);
  refresh();
  return s;
}

// ---------- 가져오기 ----------
async function grab({ url, rect, tiny, pageUrl }) {
  const who = state.who;
  toast('가져오는 중…');
  let norm = null;
  if (url && !tiny && !url.startsWith('blob:')) {
    try { norm = await normalize(await window.cake.fetchImage(url, pageUrl)); } catch { /* 아래에서 화면 캡처로 재시도 */ }
  }
  if (!norm && rect && rect.width > 20 && rect.height > 20) {
    try { norm = await normalize((await web.capturePage(rect)).toDataURL()); } catch { /* 실패 */ }
  }
  if (!norm) {
    toast('이 이미지는 못 가져왔어요. 이미지를 눌러 크게 연 다음 다시 꽂아보세요.', true);
    return;
  }
  await addSticker(norm, who);
  toast(who ? `${who}의 가능, 꽂았어요` : '꽂았어요');
}

// ---------- 캔버스 조작 ----------
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

function hitTest(p) {
  const now = performance.now();
  const order = [...state.stickers].sort((a, b) => b.by - a.by); // 앞쪽 먼저
  for (const s of order) {
    const { center, w, h, base, top } = geom(s, now);
    const dx = p.x - center.x, dy = p.y - center.y;
    const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    const pad = BORDER + 4;
    if (s.shape === 'circle' ? Math.hypot(lx, ly) <= w / 2 + pad : Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= h / 2 + pad) return s;
    // 막대
    const sx = top.x - base.x, sy = top.y - base.y;
    const t = clamp(((p.x - base.x) * sx + (p.y - base.y) * sy) / (sx * sx + sy * sy), 0, 1);
    if (Math.hypot(p.x - (base.x + sx * t), p.y - (base.y + sy * t)) < 9) return s;
  }
  return null;
}

canvas.addEventListener('pointerdown', (e) => {
  const p = toLogical(e);
  const s = hitTest(p);
  select(s);
  if (s) {
    drag = { s, dx: s.bx - p.x, dy: s.by - p.y, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = toLogical(e);
  if (drag) {
    const q = onTop(p.x + drag.dx, p.y + drag.dy);
    drag.s.bx = q.x; drag.s.by = q.y;
    dirty = true;
  } else {
    canvas.style.cursor = hitTest(p) ? 'grab' : 'default';
  }
});
const endDrag = () => { if (drag) { drag = null; canvas.style.cursor = 'grab'; save(); } };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  const s = hitTest(toLogical(e)) || selected;
  if (!s) return;
  e.preventDefault();
  s.size = clamp(s.size * (e.deltaY < 0 ? 1.07 : 1 / 1.07), 70, 320);
  select(s);
  dirty = true;
  save();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) return;
  if (selected && (e.key === 'Delete' || e.key === 'Backspace')) removeSelected();
  if (e.key === 'Escape') select(null);
});

// ---------- 선택 패널 ----------
function select(s) {
  selected = s;
  $('sel').hidden = !s;
  if (s) {
    $('selSize').value = s.size;
    $('selLen').value = s.len;
    $('selWho').value = s.who || '';
    for (const b of $('selShape').children) b.classList.toggle('on', b.dataset.shape === s.shape);
  }
  dirty = true;
}

function removeSelected() {
  if (!selected) return;
  state.stickers = state.stickers.filter((s) => s !== selected);
  imgCache.delete(selected.id);
  select(null);
  refresh();
}

$('selSize').addEventListener('input', (e) => { if (selected) { selected.size = +e.target.value; dirty = true; save(); } });
$('selLen').addEventListener('input', (e) => { if (selected) { selected.len = +e.target.value; dirty = true; save(); } });
$('selWho').addEventListener('input', (e) => { if (selected) { selected.who = e.target.value; dirty = true; save(); } });
$('selShape').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !selected) return;
  selected.shape = b.dataset.shape;
  select(selected);
  save();
});
$('selDel').addEventListener('click', removeSelected);

// ---------- 상단/하단 ----------
function refresh() {
  $('count').textContent = `${state.stickers.length}개`;
  $('empty').hidden = state.stickers.length > 0;
  dirty = true;
  save();
}

$('title').addEventListener('input', (e) => { state.title = e.target.value; dirty = true; save(); });
$('who').addEventListener('input', (e) => { state.who = e.target.value; save(); });
$('showNames').addEventListener('change', (e) => { state.showNames = e.target.checked; dirty = true; save(); });

function exportPng() {
  const c = document.createElement('canvas');
  c.width = W * RES; c.height = H * RES;
  render(c.getContext('2d'), { exporting: true });
  return c.toDataURL('image/png');
}

$('save').addEventListener('click', async () => {
  const path = await window.cake.savePng(exportPng(), state.title.trim() || '가능충 케이크');
  if (path) toast('저장했어요');
});
$('copy').addEventListener('click', async () => {
  await window.cake.copyPng(exportPng());
  toast('복사했어요. 카톡이나 디코에 붙여넣으세요');
});

let clearArm;
$('clearAll').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!state.stickers.length) return;
  if (!b.classList.contains('arm')) {
    b.classList.add('arm');
    b.textContent = '정말 비울까요?';
    clearTimeout(clearArm);
    clearArm = setTimeout(() => { b.classList.remove('arm'); b.textContent = '다 비우기'; }, 3000);
    return;
  }
  clearTimeout(clearArm);
  b.classList.remove('arm');
  b.textContent = '다 비우기';
  state.stickers = [];
  imgCache.clear();
  cutCache.clear();
  select(null);
  refresh();
});

// ---------- 검색 브라우저 ----------
function setEngine(name) {
  state.engine = name;
  for (const b of $('engines').children) b.classList.toggle('on', b.dataset.engine === name);
  save();
}
$('engines').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setEngine(b.dataset.engine);
  const q = $('q').value.trim();
  web.loadURL(q ? ENGINES[state.engine](q) : HOMES[state.engine]);
});
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (q) web.loadURL(ENGINES[state.engine](q));
});
$('back').addEventListener('click', () => web.canGoBack() && web.goBack());
$('fwd').addEventListener('click', () => web.canGoForward() && web.goForward());
$('reload').addEventListener('click', () => web.reload());

web.addEventListener('ipc-message', (e) => { if (e.channel === 'grab') grab(e.args[0]); });
window.cake.onGrab((d) => grab(d));

// ---------- 캔버스 크기 맞추기 ----------
function fit() {
  const st = $('stage');
  const k = Math.min(st.clientWidth / W, st.clientHeight / H);
  canvas.style.width = `${Math.floor(W * k)}px`;
  canvas.style.height = `${Math.floor(H * k)}px`;
}
new ResizeObserver(fit).observe($('stage'));
canvas.width = W * RES;
canvas.height = H * RES;

// ---------- 시작 ----------
async function demoStickers() {
  const names = [['고든 램지', '#E0B07A'], ['ChatGPT', '#74AA9C'], ['친구네 아빠', '#9DB4E0'], ['그 악역', '#B07AC9'], ['펭수', '#7FC8E8'], ['동네 고양이', '#E8A87F']];
  const whos = ['민지', '도윤', '서연', '하준', '민지', '도윤'];
  for (let i = 0; i < names.length; i++) {
    const c = document.createElement('canvas');
    c.width = 300; c.height = i % 2 ? 360 : 300;
    const o = c.getContext('2d');
    const g = o.createLinearGradient(0, 0, 300, c.height);
    g.addColorStop(0, names[i][1]); g.addColorStop(1, '#ffffff');
    o.fillStyle = g; o.fillRect(0, 0, 300, c.height);
    o.fillStyle = '#3A1E29'; o.font = '400 40px Jua'; o.textAlign = 'center'; o.fillText(names[i][0], 150, c.height / 2 + 14);
    const s = await addSticker({ src: c.toDataURL('image/png'), ar: c.height / 300, hasAlpha: false }, whos[i]);
    s.born = 0;
    if (i === 3) s.shape = 'circle';
  }
}

(async () => {
  await document.fonts.ready.catch(() => {});
  const saved = SMOKE ? null : await window.cake.loadState();
  if (saved) {
    Object.assign(state, { title: saved.title || '', who: saved.who || '', showNames: saved.showNames !== false, engine: saved.engine || 'google' });
    for (const s of saved.stickers || []) {
      try { imgCache.set(s.id, await loadImg(s.src)); state.stickers.push(s); } catch { /* 깨진 항목은 버림 */ }
    }
  }
  $('title').value = state.title;
  $('who').value = state.who;
  $('showNames').checked = state.showNames;
  setEngine(state.engine);
  if (state.engine !== 'google') web.src = HOMES[state.engine];
  if (SMOKE) {
    await demoStickers();
    await grab({ url: 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png', pageUrl: 'https://commons.wikimedia.org/' });
    const last = state.stickers[state.stickers.length - 1];
    console.log('SMOKE stickers', state.stickers.length, 'last shape', last && last.shape);
  }
  select(null);
  refresh();
  fit();
  loop();
})();
