const { app, BrowserWindow, ipcMain, protocol, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const paths = require('./paths');
const steam = require('./steam');
const store = require('./store');
const art = require('./art');

const RENDERER = path.join(__dirname, '..', 'renderer');
const WINDOW_ICON = path.join(RENDERER, 'branding', 'icon.png');
if (process.platform === 'win32') app.setAppUserModelId('local.gamelib');

// app://shelf/… 是界面文件，art://game/… 是游戏图片。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  // corsEnabled：3D 场景要把封面贴到光盘 / 卡带上，WebGL 读跨域图片需要 CORS
  { scheme: 'art', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function registerProtocols() {
  protocol.handle('app', (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(RENDERER, rel));
    if (!file.startsWith(RENDERER + path.sep)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  protocol.handle('art', async (req) => {
    const [id, kind, index] = new URL(req.url).pathname.split('/').filter(Boolean);
    const file = await art.resolve(Number(id), kind, Number(index) || 0);
    if (!file) return new Response('', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers });
  });
}

function registerIpc() {
  ipcMain.handle('config:get', async () => {
    const cfg = await paths.loadConfig();
    const forced = process.env.GAMELIB_STYLE ?? process.env.DISC_SHELF_STYLE;
    if (forced === 'disc' || forced === 'card') cfg.style = forced;
    return { ...cfg, dataDir: paths.dataDir() };
  });

  ipcMain.handle('config:save', (_e, cfg) => paths.saveConfig(cfg));

  ipcMain.handle('library:load', async (e) => {
    art.clearMemo();
    const cfg = await paths.loadConfig();
    return steam.loadLibrary(cfg, (p) => {
      if (!e.sender.isDestroyed()) e.sender.send('library:progress', p);
    });
  });

  // 装了就启动，没装就打开 Steam 的安装窗口。
  ipcMain.handle('game:launch', async (_e, appId, installed) => {
    try {
      await shell.openExternal(steam.launchUri(Number(appId), !!installed));
      return true;
    } catch {
      return false;
    }
  });

  // 只放行申请 Web API Key 的页面。
  ipcMain.handle('open:apikey', () => shell.openExternal('https://steamcommunity.com/dev/apikey'));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'gamelib',
    icon: WINDOW_ICON,
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  // 页面里的链接都不在窗口里打开
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev) => ev.preventDefault());
  win.loadURL('app://shelf/index.html');
  return win;
}

app.whenReady().then(() => {
  store.setFetch((url, init) => net.fetch(url, init));
  registerProtocols();
  registerIpc();
  const win = createWindow();
  const snapshotsDir = process.env.GAMELIB_SNAP ?? process.env.DISC_SHELF_SNAP;
  if (snapshotsDir) require('./snapshots').run(win, snapshotsDir);
});

app.on('window-all-closed', () => app.quit());
