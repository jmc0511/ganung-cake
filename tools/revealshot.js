// 공개 연출 / 전체 보기 스모크: 연출 중 화면, 다 꽂힌 뒤 전체 보기 화면을 캡처한다.
// 사용: npx electron tools/revealshot.js <출력폴더> [narrow]
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || '.');
const narrow = process.argv[3] === 'narrow';
const root = path.join(__dirname, '..', 'web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/$/, '/index.html'));
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(data);
  });
});

app.whenReady().then(() => server.listen(0, async () => {
  const win = new BrowserWindow({ width: narrow ? 420 : 1400, height: narrow ? 860 : 950, show: false });
  win.webContents.on('console-message', (e) => { if (/rror/.test(e.message)) console.log(e.message); });
  await win.loadURL(`http://localhost:${server.address().port}/?smoke=reveal`);
  await sleep(1200);
  await win.webContents.executeJavaScript(`document.getElementById('reveal').click()`);
  console.log('clicked at ~1s, still open:', await win.webContents.executeJavaScript(`!document.getElementById('reveal').hidden && state.stickers.filter(s => s.pending).length === 3`), 'hint:', await win.webContents.executeJavaScript(`document.getElementById('revealHint').textContent`));
  await sleep(1400);
  const tag = narrow ? '-m' : '';
  fs.writeFileSync(path.join(out, `reveal${tag}.png`), (await win.webContents.capturePage()).toPNG());
  const st = () => win.webContents.executeJavaScript(`({ pending: state.stickers.filter(s => s.pending).length, total: state.stickers.length, open: !document.getElementById('reveal').hidden, queue: document.getElementById('revealQueue').textContent })`);
  console.log('during', JSON.stringify(await st()));
  await sleep(9000);
  console.log('after', JSON.stringify(await st()));
  await win.webContents.executeJavaScript(`document.getElementById('galleryBtn').click()`);
  console.log('gallery', JSON.stringify(await win.webContents.executeJavaScript(`(() => { const g = document.getElementById('gallery'); const r = g.getBoundingClientRect(); return { hidden: g.hidden, display: getComputedStyle(g).display, w: r.width, h: r.height, items: document.querySelectorAll('.gallery-item').length, btnVisible: !!document.getElementById('galleryBtn').offsetParent }; })()`)));
  await sleep(1500);
  fs.writeFileSync(path.join(out, `gallery${tag}.png`), (await win.webContents.capturePage()).toPNG());
  app.quit();
}));
