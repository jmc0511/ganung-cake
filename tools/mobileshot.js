// 모바일·패드 스모크: 터치 에뮬레이션(CDP)으로 끌기 / 빈 곳 스크롤 / 두 손가락 확대를 확인하고 화면을 캡처한다.
// OS 마우스는 쓰지 않는다. 사용: npx electron tools/mobileshot.js <출력폴더>
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || '.');
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

async function device(width, height, scale) {
  const win = new BrowserWindow({ width, height, show: false, useContentSize: true });
  console.log('device', width, height);
  await win.loadURL('about:blank');
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true });
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await dbg.sendCommand('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' });
  win.webContents.on('console-message', (e) => { if (/error/i.test(e.message || '')) console.log('[page]', e.message); });
  console.log('emulation set');
  await win.loadURL(`http://localhost:${server.address().port}/?smoke=mobile`);
  await sleep(3500);
  const touch = (type, points) => dbg.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const info = () => win.webContents.executeJavaScript('({ ...__smokeInfo(), touchClass: document.documentElement.classList.contains("touch"), selVisible: !document.getElementById("sel").hidden })');
  const shot = async (name) => fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
  return { win, touch, info, shot };
}

process.on('unhandledRejection', (e) => { console.log('ERR', e && e.stack || e); app.quit(); });
app.whenReady().then(() => server.listen(0, async () => {
  // 폰
  const ph = await device(390, 844, 3);
  let a = await ph.info();
  console.log('phone start', JSON.stringify(a));

  // 1) 토퍼 끌기
  await ph.touch('touchStart', [[a.cx, a.cy]]);
  for (let i = 1; i <= 8; i++) { await ph.touch('touchMove', [[a.cx + i * 8, a.cy + i * 2]]); await sleep(16); }
  await ph.touch('touchEnd', []);
  await sleep(200);
  let b = await ph.info();
  console.log('after drag  bx', a.bx.toFixed(1), '->', b.bx.toFixed(1), ' scrollY', a.scrollY, '->', b.scrollY, ' selVisible', b.selVisible);

  // 2) 빈 곳(가랜드 위쪽) 쓸어서 페이지 스크롤
  const ex = 30, ey = b.canvasTop + 300;
  await ph.touch('touchStart', [[ex, ey]]);
  for (let i = 1; i <= 10; i++) { await ph.touch('touchMove', [[ex, ey - i * 25]]); await sleep(16); }
  await ph.touch('touchEnd', []);
  await sleep(600);
  const c = await ph.info();
  console.log('after swipe scrollY', b.scrollY, '->', c.scrollY);
  await ph.win.webContents.executeJavaScript('scrollTo(0,0)');
  await sleep(300);

  // 3) 두 손가락 확대: 한 손가락으로 토퍼를 잡고 두 번째 손가락을 벌린다
  const d = await ph.info();
  await ph.touch('touchStart', [[d.cx, d.cy]]);
  await sleep(30);
  await ph.touch('touchStart', [[d.cx, d.cy], [d.cx + 30, d.cy + 30]]);
  for (let i = 1; i <= 10; i++) { await ph.touch('touchMove', [[d.cx - i * 3, d.cy - i * 3], [d.cx + 30 + i * 6, d.cy + 30 + i * 6]]); await sleep(16); }
  await ph.touch('touchEnd', []);
  await sleep(300);
  const e = await ph.info();
  console.log('after pinch size', d.size.toFixed(1), '->', e.size.toFixed(1), ' scrollY', e.scrollY, ' touchClass', e.touchClass);
  await ph.shot('m-phone.png');
  await ph.win.webContents.executeJavaScript('scrollTo(0, document.querySelector(".add").getBoundingClientRect().top + scrollY - 60)');
  await sleep(300);
  await ph.shot('m-phone-add.png');

  // 패드 세로 / 가로
  const pp = await device(820, 1180, 2);
  await pp.shot('m-pad-portrait.png');
  const pl = await device(1180, 820, 2);
  await pl.shot('m-pad-landscape.png');
  app.quit();
}));
