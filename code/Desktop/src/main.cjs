const { app, BrowserWindow, ipcMain, protocol, session, net, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { existsSync } = require('node:fs');
const { validateRequest, assetPath } = require('./policy.cjs');
const { cameraMedia } = require('./camera-media.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'traffic', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window;
const trusted = event => {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('traffic://app/')) throw new Error('Untrusted request');
};
app.whenReady().then(() => {
  const apiSession = session.fromPartition('persist:smart-traffic-api');
  let backendOrigin;
  const media = cameraMedia(apiSession, () => backendOrigin);
  ipcMain.handle('traffic:request', async (event, base, route, body) => {
    trusted(event);
    const { url, payload } = validateRequest(base, route, body);
    const nextOrigin = new URL(url).origin;
    if (nextOrigin !== backendOrigin) { media.cancelAll(); backendOrigin = nextOrigin; }
    const response = await apiSession.fetch(url, {
      method: payload === undefined ? 'GET' : 'POST', credentials: 'include', redirect: 'error',
      headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(payload === undefined ? {} : { body: payload }), signal: AbortSignal.timeout(10000),
    });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({ message: 'Máy chủ trả về phản hồi không hợp lệ.' }));
    return { status: response.status, data };
  });
  ipcMain.handle('traffic:clear-session', async event => {
    trusted(event);
    media.cancelAll(); backendOrigin = undefined;
    await apiSession.clearStorageData({ storages: ['cookies'] });
  });
  ipcMain.handle('traffic:stop-camera', event => { trusted(event); media.cancelAll(); });
  const root = path.resolve(__dirname, '../ui');
  protocol.handle('traffic', async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('', { status: 403 });
      if (url.pathname.startsWith('/api/cameras/')) return media.handle(request);
      let file = assetPath(root, url.pathname);
      if (url.pathname === '/' || !path.extname(file)) file = path.join(root, 'index.html');
      if (!existsSync(file)) return new Response('', { status: 404 });
      const response = await net.fetch(pathToFileURL(file).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'");
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('', { status: 400 }); }
  });
  const createWindow = () => {
    const testing = app.commandLine.hasSwitch('smoke-test');
    window = new BrowserWindow({ show: !testing, width: 1360, height: 900, minWidth: 360, minHeight: 640, backgroundColor: '#f9faf6', title: 'Smart Traffic', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, offscreen: testing, backgroundThrottling: !testing } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('traffic://app/')) event.preventDefault(); });
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.on('minimize', () => media.cancelAll());
    window.on('hide', () => media.cancelAll());
    window.loadURL('traffic://app/');
    window.on('closed', () => { media.cancelAll(); window = null; });
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Smart Traffic', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'quit' }] }, { role: 'editMenu' }]));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
