// 사이트 스모크: web/을 로컬 서버로 띄우고 숨김 창 두 개(방장/참가자)로 멀티를 돌린 뒤 각각 캡처한다.
// 사용: npx electron tools/webshot.js <출력폴더>
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || '.');
const root = path.join(__dirname, '..', 'web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

function open(query, w, h) {
  const win = new BrowserWindow({ width: w, height: h, show: false });
  win.webContents.on('console-message', (_e, _l, msg) => console.log(`[${query.split('&')[0]}] ${msg}`));
  win.loadURL(`http://localhost:${server.address().port}/?${query}`);
  return win;
}

app.whenReady().then(() => server.listen(0, async () => {
  const host = open(`smoke=host&code=${code}`, 1400, 900);
  await new Promise((r) => setTimeout(r, 6000));
  const guest = open(`smoke=guest&code=${code}`, 420, 900);
  await new Promise((r) => setTimeout(r, 16000));
  fs.writeFileSync(path.join(out, 'web-host.png'), (await host.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(out, 'web-guest.png'), (await guest.webContents.capturePage()).toPNG());
  app.quit();
}));
