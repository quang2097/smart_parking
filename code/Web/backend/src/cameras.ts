import { Router, type Request, type Response } from 'express';
import { once } from 'node:events';
import { pool } from './db.js';
import { digest } from './security.js';
import { allowedCameraOrigins, demoCameraFrame, loadCameraCatalog, validateCameraUrl, type CameraCatalog } from './camera-catalog.js';

export function cameraRouter(sessionToken: (req: Request) => string, catalog: CameraCatalog = loadCameraCatalog()) {
  const router = Router();
  const origins = allowedCameraOrigins(process.env.CAMERA_ALLOWED_ORIGINS);
  let activeTransfers = 0;
  const transfersPerUser = new Map<string, number>();
  router.use(async (req, res, next) => {
    const token = sessionToken(req);
    const { rows } = await pool.query('SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true', [digest(token)]);
    if (!token || !rows[0]) { res.status(401).json({ message: 'Vui lòng đăng nhập để quan sát camera.' }); return; }
    res.locals.userId = rows[0].id; next();
  });
  router.get('/roads', (_req, res) => {
    res.json({ provider: 'configured-sources', ihanoiConnected: false, demo: catalog.roads.some(road => road.cameras.some(camera => camera.kind === 'demo')),
      roads: catalog.roads.map(road => ({ id: road.id, name: road.name, location: road.location, cameraCount: road.cameras.length })) });
  });
  router.get('/roads/:roadId/cameras', (req, res) => {
    const road = catalog.roads.find(road => road.id === req.params.roadId);
    if (!road) { res.status(404).json({ message: 'Không tìm thấy tuyến đường.' }); return; }
    res.json({ road: { id: road.id, name: road.name, location: road.location }, cameras: road.cameras.map(camera => ({
      id: camera.id, name: camera.name, kind: camera.kind, source: camera.source, refreshSeconds: camera.refreshSeconds,
      mediaPath: `/api/cameras/${camera.id}/${camera.kind === 'mjpeg' ? 'stream' : 'snapshot'}`,
    })) });
  });
  async function serveMedia(req: Request, res: Response, stream: boolean) {
    const camera = catalog.roads.flatMap(road => road.cameras).find(camera => camera.id === req.params.cameraId);
    if (!camera) { res.status(404).json({ message: 'Không tìm thấy camera.' }); return; }
    if (stream !== (camera.kind === 'mjpeg')) { res.status(400).json({ message: 'Định dạng camera không khớp.' }); return; }
    res.set('Cache-Control', 'no-store');
    if (camera.kind === 'demo') { res.type('image/svg+xml').send(demoCameraFrame(camera)); return; }
    const userId = String(res.locals.userId);
    if (activeTransfers >= 16 || (transfersPerUser.get(userId) ?? 0) >= 2) { res.status(429).json({ message: 'Đã đạt giới hạn kết nối camera. Đóng camera đang xem rồi thử lại.' }); return; }
    activeTransfers++; transfersPerUser.set(userId, (transfersPerUser.get(userId) ?? 0) + 1);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), stream ? 60000 : 10000);
    const firstDataTimeout = stream ? setTimeout(() => controller.abort(), 10000) : undefined;
    const disconnect = () => controller.abort();
    res.on('close', disconnect);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const url = validateCameraUrl(camera.url!, origins);
      const authorization = camera.authorizationEnv ? process.env[camera.authorizationEnv] : undefined;
      if (camera.authorizationEnv && !authorization) throw new Error('Camera credential missing');
      // URLs and optional credentials come only from server-local configuration, never request parameters.
      const upstream = await fetch(url, { redirect: 'error', signal: controller.signal,
        headers: { Accept: stream ? 'multipart/x-mixed-replace' : 'image/jpeg,image/png,image/webp', ...(authorization ? { Authorization: authorization } : {}) } });
      const type = upstream.headers.get('content-type') ?? '';
      const allowed = stream ? /^multipart\/x-mixed-replace\s*;\s*boundary=[^\r\n]+$/i.test(type) : /^image\/(jpeg|png|webp)(?:;|$)/i.test(type);
      if (!upstream.ok || !upstream.body || !allowed) throw new Error('Camera source unavailable or unsupported format');
      reader = upstream.body.getReader();
      if (!stream) {
        const parts: Uint8Array[] = []; let size = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          size += value.length; if (size > 5 * 1024 * 1024) throw new Error('Camera snapshot too large');
          parts.push(value);
        }
        if (!size) throw new Error('Empty camera snapshot');
        res.set('Content-Type', type).set('X-Camera-Received-At', new Date().toISOString()).send(Buffer.concat(parts));
      } else {
        res.set('Content-Type', type);
        // Bound duration and bytes per connection; the viewer offers an explicit reconnect.
        let size = 0;
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          clearTimeout(firstDataTimeout);
          size += value.length; if (size > 64 * 1024 * 1024) throw new Error('Camera stream limit reached');
          if (!res.write(value)) await once(res, 'drain', { signal: controller.signal });
        }
        res.end();
      }
    } catch {
      if (!res.destroyed) {
        if (res.headersSent) res.destroy();
        else res.status(502).json({ message: 'Không lấy được hình ảnh camera. Nguồn có thể ngoại tuyến, yêu cầu quyền truy cập hoặc không hỗ trợ định dạng này.' });
      }
    } finally {
      clearTimeout(timeout); clearTimeout(firstDataTimeout); controller.abort(); res.off('close', disconnect);
      await reader?.cancel().catch(() => {});
      activeTransfers--; const count = (transfersPerUser.get(userId) ?? 1) - 1; if (count) transfersPerUser.set(userId, count); else transfersPerUser.delete(userId);
    }
  }
  router.get('/:cameraId/snapshot', (req, res) => serveMedia(req, res, false));
  router.get('/:cameraId/stream', (req, res) => serveMedia(req, res, true));
  return router;
}
