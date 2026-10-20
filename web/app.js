// 가능충 케이크: 캔버스 케이크 + 이미지 받기(끌어놓기/붙여넣기/주소/북마클릿) + 방 코드 멀티
const W = 900, H = 1000, RES = 2;
const CAKE = { cx: 450, topY: 610, rx: 340, ry: 112, bodyH: 175 };
const PLATE = { cy: CAKE.topY + CAKE.bodyH + 24, rx: 425, ry: 142 };
const BORDER = 8;
const TAG_COLORS = ['#D93A64', '#2F7FC1', '#2F8F5B', '#C9771C', '#7A4FC4', '#C23B9A', '#1E8C8C', '#8A5A2B'];
const PROXY = (u) => `https://wsrv.nl/?url=${encodeURIComponent(u)}&w=640&h=640&fit=inside&we&output=webp`;
// 중계 서버(Cloudflare Worker, worker/). 비어 있으면 '바로 검색'을 숨기고 wsrv.nl만 쓴다.
const WORKER_DEFAULT = 'https://ganung-cake.jmc0511.workers.dev';
const viaWorker = (u) => `${WORKER_URL}/img?url=${encodeURIComponent(u)}`;

const ENGINES = {
  google: (q) => `https://www.google.com/search?tbm=isch&hl=ko&q=${encodeURIComponent(q)}`,
  naver: (q) => `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(q)}`,
  pinterest: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`,
  namu: (q) => `https://namu.wiki/Search?q=${encodeURIComponent(q)}`,
};

const $ = (id) => document.getElementById(id);
const canvas = $('cake');
const ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
const SMOKE = params.get('smoke');
const WORKER_URL = (SMOKE && params.get('worker')) || WORKER_DEFAULT;

const state = { title: '', who: '', showNames: true, engine: 'google', stickers: [] };
let selected = null;
let drag = null;
let dirty = true;
let soloBackup = null;      // 남의 방에 들어갈 때 내 케이크를 잠시 보관
const imgCache = new Map();
const cutCache = new Map();

// ---------- 유틸 ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutBack = (t) => { const c = 1.5; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
function hash(str) { let h = 0; for (const ch of str) h = (h * 31 + ch.codePointAt(0)) | 0; return Math.abs(h); }
const colorFor = (name) => TAG_COLORS[hash(name) % TAG_COLORS.length];
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function loadImg(src, cors = false) {
  return new Promise((res, rej) => {
    const i = new Image();
    if (cors) i.crossOrigin = 'anonymous';
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('load failed'));
    i.src = src;
  });
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  if (c.roundRect) return c.roundRect(x, y, w, h, r);
  // iOS 15 이하 사파리용
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const coarse = matchMedia('(pointer: coarse)');
const syncTouch = () => document.documentElement.classList.toggle('touch', coarse.matches);
syncTouch();
coarse.addEventListener?.('change', syncTouch);
const serial = ({ born, ...s }) => s;

let toastTimer;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 4000 : 2000);
}

// ---------- 저장 (IndexedDB, 실패해도 동작) ----------
const store = {
  db: null,
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open('ganung-cake', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result ?? null); q.onerror = () => res(null); });
    } catch { return null; }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      db.transaction('kv', 'readwrite').objectStore('kv').put(v, k);
    } catch { /* 저장 불가 환경 */ }
  },
};

let saveTimer;
function save() {
  if (SMOKE || Net.role === 'guest') return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    store.set('cake', { title: state.title, showNames: state.showNames, engine: state.engine, engineChosen: true, stickers: state.stickers.map(serial) });
  }, 500);
}
function savePrefs() { if (!SMOKE) store.set('who', state.who); }

// ---------- 그리기 ----------
function drawBackdrop(c) {
  const wall = c.createLinearGradient(0, 0, 0, 640);
  wall.addColorStop(0, '#FBE3E8');
  wall.addColorStop(1, '#FDEEEF');
  c.fillStyle = wall;
  c.fillRect(0, 0, W, H);

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
  c.strokeStyle = 'rgba(255, 255, 255, 0.55)';
  c.lineWidth = 7;
  c.beginPath(); c.ellipse(cx, topY + bodyH * 0.58, rx, ry, 0, 0, Math.PI); c.stroke();
  c.restore();

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
    for (const dr of drips) { const k = (t - dr.t) / dr.w; d += dr.len * Math.exp(-k * k * 2.2); }
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

  c.save();
  const top = c.createRadialGradient(cx - 90, topY - 40, 30, cx, topY, rx);
  top.addColorStop(0, '#FFFFFF');
  top.addColorStop(1, '#FBEDEA');
  c.fillStyle = top;
  c.beginPath(); c.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#D23560';
  c.lineWidth = 6;
  c.beginPath(); c.ellipse(cx, topY, rx - 2, ry - 2, 0, 0, Math.PI * 2); c.stroke();
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
  const y = 960, l = W / 2 - w / 2, r = W / 2 + w / 2;
  c.fillStyle = '#B82A51';
  c.beginPath();
  c.moveTo(l - 26, y - 22); c.lineTo(l, y - 26); c.lineTo(l, y + 22); c.lineTo(l - 26, y + 26); c.lineTo(l - 12, y + 2); c.closePath();
  c.moveTo(r + 26, y - 22); c.lineTo(r, y - 26); c.lineTo(r, y + 22); c.lineTo(r + 26, y + 26); c.lineTo(r + 12, y + 2); c.closePath();
  c.fill();
  c.fillStyle = '#D93A64';
  roundRect(c, l, y - 30, w, 58, 6);
  c.fill();
  c.fillStyle = '#FFFFFF';
  c.fillText(text, W / 2, y + 1, w - 30);
  c.restore();
}

function dims(s) {
  if (s.shape === 'circle') return { w: s.size, h: s.size };
  return { w: s.size, h: s.size * clamp(s.ar, 0.55, 1.7) };
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
  const w = c.measureText(name).width + 20, h = 28;
  c.fillStyle = colorFor(name);
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
  c.shadowColor = 'rgba(60, 20, 30, 0.35)';
  c.shadowBlur = 10; c.shadowOffsetY = 4;
  if (s.shape === 'cutout') {
    const { canvas: cut, pad } = cutoutCanvas(s, img, w, h);
    c.drawImage(cut, -w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2);
  } else if (s.shape === 'circle') {
    const r = w / 2;
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(0, 0, r + BORDER, 0, Math.PI * 2); c.fill();
    c.shadowColor = 'transparent';
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.clip();
    drawCover(c, img, -r, -r, w, w);
  } else {
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
  for (const s of [...state.stickers].sort((a, b) => a.by - b.by)) drawSticker(c, s, now);
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
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 80; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.84;
    const x = CAKE.cx + Math.cos(a) * r * CAKE.rx, y = CAKE.topY + Math.sin(a) * r * CAKE.ry;
    let score = Infinity;
    for (const o of others) score = Math.min(score, Math.hypot(x - o.bx, (y - o.by) * 2.4));
    score -= r * 40;
    if (score > bestScore) { bestScore = score; best = { x, y }; }
  }
  return best;
}

function lenFor(y) {
  const depth = 1 - (y - (CAKE.topY - CAKE.ry)) / (CAKE.ry * 2);
  return Math.round(170 + depth * 120 + rand(-20, 30));
}

// ---------- 이미지 받기 ----------
async function normalize(img) {
  if (img.width < 40 || img.height < 40) throw new Error('too small');
  const max = 640, k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const o = c.getContext('2d');
  o.drawImage(img, 0, 0, c.width, c.height);
  const d = o.getImageData(0, 0, c.width, c.height).data; // CORS가 없으면 여기서 실패
  const pts = [[1, 1], [c.width - 2, 1], [1, c.height - 2], [c.width - 2, c.height - 2], [c.width >> 1, 1]];
  const hasAlpha = pts.some(([x, y]) => d[(y * c.width + x) * 4 + 3] < 200);
  let src = c.toDataURL('image/webp', 0.9);
  if (!src.startsWith('data:image/webp') && !hasAlpha) src = c.toDataURL('image/jpeg', 0.9);
  return { src, ar: c.height / c.width, hasAlpha };
}

async function fromUrl(url) {
  url = url.trim();
  if (/^data:image\//.test(url)) return normalize(await loadImg(url));
  if (!/^https?:\/\//i.test(url)) throw new Error('not url');
  if (WORKER_URL) { try { return await normalize(await loadImg(viaWorker(url), true)); } catch { /* 다음 방법 */ } }
  try { return await normalize(await loadImg(PROXY(url), true)); } catch { /* 프록시 실패 시 직접 */ }
  return normalize(await loadImg(url, true));
}

async function fromBlob(blob) {
  const u = URL.createObjectURL(blob);
  try { return await normalize(await loadImg(u)); } finally { URL.revokeObjectURL(u); }
}

let busy = 0;
async function ingest(job) {
  busy++;
  toast('가져오는 중…');
  try {
    const norm = await job();
    addSticker(norm);
    const who = state.who.trim();
    toast(who ? `${who}의 가능, 꽂았어요` : '꽂았어요');
  } catch {
    toast('이 이미지는 못 가져왔어요. 이미지를 크게 연 다음 다시 끌어오거나, 이미지 복사 후 Ctrl+V 해보세요.', true);
  } finally {
    busy--;
  }
}

function imageUrlFromHtml(html) {
  const m = html && html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

function handleTransfer(dt) {
  const files = [...(dt.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { for (const f of files) ingest(() => fromBlob(f)); return true; }
  for (const item of dt.items || []) {
    if (item.kind === 'file' && item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) { ingest(() => fromBlob(f)); return true; } }
  }
  const url = imageUrlFromHtml(dt.getData('text/html')) || (dt.getData('text/uri-list') || '').split('\n').find((l) => l && !l.startsWith('#')) || dt.getData('text/plain');
  if (url && /^(https?:|data:image\/)/i.test(url.trim())) { ingest(() => fromUrl(url)); return true; }
  return false;
}

// ---------- 스티커 조작 + 동기화 ----------
async function putSticker(s, animate) {
  if (state.stickers.some((o) => o.id === s.id)) return;
  imgCache.set(s.id, await loadImg(s.src));
  if (state.stickers.some((o) => o.id === s.id)) return;
  s.born = animate ? performance.now() : 0;
  state.stickers.push(s);
  refresh();
}

function addSticker(norm, who = state.who) {
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
  };
  Net.send({ t: 'add', sticker: s });
  if (Net.active) {
    Net.send({ t: 'event', name: Net.name });
    addChat(null, '내가 토퍼를 꽂았어요');
  }
  putSticker({ ...s }, true).then(() => select(state.stickers.find((o) => o.id === s.id)));
  return s;
}

const pending = new Map();
let flushTimer = 0;
function update(s, patch) {
  Object.assign(s, patch);
  dirty = true;
  save();
  if (!Net.active) return;
  pending.set(s.id, { ...(pending.get(s.id) || {}), ...patch });
  if (!flushTimer) flushTimer = setTimeout(() => {
    flushTimer = 0;
    for (const [id, p] of pending) Net.send({ t: 'update', id, patch: p });
    pending.clear();
  }, 70);
}

function removeSticker(id, broadcast = true) {
  state.stickers = state.stickers.filter((s) => s.id !== id);
  imgCache.delete(id);
  if (selected?.id === id) select(null);
  if (broadcast) Net.send({ t: 'remove', id });
  refresh();
}

function clearStickers(broadcast = true) {
  state.stickers = [];
  imgCache.clear();
  cutCache.clear();
  select(null);
  if (broadcast) Net.send({ t: 'clear' });
  refresh();
}

const PATCHABLE = ['bx', 'by', 'len', 'size', 'shape', 'who', 'rot', 'lean'];
function applyOp(op) {
  switch (op.t) {
    case 'add':
      if (op.sticker && typeof op.sticker.src === 'string' && op.sticker.src.startsWith('data:image/')) putSticker({ ...op.sticker }, true);
      break;
    case 'update': {
      const s = state.stickers.find((o) => o.id === op.id);
      if (!s || !op.patch) break;
      for (const k of PATCHABLE) if (k in op.patch) s[k] = op.patch[k];
      if (s === selected) syncSelPanel();
      dirty = true;
      save();
      break;
    }
    case 'remove': removeSticker(op.id, false); break;
    case 'clear': clearStickers(false); break;
    case 'chat': addChat(op.sys && Net.role === 'guest' ? null : op.name, op.text); break;
    case 'event': addChat(null, `${op.name} 님이 토퍼를 꽂았어요`); break;
    case 'title':
      state.title = String(op.title || '').slice(0, 30);
      $('title').value = state.title;
      dirty = true;
      save();
      break;
  }
}

async function loadSnapshot(snap) {
  imgCache.clear();
  cutCache.clear();
  select(null);
  state.stickers = [];
  state.title = String(snap?.title || '');
  $('title').value = state.title;
  for (const s of snap?.stickers || []) {
    try { imgCache.set(s.id, await loadImg(s.src)); state.stickers.push({ ...s, born: 0 }); } catch { /* skip */ }
  }
  refresh();
}

// ---------- 캔버스 입력 ----------
function toLogical(e) {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

function hitTest(p, extra = 0) {
  const now = performance.now();
  for (const s of [...state.stickers].sort((a, b) => b.by - a.by)) {
    const { center, w, h, base, top } = geom(s, now);
    const dx = p.x - center.x, dy = p.y - center.y;
    const cos = Math.cos(-s.rot), sin = Math.sin(-s.rot);
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;
    const pad = BORDER + 4 + extra;
    if (s.shape === 'circle' ? Math.hypot(lx, ly) <= w / 2 + pad : Math.abs(lx) <= w / 2 + pad && Math.abs(ly) <= h / 2 + pad) return s;
    const sx = top.x - base.x, sy = top.y - base.y;
    const t = clamp(((p.x - base.x) * sx + (p.y - base.y) * sy) / (sx * sx + sy * sy), 0, 1);
    if (Math.hypot(p.x - (base.x + sx * t), p.y - (base.y + sy * t)) < 10 + extra * 1.5) return s;
  }
  return null;
}

// 터치: 토퍼를 잡았을 때만 끌고(페이지 스크롤 막음), 빈 곳을 쓸면 페이지가 스크롤된다. 두 손가락으로 크기 조절.
const TOUCH_PAD = 16;
const pointers = new Map();
let pinch = null;
const spread = () => { const [p1, p2] = [...pointers.values()]; return Math.hypot(p1.x - p2.x, p1.y - p2.y); };

canvas.addEventListener('touchstart', (e) => {
  const grab = e.touches.length > 1 ? !!(drag || pinch) : !!hitTest(toLogical(e.touches[0]), TOUCH_PAD);
  if (grab) e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', (e) => { if (drag || pinch) e.preventDefault(); }, { passive: false });

canvas.addEventListener('pointerdown', (e) => {
  const p = toLogical(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2 && drag) {
    pinch = { s: drag.s, d0: Math.max(10, spread()), size0: drag.s.size };
    drag = null;
    canvas.setPointerCapture(e.pointerId);
    return;
  }
  if (pointers.size > 1) return;
  const s = hitTest(p, e.pointerType === 'touch' ? TOUCH_PAD : 0);
  select(s);
  if (s) {
    drag = { s, dx: s.bx - p.x, dy: s.by - p.y };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = toLogical(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (pinch && pointers.size >= 2) {
    update(pinch.s, { size: clamp(pinch.size0 * (spread() / pinch.d0), 70, 320) });
    syncSelPanel();
  } else if (drag) {
    const q = onTop(p.x + drag.dx, p.y + drag.dy);
    update(drag.s, { bx: q.x, by: q.y });
  } else if (e.pointerType === 'mouse') {
    canvas.style.cursor = hitTest(p) ? 'grab' : 'default';
  }
});
const endPointer = (e) => {
  pointers.delete(e.pointerId);
  if (pinch && pointers.size < 2) pinch = null;
  if (drag && !pointers.size) { drag = null; canvas.style.cursor = 'grab'; }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  const s = hitTest(toLogical(e)) || selected;
  if (!s) return;
  e.preventDefault();
  update(s, { size: clamp(s.size * (e.deltaY < 0 ? 1.07 : 1 / 1.07), 70, 320) });
  select(s);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (selected && (e.key === 'Delete' || e.key === 'Backspace')) removeSticker(selected.id);
  if (e.key === 'Escape') select(null);
});

// 끌어다 놓기 (페이지 어디에 놓아도 됨)
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropveil').hidden = false; });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropveil').hidden = true; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('dropveil').hidden = true;
  if (!handleTransfer(e.dataTransfer)) toast('이미지를 찾지 못했어요. 이미지 자체를 끌어와 주세요.', true);
});

// 붙여넣기
window.addEventListener('paste', (e) => {
  const t = e.target;
  if (t.matches?.('input') && t.id !== 'url') return;
  if (handleTransfer(e.clipboardData)) { e.preventDefault(); if (t.id === 'url') t.value = ''; }
});

// ---------- 선택 패널 ----------
function syncSelPanel() {
  if (!selected) return;
  $('selSize').value = selected.size;
  $('selLen').value = selected.len;
  if (document.activeElement !== $('selWho')) $('selWho').value = selected.who || '';
  for (const b of $('selShape').children) b.classList.toggle('on', b.dataset.shape === selected.shape);
}
function select(s) {
  selected = s || null;
  $('sel').hidden = !selected;
  syncSelPanel();
  dirty = true;
}
$('selSize').addEventListener('input', (e) => selected && update(selected, { size: +e.target.value }));
$('selLen').addEventListener('input', (e) => selected && update(selected, { len: +e.target.value }));
$('selWho').addEventListener('input', (e) => selected && update(selected, { who: e.target.value.slice(0, 12) }));
$('selShape').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !selected) return;
  update(selected, { shape: b.dataset.shape });
  syncSelPanel();
});
$('selDel').addEventListener('click', () => selected && removeSticker(selected.id));

// ---------- 패널 ----------
function refresh() {
  $('count').textContent = `${state.stickers.length}개`;
  $('empty').hidden = state.stickers.length > 0;
  dirty = true;
  save();
}

$('title').addEventListener('input', (e) => {
  state.title = e.target.value;
  dirty = true;
  save();
  Net.send({ t: 'title', title: state.title });
});
$('who').addEventListener('input', (e) => { state.who = e.target.value; savePrefs(); });
$('showNames').addEventListener('change', (e) => { state.showNames = e.target.checked; dirty = true; save(); });

function setEngine(name) {
  if (name === 'in' && !WORKER_URL) name = 'google';
  state.engine = name;
  for (const b of $('engines').children) b.classList.toggle('on', b.dataset.engine === name);
  document.querySelector('.add').classList.toggle('inmode', name === 'in');
  $('resultsWrap').hidden = name !== 'in' || !$('results').children.length;
}

// ---------- 바로 검색 (카카오·네이버 이미지, 중계 서버 경유) ----------
const found = { q: '', next: null, busy: false };
async function searchIn(q, more = false) {
  if (found.busy) return;
  if (!more) { found.q = q; found.next = 1; $('results').replaceChildren(); }
  if (!found.next) return;
  found.busy = true;
  $('resultsWrap').hidden = false;
  $('more').hidden = true;
  $('resultsStatus').textContent = more ? '더 불러오는 중…' : `"${q}" 찾는 중…`;
  try {
    const res = await fetch(`${WORKER_URL}/search?q=${encodeURIComponent(found.q)}&start=${found.next}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '검색하지 못했어요');
    for (const it of data.items) $('results').append(resultTile(it));
    found.next = data.next;
    $('resultsStatus').textContent = data.items.length || more
      ? '누르면 바로 케이크에 꽂혀요'
      : `"${found.q}" 결과가 없어요. 다른 말로 찾아보세요.`;
    $('more').hidden = !found.next;
  } catch (e) {
    $('resultsStatus').textContent = `${e.message}. 잠시 뒤 다시 해보세요.`;
    $('more').hidden = !found.next;
  } finally {
    found.busy = false;
  }
}

function resultTile(it) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tile';
  b.title = it.title || '';
  b.setAttribute('aria-label', `${it.title || '이미지'} 꽂기`);
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.alt = '';
  img.src = it.thumb;
  img.onerror = () => { img.onerror = null; img.src = viaWorker(it.thumb); };
  b.append(img);
  b.addEventListener('click', async () => {
    if (b.classList.contains('busy')) return;
    b.classList.add('busy');
    // 원본이 크고 선명하지만 막혀 있는 경우가 많아서, 실패하면 네이버 썸네일로 꽂는다
    await ingest(async () => {
      try { return await normalize(await loadImg(viaWorker(it.link), true)); }
      catch { return normalize(await loadImg(viaWorker(it.thumb), true)); }
    });
    b.classList.remove('busy');
    b.classList.add('used');
  });
  return b;
}
$('more').addEventListener('click', () => searchIn(found.q, true));
// 구글은 COOP 헤더 때문에 한 번 연 창을 이름으로 다시 찾을 수 없다(검색할 때마다 새 창이 생김).
// 그래서 구글 창을 이미 열었으면 새로 열지 않고 검색어만 복사해 그 창에서 붙여넣게 한다.
let googleOpened = false;
let lastQuery = '';
function openSearch(q, forceNew = false) {
  lastQuery = q;
  if (state.engine === 'google' && googleOpened && !forceNew) {
    navigator.clipboard?.writeText(q).catch(() => {});
    $('reuse').hidden = false;
    return;
  }
  $('reuse').hidden = true;
  const w = Math.min(820, Math.round(screen.availWidth * 0.45));
  const h = Math.round(screen.availHeight * 0.9);
  const left = Math.max(0, window.screenX + window.outerWidth - w);
  const win = window.open(ENGINES[state.engine](q), 'ganung-search', `popup,width=${w},height=${h},left=${left},top=${Math.max(0, window.screenY + 40)}`);
  if (!win) return toast('팝업이 막혔어요. 주소창 오른쪽에서 팝업을 허용해 주세요.', true);
  try { win.focus(); } catch { /* 다른 출처 */ }
  if (state.engine === 'google') googleOpened = true;
}
$('reuseNew').addEventListener('click', () => openSearch(lastQuery || $('q').value.trim(), true));
$('engines').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setEngine(b.dataset.engine);
  $('reuse').hidden = true;
  save();
  const q = $('q').value.trim();
  if (q) state.engine === 'in' ? searchIn(q) : openSearch(q);
});
$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q) return $('q').focus();
  if (state.engine === 'in') { $('q').blur(); searchIn(q); } else openSearch(q);
});
$('urlForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const u = $('url').value.trim();
  if (!u) return;
  $('url').value = '';
  ingest(() => fromUrl(u));
});
$('file').addEventListener('change', (e) => {
  for (const f of e.target.files) ingest(() => fromBlob(f));
  e.target.value = '';
});

function exportCanvas() {
  const c = document.createElement('canvas');
  c.width = W * RES; c.height = H * RES;
  render(c.getContext('2d'), { exporting: true });
  return c;
}
// 공유·복사는 사용자 동작 직후에 바로 불러야 해서(사파리) blob을 동기로 만든다
function exportBlob() {
  const bin = atob(exportCanvas().toDataURL('image/png').split(',')[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}
const fileName = () => `${(state.title.trim() || '가능충 케이크').replace(/[\\/:*?"<>|]/g, '')}.png`;

$('save').addEventListener('click', () => {
  const url = URL.createObjectURL(exportBlob());
  const a = document.createElement('a');
  a.download = fileName();
  a.href = url;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
$('copy').addEventListener('click', () => {
  if (!window.ClipboardItem || !navigator.clipboard?.write) return toast('이 브라우저는 이미지 복사를 지원하지 않아요. 저장이나 공유를 써주세요.', true);
  navigator.clipboard.write([new ClipboardItem({ 'image/png': exportBlob() })])
    .then(() => toast('복사했어요. 카톡이나 디코에 붙여넣으세요'))
    .catch(() => toast('이미지 복사가 막혀 있어요. 저장이나 공유를 써주세요.', true));
});
(() => {
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'a.png', { type: 'image/png' });
    $('share').hidden = !(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch { $('share').hidden = true; }
})();
$('share').addEventListener('click', () => {
  const file = new File([exportBlob()], fileName(), { type: 'image/png' });
  navigator.share({ files: [file], title: state.title.trim() || '가능충 케이크' }).catch((e) => {
    if (e?.name !== 'AbortError') toast('공유하지 못했어요. 저장을 써주세요.', true);
  });
});
$('pasteBtn').addEventListener('click', async () => {
  if (!navigator.clipboard?.read) {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (/^https?:/i.test(t)) return ingest(() => fromUrl(t));
    } catch { /* 지원 안 함 또는 거부 */ }
    return toast('이 브라우저는 붙여넣기 버튼을 지원하지 않아요. 이미지를 저장한 뒤 내 기기에서 고르기를 써주세요.', true);
  }
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return ingest(async () => fromBlob(await item.getType(type)));
    }
    for (const item of items) {
      if (item.types.includes('text/plain')) {
        const t = (await (await item.getType('text/plain')).text()).trim();
        if (/^(https?:|data:image\/)/i.test(t)) return ingest(() => fromUrl(t));
      }
    }
    toast('복사한 이미지가 없어요. 이미지를 길게 눌러 복사해 주세요.', true);
  } catch {
    toast('붙여넣기가 허용되지 않았어요. 한 번 더 누르고 허용을 눌러주세요.', true);
  }
});

let clearArm;
$('clearAll').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!state.stickers.length) return;
  if (!b.classList.contains('arm')) {
    b.classList.add('arm');
    b.textContent = Net.active ? '모두의 케이크를 비울까요?' : '정말 비울까요?';
    clearTimeout(clearArm);
    clearArm = setTimeout(() => { b.classList.remove('arm'); b.textContent = '다 비우기'; }, 3000);
    return;
  }
  clearTimeout(clearArm);
  b.classList.remove('arm');
  b.textContent = '다 비우기';
  clearStickers();
});

// 북마클릿 + 중계 채널
$('bmlink').href = 'javascript:' + encodeURIComponent('(' + ganungCakeBookmarklet.toString().replace('__RELAY__', new URL('relay.html', location.href).href) + ')()');
$('bmlink').addEventListener('click', (e) => { e.preventDefault(); toast('이 버튼은 누르지 말고 북마크바로 끌어다 두세요.'); });
// 케이크 탭이 여러 개면 마지막으로 만진 탭 하나만 받는다
const TAB_ID = Math.random().toString(36).slice(2);
const claimTab = () => { try { localStorage.setItem('ganung-active-tab', TAB_ID); } catch { /* 저장 불가 */ } };
const isActiveTab = () => { try { const v = localStorage.getItem('ganung-active-tab'); return !v || v === TAB_ID; } catch { return true; } };
claimTab();
window.addEventListener('focus', claimTab);
document.addEventListener('pointerdown', claimTab, true);
try {
  const ch = new BroadcastChannel('ganung-cake');
  ch.onmessage = (e) => {
    if (e.data?.type !== 'grab' || typeof e.data.url !== 'string' || !isActiveTab()) return;
    ch.postMessage({ type: 'ack' });
    ingest(() => fromUrl(e.data.url));
  };
} catch { /* BroadcastChannel 미지원 */ }

// ---------- 채팅 ----------
function addChat(name, text) {
  text = String(text || '').slice(0, 200);
  if (!text.trim()) return;
  const log = $('chatLog');
  const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  const li = document.createElement('li');
  if (name === null) {
    li.className = 'sys';
    li.textContent = text;
  } else {
    const mine = name === Net.name;
    li.className = mine ? 'msg mine' : 'msg';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = name;
    who.style.background = colorFor(name);
    const body = document.createElement('span');
    body.className = 'bubble';
    body.textContent = text;
    li.append(who, body);
  }
  log.append(li);
  while (log.children.length > 150) log.firstChild.remove();
  if (nearBottom || name === Net.name) log.scrollTop = log.scrollHeight;
}

$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim().slice(0, 200);
  if (!text || !Net.active) return;
  $('chatInput').value = '';
  Net.send({ t: 'chat', name: Net.name, text });
  addChat(Net.name, text);
});

// ---------- 방 ----------
const inviteLink = () => `${location.origin}${location.pathname}?room=${Net.code}`;

function renderPeers(list) {
  const ul = $('peers');
  ul.replaceChildren();
  for (const p of list) {
    const li = document.createElement('li');
    li.textContent = p.host ? `${p.name} (방장)` : p.name;
    li.style.background = colorFor(p.name);
    if (p.name === Net.name) li.classList.add('me');
    ul.append(li);
  }
}

function showRoom() {
  const live = Net.active;
  $('roomSolo').hidden = live;
  $('chat').hidden = !live;
  if (!live) $('chatLog').replaceChildren();
  $('roomLive').hidden = !live;
  if (live) {
    const el = $('roomCodeText');
    el.replaceChildren(...[...Net.code].map((ch) => { const t = document.createElement('span'); t.textContent = ch; return t; }));
    el.setAttribute('aria-label', Net.code);
  }
  $('roomNote').textContent = !live
    ? '방을 만들고 초대 링크를 보내면, 친구가 꽂는 이미지가 모두의 케이크에 바로 꽂혀요.'
    : Net.role === 'host'
      ? '초대 링크를 단톡에 보내세요. 방장이 이 탭을 닫으면 방이 끝나요.'
      : '여기서 꽂는 이미지는 모두의 케이크에 꽂혀요. 내 원래 케이크는 나가면 돌아와요.';
}

function needName() {
  const n = state.who.trim();
  if (n) return n;
  toast('먼저 내 이름을 적어주세요.', true);
  $('who').focus();
  return null;
}

Net.on = {
  op: applyOp,
  snapshot: () => ({ title: state.title, stickers: state.stickers.map(serial) }),
  receiveSnapshot: loadSnapshot,
  peers: renderPeers,
  joined: (name) => { toast(`${name} 님이 들어왔어요`); addChat(null, `${name} 님이 들어왔어요`); Net.send({ t: 'chat', sys: true, text: `${name} 님이 들어왔어요` }); },
  left: (name) => { addChat(null, `${name} 님이 나갔어요`); Net.send({ t: 'chat', sys: true, text: `${name} 님이 나갔어요` }); },
  closed: (msg) => rejoin(msg),
};

// 폰에서 다른 탭에 다녀오면 연결이 끊길 수 있어서, 참가자는 몇 번 자동으로 다시 들어간다
let lastRoom = null;
let rejoining = false;
function visibleAgain() {
  return new Promise((r) => {
    const f = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', f); r(); } };
    document.addEventListener('visibilitychange', f);
  });
}
async function rejoin(msg) {
  if (rejoining || !lastRoom) return;
  rejoining = true;
  showRoom();
  $('roomSolo').hidden = true;
  $('roomNote').textContent = '연결이 끊겨서 다시 들어가는 중이에요…';
  for (let i = 0; i < 8 && lastRoom; i++) {
    await Promise.race([sleep(1500 + i * 1500), visibleAgain()]);
    if (!lastRoom) break;
    try {
      await Net.join(lastRoom.name, lastRoom.code);
      rejoining = false;
      showRoom();
      toast('다시 연결됐어요');
      return;
    } catch { /* 다음 시도 */ }
  }
  rejoining = false;
  if (!lastRoom) return;
  lastRoom = null;
  soloBackup = null;
  showRoom();
  save();
  toast(msg);
}

async function createRoom(name, code) {
  $('roomCreate').disabled = true;
  try {
    // 같은 코드로 다시 열 때는 이전 연결이 정리될 때까지 몇 번 기다린다
    for (let tries = code ? 6 : 1; ; ) {
      try { await Net.create(name, code); break; }
      catch (e) { if (--tries <= 0) throw e; await sleep(2500); }
    }
    try { sessionStorage.setItem('ganung-host', Net.code); } catch { /* 저장 불가 */ }
    showRoom();
    history.replaceState(null, '', `?room=${Net.code}`);
    toast('방을 만들었어요. 초대 링크를 보내세요');
  } catch {
    toast('방을 만들지 못했어요. 잠시 뒤 다시 해보세요.', true);
  } finally {
    $('roomCreate').disabled = false;
  }
}

async function joinRoom(name, code) {
  $('roomJoin').disabled = true;
  toast('방에 들어가는 중…');
  if (!soloBackup) soloBackup = { title: state.title, stickers: state.stickers.map(serial) };
  try {
    await Net.join(name, code);
    lastRoom = { name, code: Net.code };
    showRoom();
    history.replaceState(null, '', `?room=${Net.code}`);
    toast('들어왔어요. 같이 꽂아요');
  } catch (e) {
    soloBackup = null;
    toast(e.message || '방에 들어가지 못했어요.', true);
    history.replaceState(null, '', location.pathname);
  } finally {
    $('roomJoin').disabled = false;
  }
}

$('roomCreate').addEventListener('click', () => { const n = needName(); if (n) createRoom(n); });
$('roomJoin').addEventListener('click', () => {
  const n = needName();
  const code = $('roomCode').value.trim().toUpperCase();
  if (!n) return;
  if (code.length !== 5) { toast('방 코드 다섯 글자를 적어주세요.', true); return $('roomCode').focus(); }
  joinRoom(n, code);
});
$('roomCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('roomJoin').click(); });
$('roomCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(inviteLink()); toast('초대 링크를 복사했어요'); }
  catch { toast(inviteLink()); }
});
$('roomLeave').addEventListener('click', async () => {
  const wasGuest = Net.role === 'guest' || rejoining;
  lastRoom = null;
  try { sessionStorage.removeItem('ganung-host'); } catch { /* 저장 불가 */ }
  Net.leave();
  history.replaceState(null, '', location.pathname);
  showRoom();
  if (wasGuest && soloBackup) await loadSnapshot(soloBackup);
  soloBackup = null;
  toast('방에서 나왔어요');
});

// 초대 링크로 들어온 경우
function askNameThenJoin(code) {
  $('nameModalText').textContent = `케이크 방 ${code}에 초대받았어요. 이름표에 들어갈 이름을 정해주세요.`;
  $('nameInput').value = state.who;
  $('nameModal').hidden = false;
  $('nameInput').focus();
  $('nameForm').onsubmit = (e) => {
    e.preventDefault();
    const n = $('nameInput').value.trim();
    if (!n) return;
    state.who = n;
    $('who').value = n;
    savePrefs();
    $('nameModal').hidden = true;
    joinRoom(n, code);
  };
  $('nameCancel').onclick = () => {
    $('nameModal').hidden = true;
    history.replaceState(null, '', location.pathname);
  };
}

// ---------- 시작 ----------
canvas.width = W * RES;
canvas.height = H * RES;

async function demo(list) {
  for (const [label, color, who, shape] of list) {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 300 + (label.length % 2) * 60;
    const o = c.getContext('2d');
    const g = o.createLinearGradient(0, 0, 300, c.height);
    g.addColorStop(0, color); g.addColorStop(1, '#ffffff');
    o.fillStyle = g; o.fillRect(0, 0, 300, c.height);
    o.fillStyle = '#3A1E29'; o.font = '400 40px Jua'; o.textAlign = 'center'; o.fillText(label, 150, c.height / 2 + 14);
    const s = addSticker({ src: c.toDataURL('image/png'), ar: c.height / 300, hasAlpha: false }, who);
    await new Promise((r) => setTimeout(r, 120));
    const added = state.stickers.find((x) => x.id === s.id);
    if (shape && added) update(added, { shape });
  }
}

async function runSmoke() {
  const code = params.get('code');
  if (SMOKE === 'host') {
    state.who = '민지';
    await demo([['고든 램지', '#E0B07A', '민지'], ['ChatGPT', '#74AA9C', '민지']]);
    await createRoom('민지', code);
    setTimeout(() => { $('chatInput').value = '고든 램지 누가 꽂았어 ㅋㅋ'; $('chatForm').requestSubmit(); }, 12000);
  } else if (SMOKE === 'guest') {
    state.who = '도윤';
    await joinRoom('도윤', code);
    await new Promise((r) => setTimeout(r, 1500));
    await demo([['친구네 아빠', '#9DB4E0', '도윤', 'circle']]);
    await ingest(() => fromUrl('https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png'));
    const first = state.stickers[0];
    if (first) update(first, { size: 230 });
    $('chatInput').value = '친구네 아빠는 진짜 선 넘었다';
    $('chatForm').requestSubmit();
  }
  if (SMOKE === 'search') {
    state.who = '하준';
    $('q').value = params.get('q') || '주사위';
    $('searchForm').requestSubmit();
    await sleep(2500);
    const tiles = [...document.querySelectorAll('.tile')];
    tiles[0]?.click();
    await sleep(300);
    tiles[1]?.click();
    await sleep(4000);
    console.log('SMOKE search engine', state.engine, 'tiles', tiles.length, 'status', $('resultsStatus').textContent, 'stickers', state.stickers.length, 'used', document.querySelectorAll('.tile.used').length);
    return;
  }
  if (SMOKE === 'mobile') {
    state.who = '서연';
    await demo([['고든 램지', '#E0B07A', '서연'], ['펭수', '#7FC8E8', '서연'], ['그 악역', '#B07AC9', '서연', 'circle']]);
    window.__smokeInfo = () => {
      const s = state.stickers[0], r = canvas.getBoundingClientRect(), g = geom(s, performance.now());
      return { id: s.id, cx: r.left + (g.center.x / W) * r.width, cy: r.top + (g.center.y / H) * r.height, size: s.size, bx: s.bx, scrollY, canvasTop: r.top };
    };
    return;
  }
  setTimeout(() => console.log('SMOKE', SMOKE, 'role', Net.role, 'stickers', state.stickers.length, state.stickers.map((s) => `${s.who}:${s.shape}:${Math.round(s.size)}`).join(',')), 6000);
}

(async () => {
  try { await document.fonts.ready; } catch { /* 글꼴 없이 진행 */ }
  let engineChosen = false;
  if (!SMOKE) {
    const saved = await store.get('cake');
    engineChosen = !!saved?.engineChosen;
    state.who = (await store.get('who')) || '';
    if (saved) {
      Object.assign(state, { title: saved.title || '', showNames: saved.showNames !== false, engine: saved.engine || 'google' });
      for (const s of saved.stickers || []) {
        try { imgCache.set(s.id, await loadImg(s.src)); state.stickers.push(s); } catch { /* 깨진 항목은 버림 */ }
      }
    }
  }
  $('title').value = state.title;
  $('who').value = state.who;
  $('showNames').checked = state.showNames;
  if (WORKER_URL) {
    $('engineIn').hidden = false;
    if (!engineChosen) state.engine = 'in';
  }
  setEngine(state.engine);
  select(null);
  refresh();
  loop();
  showRoom();

  if (SMOKE) return runSmoke();
  const room = (params.get('room') || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(room)) return;
  // 방장이 새로고침했거나 폰이 탭을 다시 불러온 경우: 같은 코드로 방을 다시 연다
  let hostCode = null;
  try { hostCode = sessionStorage.getItem('ganung-host'); } catch { /* 저장 불가 */ }
  if (hostCode === room && state.who.trim()) createRoom(state.who.trim(), room);
  else askNameThenJoin(room);
})();
