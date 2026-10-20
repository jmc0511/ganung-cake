// 바로 검색 스모크: 가짜 중계 서버(/mock/search, /mock/img)로 결과 바둑판과 꽂기를 확인한다.
// 사용: npx electron tools/searchshot.js <출력폴더>
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || '.');
const root = path.join(__dirname, '..', 'web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const DICE = 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png';

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (u.pathname === '/mock/search') {
    const items = Array.from({ length: 12 }, (_, i) => ({ title: `주사위 ${i + 1}`, thumb: DICE, link: i === 1 ? 'https://example.invalid/broken.jpg' : DICE, w: 800, h: 600 }));
    res.writeHead(200, { 'content-type': 'application/json', ...cors });
    return res.end(JSON.stringify({ total: 24, start: 1, next: 13, items }));
  }
  if (u.pathname === '/mock/img') {
    try {
      const up = await fetch(u.searchParams.get('url'), { headers: { 'User-Agent': 'ganung-cake-smoke/1.0' } });
      if (!up.ok) throw new Error(up.status);
      res.writeHead(200, { 'content-type': up.headers.get('content-type'), ...cors });
      return res.end(Buffer.from(await up.arrayBuffer()));
    } catch { res.writeHead(502, cors); return res.end(); }
  }
  const p = path.join(root, decodeURIComponent(u.pathname).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

app.whenReady().then(() => server.listen(0, async () => {
  const port = server.address().port;
  const narrow = process.argv[4] === "narrow";
  const win = new BrowserWindow({ width: narrow ? 600 : 1400, height: 1500, show: false });
  win.webContents.on('console-message', (e) => { if (/SMOKE|rror/.test(e.message)) console.log(e.message); });
  const real = process.argv[3] === "real";
  await win.loadURL(real ? `http://localhost:${port}/?smoke=search&q=${encodeURIComponent("펭수")}` : `http://localhost:${port}/?smoke=search&worker=${encodeURIComponent(`http://localhost:${port}/mock`)}`);
  await new Promise((r) => setTimeout(r, 11000));
  await win.webContents.executeJavaScript(`document.querySelector(".add").scrollIntoView()`);
  await new Promise((r) => setTimeout(r, 800));
  fs.writeFileSync(path.join(out, 'search.png'), (await win.webContents.capturePage()).toPNG());
  app.quit();
}));
