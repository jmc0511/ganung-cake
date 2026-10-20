const { app, BrowserWindow, ipcMain, session, dialog, clipboard, nativeImage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// --smoke <out.png>: 창을 띄우지 않고 예시 스티커로 렌더한 뒤 캡처하고 종료
const smokeIdx = process.argv.indexOf('--smoke');
const smokeOut = smokeIdx >= 0 ? path.resolve(process.argv[smokeIdx + 1] || 'smoke.png') : null;

const BROWSE_PARTITION = 'persist:browse';
let win;

const stateFile = () => path.join(app.getPath('userData'), 'cake.json');

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    show: !smokeOut,
    backgroundColor: '#FFF4F1',
    title: '가능충 케이크',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    },
  });
  win.removeMenu();
  win.loadFile('index.html', smokeOut ? { query: { smoke: '1' } } : undefined);

  // 검색 브라우저(webview)에 '가져오기' 버튼을 심는 preload를 강제로 지정
  win.webContents.on('will-attach-webview', (_e, wp) => {
    delete wp.preloadURL;
    wp.preload = path.join(__dirname, 'webview-preload.js');
    wp.contextIsolation = true;
    wp.sandbox = true;
    wp.nodeIntegration = false;
  });

  if (smokeOut) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(smokeOut, img.toPNG());
        app.quit();
      }, 7000);
    });
  }
}

app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return;
  // 새 창으로 열리는 링크는 같은 검색 창에서 연다
  wc.setWindowOpenHandler(({ url }) => {
    wc.loadURL(url);
    return { action: 'deny' };
  });
  wc.on('context-menu', (_ev, p) => {
    const items = [];
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({
        label: '케이크에 꽂기',
        click: () => win?.webContents.send('grab', { url: p.srcURL, pageUrl: wc.getURL() }),
      });
      items.push({ type: 'separator' });
    }
    const nav = wc.navigationHistory;
    items.push({ label: '뒤로', enabled: nav.canGoBack(), click: () => nav.goBack() });
    items.push({ label: '앞으로', enabled: nav.canGoForward(), click: () => nav.goForward() });
    items.push({ label: '새로고침', click: () => wc.reload() });
    if (p.selectionText) items.push({ type: 'separator' }, { label: '복사', role: 'copy' });
    if (p.isEditable) items.push({ label: '붙여넣기', role: 'paste' });
    Menu.buildFromTemplate(items).popup();
  });
});

function sniffMime(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(4, 12).toString().startsWith('ftypavif')) return 'image/avif';
  return null;
}

ipcMain.handle('fetch-image', async (_e, { url, referer }) => {
  if (/^data:image\//.test(url)) return url;
  if (!/^https?:\/\//.test(url)) throw new Error('지원하지 않는 주소');
  const ses = session.fromPartition(BROWSE_PARTITION);
  let res;
  try {
    res = await ses.fetch(url, { headers: referer ? { Referer: referer } : {} });
  } catch {
    res = await ses.fetch(url);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 30e6) throw new Error('이미지가 너무 큼');
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const mime = type.startsWith('image/') && type !== 'image/svg+xml' ? type : sniffMime(buf);
  if (!mime) throw new Error('이미지가 아님');
  return `data:${mime};base64,${buf.toString('base64')}`;
});

ipcMain.handle('load-state', () => {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return null;
  }
});

ipcMain.handle('save-state', (_e, state) => {
  fs.writeFileSync(stateFile(), JSON.stringify(state));
});

ipcMain.handle('save-png', async (_e, { dataUrl, name }) => {
  const safe = (name || '가능충 케이크').replace(/[\\/:*?"<>|]/g, '').trim() || '가능충 케이크';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('pictures'), `${safe}.png`),
    filters: [{ name: 'PNG 이미지', extensions: ['png'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return filePath;
});

ipcMain.handle('copy-png', (_e, dataUrl) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
