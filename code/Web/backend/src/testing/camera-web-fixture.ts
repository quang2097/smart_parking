// Disposable real backend + built web frontend for the camera proof-of-concept UI test.
import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';
import { hashPassword } from '../security.js';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const id = randomUUID(), email = `camera-web-${id}@example.com`, password = 'Camera web fixture password!';
const configFile = fileURLToPath(new URL(`../../../../.cache/camera-web-${id}.json`, import.meta.url));
const jpeg = readFileSync(new URL('./camera-frame.jpg', import.meta.url));
let sourceStreams = 0;
const source = createServer((req, res) => {
  if (req.url === '/snapshot') { res.writeHead(200, { 'Content-Type': 'image/jpeg' }); res.end(jpeg); }
  else if (req.url === '/stream') {
    sourceStreams++;
    res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' });
    const frame = () => res.write(Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg, Buffer.from('\r\n')]));
    frame(); const timer = setInterval(frame, 200);
    res.on('close', () => { clearInterval(timer); sourceStreams--; });
  } else { res.writeHead(503); res.end('Fixture camera offline'); }
});
const gateway = express();
gateway.get('/test/camera-stats', (_req, res) => res.json({ sourceStreams }));
let api: typeof import('../app.js')['app'] | undefined;
gateway.use((req, res, next) => { if (req.path.startsWith('/api/')) { if (api) api(req, res, next); else res.sendStatus(503); } else next(); });
const frontend = fileURLToPath(new URL('../../../../Web/frontend/dist/', import.meta.url));
gateway.use(express.static(frontend));
gateway.use((_req, res) => res.sendFile(frontend + 'index.html'));
const server = createServer(gateway);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  try {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    source.closeAllConnections(); await new Promise<void>(resolve => source.close(() => resolve()));
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    try { unlinkSync(configFile); } catch {}
  } finally { await pool.end(); process.exit(); }
}
process.on('message', message => { if (message === 'stop') void stop(); });
process.on('disconnect', () => { void stop(); });
try {
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const sourceAddress = source.address(), address = server.address();
  if (!sourceAddress || typeof sourceAddress === 'string' || !address || typeof address === 'string') throw new Error('Camera web fixture failed to start');
  const origin = `http://127.0.0.1:${address.port}`, sourceOrigin = `http://127.0.0.1:${sourceAddress.port}`;
  mkdirSync(root + '.cache', { recursive: true });
  writeFileSync(configFile, JSON.stringify({ roads: [
    { id: 'hanoi-demo', name: 'Kim Mã · DEMO', location: 'Hà Nội · Minh họa, không phải camera thật', cameras: [
      { id: 'demo', name: 'Camera minh họa · DEMO', source: 'Mô phỏng cục bộ, không phải iHanoi', kind: 'demo', refreshSeconds: 5 },
      { id: 'snapshot', name: 'Camera JPEG · TEST', source: 'Nguồn HTTP kiểm thử', kind: 'snapshot', url: sourceOrigin + '/snapshot', refreshSeconds: 5 },
      { id: 'mjpeg', name: 'Camera MJPEG · TEST', source: 'Nguồn HTTP kiểm thử', kind: 'mjpeg', url: sourceOrigin + '/stream' },
      { id: 'offline', name: 'Camera ngoại tuyến · TEST', source: 'Nguồn HTTP kiểm thử', kind: 'snapshot', url: sourceOrigin + '/offline', refreshSeconds: 5 },
    ] }, { id: 'empty-road', name: 'Tuyến đường chưa có camera', location: 'Test', cameras: [] },
  ] }));
  process.env.NODE_ENV = 'development'; process.env.APP_URL = origin;
  process.env.CAMERA_CATALOG_FILE = configFile; process.env.CAMERA_ALLOWED_ORIGINS = sourceOrigin;
  await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Camera proof of concept','user',$3)", [id, email, await hashPassword(password)]);
  api = (await import('../app.js')).app;
  process.send?.({ origin, email, password });
} catch (error) { process.send?.({ error: (error as Error).message }); await stop(); }
