// 검색 브라우저 안의 모든 페이지에 들어가는 스크립트.
// 이미지 위에 마우스를 올리면 '케이크에 꽂기' 버튼을 띄우고, 누르면 호스트로 이미지 정보를 보낸다.
const { ipcRenderer } = require('electron');

const MIN_SIZE = 56;
let host, btn, current, hideTimer, raf;

function ensure() {
  if (host && host.isConnected) return;
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0 auto auto 0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>
    button{position:fixed;display:none;pointer-events:auto;cursor:pointer;
      font:700 13px/1 "Malgun Gothic","Apple SD Gothic Neo",sans-serif;letter-spacing:-.2px;
      padding:9px 13px 9px 11px;border:2px solid #fff;border-radius:999px;
      background:#D93A64;color:#fff;box-shadow:0 3px 10px rgba(60,10,30,.35);
      display:none;align-items:center;gap:6px;white-space:nowrap}
    button:hover{background:#B82A51}
    button.done{background:#2F8F5B}
    svg{width:14px;height:14px}
  </style><button type="button"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 1v8M5 6l3 3 3-3"/><path d="M2 11h12l-1.5 4h-9z" fill="currentColor" stroke="none"/></svg><span>케이크에 꽂기</span></button>`;
  btn = root.querySelector('button');
  btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); }, true);
  btn.addEventListener('click', onClick, true);
  btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  (document.body || document.documentElement).appendChild(host);
}

function findImageAt(x, y) {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el === host) return 'button';
    if (el.tagName === 'IMG') {
      const r = el.getBoundingClientRect();
      if (r.width >= MIN_SIZE && r.height >= MIN_SIZE) return el;
    }
  }
  return null;
}

function show(img) {
  current = img;
  const r = img.getBoundingClientRect();
  btn.querySelector('span').textContent = '케이크에 꽂기';
  btn.classList.remove('done');
  btn.style.display = 'inline-flex';
  const bw = btn.offsetWidth;
  btn.style.left = Math.max(4, Math.min(window.innerWidth - bw - 4, r.right - bw - 8)) + 'px';
  btn.style.top = Math.max(4, r.top + 8) + 'px';
}

function hideSoon() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (btn) btn.style.display = 'none'; current = null; }, 250);
}

document.addEventListener('mousemove', (e) => {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    ensure();
    const hit = findImageAt(e.clientX, e.clientY);
    if (hit === 'button') return clearTimeout(hideTimer);
    if (hit) { clearTimeout(hideTimer); if (hit !== current || btn.style.display === 'none') show(hit); }
    else if (current) hideSoon();
  });
}, { capture: true, passive: true });

window.addEventListener('scroll', () => { if (btn) btn.style.display = 'none'; current = null; }, true);

function bestSrc(img) {
  if (img.srcset) {
    let best = null, bestW = 0;
    for (const part of img.srcset.split(',')) {
      const [u, d] = part.trim().split(/\s+/);
      const w = parseFloat(d) || 1;
      if (u && w > bestW) { best = u; bestW = w; }
    }
    if (best) return new URL(best, location.href).href;
  }
  return img.currentSrc || img.src;
}

function onClick(e) {
  e.preventDefault();
  e.stopPropagation();
  if (!current) return;
  const img = current;
  const r = img.getBoundingClientRect();
  const rect = {
    x: Math.max(0, Math.round(r.left)),
    y: Math.max(0, Math.round(r.top)),
    width: Math.round(Math.min(r.right, window.innerWidth) - Math.max(0, r.left)),
    height: Math.round(Math.min(r.bottom, window.innerHeight) - Math.max(0, r.top)),
  };
  const payload = {
    url: bestSrc(img),
    rect,
    tiny: img.naturalWidth < 40,
    pageUrl: location.href,
    alt: (img.alt || '').slice(0, 60),
  };
  // 캡처 대비 버튼을 먼저 숨기고 다음 프레임에 전송
  btn.style.display = 'none';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ipcRenderer.sendToHost('grab', payload);
    btn.querySelector('span').textContent = '꽂았어요';
    btn.classList.add('done');
    btn.style.display = 'inline-flex';
    hideSoon();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { btn.style.display = 'none'; current = null; }, 900);
  }));
}
