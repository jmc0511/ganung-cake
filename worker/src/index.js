// 가능충 케이크 중계 서버 (Cloudflare Worker)
//  GET /search?q=검색어&start=1  → 이미지 검색 결과. 카카오(다음) 키가 있으면 카카오, 없으면 네이버 (비밀키는 여기서만 씀)
//  GET /img?url=이미지주소       → 이미지를 대신 받아 CORS 헤더를 붙여 돌려줌 (캔버스로 저장 가능하게)
// 다른 사이트가 네이버 할당량을 쓰지 못하게 허용한 출처에서 온 요청만 받는다.

const ALLOWED = [
  'https://jmc0511.github.io',
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
const PAGE = 30;
const MAX_IMAGE = 15 * 1024 * 1024;

function allowedOrigin(origin) {
  return !!origin && ALLOWED.some((a) => (typeof a === 'string' ? a === origin : a.test(origin)));
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(data, status, origin, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin), ...extra },
  });
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");

async function search(url, env, origin, ctx) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const start = Math.min(1000 - PAGE + 1, Math.max(1, parseInt(url.searchParams.get('start') || '1', 10) || 1));
  if (!q) return json({ error: '검색어가 없어요' }, 400, origin);
  const kakao = !!env.KAKAO_REST_KEY;
  if (!kakao && (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET)) return json({ error: '서버에 검색 키가 없어요' }, 500, origin);

  // 같은 검색은 1시간 동안 캐시해서 할당량을 아낀다
  const cacheKey = new Request(`https://cache.local/search/${kakao ? 'kakao' : 'naver'}?q=${encodeURIComponent(q)}&start=${start}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return json(await hit.json(), 200, origin, { 'x-cache': 'hit' });

  const body = kakao ? await searchKakao(q, start, env) : await searchNaver(q, start, env);
  if (body.error) return json({ error: body.error }, body.status, origin);
  ctx.waitUntil(cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'cache-control': 'public, max-age=3600' } })));
  return json(body, 200, origin);
}

// 카카오: page 1~50, size 최대 80. 여기선 30개씩 잘라 start(1, 31, 61…)를 page로 바꾼다
async function searchKakao(q, start, env) {
  const page = Math.floor((start - 1) / PAGE) + 1;
  if (page > 50) return { total: 0, start, next: null, items: [] };
  const res = await fetch(`https://dapi.kakao.com/v2/search/image?query=${encodeURIComponent(q)}&sort=accuracy&page=${page}&size=${PAGE}`, {
    headers: { Authorization: `KakaoAK ${env.KAKAO_REST_KEY}` },
  });
  if (!res.ok) return { error: res.status === 429 ? '오늘 검색 한도를 다 썼어요' : `카카오 검색 실패 (${res.status})`, status: res.status === 429 ? 429 : 502 };
  const data = await res.json();
  return {
    total: data.meta?.pageable_count || 0,
    start,
    next: data.meta && !data.meta.is_end && page < 50 ? start + PAGE : null,
    items: (data.documents || []).map((it) => ({
      title: stripTags(it.display_sitename || '').slice(0, 80),
      thumb: it.thumbnail_url,
      link: it.image_url,
      w: +it.width || 0,
      h: +it.height || 0,
    })),
  };
}

async function searchNaver(q, start, env) {
  const api = `https://openapi.naver.com/v1/search/image?query=${encodeURIComponent(q)}&display=${PAGE}&start=${start}&sort=sim&filter=all`;
  const res = await fetch(api, {
    headers: { 'X-Naver-Client-Id': env.NAVER_CLIENT_ID, 'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET },
  });
  if (!res.ok) return { error: res.status === 429 ? '오늘 검색 한도를 다 썼어요' : `네이버 검색 실패 (${res.status})`, status: res.status === 429 ? 429 : 502 };
  const data = await res.json();
  return {
    total: Math.min(1000, data.total || 0),
    start,
    next: start + PAGE <= Math.min(1000, data.total || 0) ? start + PAGE : null,
    items: (data.items || []).map((it) => ({
      title: stripTags(it.title).slice(0, 80),
      thumb: it.thumbnail,
      link: it.link,
      w: +it.sizewidth || 0,
      h: +it.sizeheight || 0,
    })),
  };
}

function sniff(bytes) {
  const b = new Uint8Array(bytes.slice(0, 12));
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  return null;
}

async function image(url, origin, ctx) {
  const target = url.searchParams.get('url') || '';
  let t;
  try { t = new URL(target); } catch { return json({ error: '주소가 이상해요' }, 400, origin); }
  if (!/^https?:$/.test(t.protocol)) return json({ error: '주소가 이상해요' }, 400, origin);

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.local/img?url=${encodeURIComponent(t.href)}`);
  let res = await cache.match(cacheKey);
  if (!res) {
    // 네이버 썸네일은 네이버를 출처로, 그 밖에는 원본 사이트를 출처로 보낸다 (핫링크 차단 회피)
    const referer = /(^|\.)pstatic\.net$/.test(t.hostname) ? 'https://search.naver.com/'
      : /(^|\.)(daumcdn\.net|kakaocdn\.net)$/.test(t.hostname) ? 'https://search.daum.net/'
      : `${t.protocol}//${t.host}/`;
    let up;
    try {
      up = await fetch(t.href, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
          'Accept': 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
          'Referer': referer,
        },
        redirect: 'follow',
        cf: { cacheTtl: 86400, cacheEverything: true },
      });
    } catch {
      return json({ error: '이미지를 못 받았어요' }, 502, origin);
    }
    if (!up.ok) return json({ error: `이미지를 못 받았어요 (${up.status})` }, 502, origin);
    const len = +(up.headers.get('content-length') || 0);
    if (len > MAX_IMAGE) return json({ error: '이미지가 너무 커요' }, 413, origin);
    const buf = await up.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE) return json({ error: '이미지가 너무 커요' }, 413, origin);
    let type = (up.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/') || type === 'image/svg+xml') type = sniff(buf);
    if (!type) return json({ error: '이미지가 아니에요' }, 415, origin);
    res = new Response(buf, { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors(origin))) out.headers.set(k, v);
  out.headers.set('x-content-type-options', 'nosniff');
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if (!allowedOrigin(origin)) return new Response('forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors(origin), 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return json({ error: 'GET만 돼요' }, 405, origin);
    if (url.pathname === '/search') return search(url, env, origin, ctx);
    if (url.pathname === '/img') return image(url, origin, ctx);
    return json({ ok: true }, 200, origin);
  },
};
