// 방장 연결 복구 스모크: 방장 연결을 끊거나(disconnect) 망가뜨린(destroy) 뒤 참가자가 들어오는지 본다.
// 사용: npx electron tools/healshot.js [disconnect|destroy]
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const kill = process.argv[2] || 'destroy';
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

function open(query) {
  const win = new BrowserWindow({ width: 900, height: 900, show: false });
  win.webContents.on('console-message', (_e, _l, msg) => { if (/SMOKE|찾는/.test(msg)) console.log(`[${query.split('&')[0]}] ${msg}`); });
  win.loadURL(`http://localhost:${server.address().port}/?${query}`);
  return win;
}

app.whenReady().then(() => server.listen(0, async () => {
  open(`smoke=heal&code=${code}&kill=${kill}`);
  await new Promise((r) => setTimeout(r, 5000));
  open(`smoke=guest&code=${code}`);
  await new Promise((r) => setTimeout(r, 30000));
  app.quit();
}));
