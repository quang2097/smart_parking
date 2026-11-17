import { readFileSync } from 'node:fs';

export type Camera = { id: string; name: string; kind: 'demo' | 'snapshot' | 'mjpeg'; source: string; url?: string; authorizationEnv?: string; refreshSeconds: number };
export type CameraRoad = { id: string; name: string; location: string; cameras: Camera[] };
export type CameraCatalog = { roads: CameraRoad[] };
const identifier = /^[a-z0-9][a-z0-9-]{0,79}$/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;

export function allowedCameraOrigins(value = '') {
  return new Set(value.split(',').filter(value => value.trim()).map(value => {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('CAMERA_ALLOWED_ORIGINS must contain HTTP(S) origins only.');
    return url.origin;
  }));
}
export function validateCameraUrl(value: string, origins: Set<string>) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || !origins.has(url.origin)) throw new Error('Camera URL must use an explicitly allowed HTTP(S) origin without embedded credentials or fragments.');
  return url;
}
export function parseCameraCatalog(input: unknown, origins: Set<string>): CameraCatalog {
  if (!input || typeof input !== 'object' || !Array.isArray((input as any).roads) || (input as any).roads.length > 100) throw new Error('Camera catalog requires at most 100 roads.');
  const roadIds = new Set<string>(), cameraIds = new Set<string>();
  const roads = (input as any).roads.map((road: any) => {
    if (!road || typeof road.id !== 'string' || !identifier.test(road.id) || roadIds.has(road.id) || !text(road.name, 120) || !text(road.location, 240) || !Array.isArray(road.cameras) || road.cameras.length > 50) throw new Error('Invalid road in camera catalog.');
    roadIds.add(road.id);
    const cameras = road.cameras.map((camera: any): Camera => {
      if (!camera || typeof camera.id !== 'string' || !identifier.test(camera.id) || cameraIds.has(camera.id) || !text(camera.name, 120) || !text(camera.source, 200) || !['demo','snapshot','mjpeg'].includes(camera.kind)) throw new Error('Invalid or duplicate camera in catalog.');
      cameraIds.add(camera.id);
      const refreshSeconds = camera.refreshSeconds ?? 10;
      if (!Number.isInteger(refreshSeconds) || refreshSeconds < 5 || refreshSeconds > 300) throw new Error('Camera refreshSeconds must be 5–300.');
      if (camera.kind !== 'demo') {
        if (typeof camera.url !== 'string') throw new Error('Camera source URL is required.');
        validateCameraUrl(camera.url, origins);
        if (camera.authorizationEnv !== undefined && !/^[A-Z][A-Z0-9_]{0,99}$/.test(camera.authorizationEnv)) throw new Error('Invalid camera authorization environment variable name.');
      }
      return { id: camera.id, name: camera.name.trim(), kind: camera.kind, source: camera.source.trim(), refreshSeconds,
        ...(camera.kind === 'demo' ? {} : { url: camera.url, authorizationEnv: camera.authorizationEnv }) };
    });
    return { id: road.id, name: road.name.trim(), location: road.location.trim(), cameras };
  });
  return { roads };
}
export function loadCameraCatalog(): CameraCatalog {
  const origins = allowedCameraOrigins(process.env.CAMERA_ALLOWED_ORIGINS);
  if (process.env.CAMERA_CATALOG_FILE) return parseCameraCatalog(JSON.parse(readFileSync(process.env.CAMERA_CATALOG_FILE, 'utf8')), origins);
  if (process.env.NODE_ENV === 'production') return { roads: [] };
  return parseCameraCatalog({ roads: [
    { id: 'kim-ma-demo', name: 'Kim Mã · minh họa', location: 'Hà Nội · Tuyến đường dùng để kiểm thử giao diện', cameras: [
      { id: 'kim-ma-demo-1', name: 'Góc nhìn nút giao 01 · DEMO', kind: 'demo', source: 'Mô phỏng cục bộ, không phải iHanoi', refreshSeconds: 5 },
      { id: 'kim-ma-demo-2', name: 'Góc nhìn nút giao 02 · DEMO', kind: 'demo', source: 'Mô phỏng cục bộ, không phải iHanoi', refreshSeconds: 5 },
    ] },
    { id: 'giai-phong-demo', name: 'Giải Phóng · minh họa', location: 'Hà Nội · Tuyến đường dùng để kiểm thử giao diện', cameras: [
      { id: 'giai-phong-demo-1', name: 'Góc nhìn nút giao 03 · DEMO', kind: 'demo', source: 'Mô phỏng cục bộ, không phải iHanoi', refreshSeconds: 5 },
    ] },
  ] }, origins);
}
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]!);
export function demoCameraFrame(camera: Camera, now = Date.now()) {
  const offset = Math.floor(now / 1000) % 20 * 28;
  const cars = [0, 170, 340, 510].map((delta, i) => `<rect x="${(offset + delta) % 700 - 50}" y="${190 + i % 2 * 33}" width="40" height="20" rx="5" fill="${i % 2 ? '#d3e8b4' : '#e4b853'}"/><rect x="${330 + i % 2 * 33}" y="${(offset + delta) % 360 - 30}" width="20" height="40" rx="5" fill="#a6c8d8"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 720 405"><rect width="720" height="405" fill="#163e33"/><path d="M0 175H720V255H0Z M315 0H405V405H315Z" fill="#33463e"/><path d="M0 215H315M405 215H720M360 0V175M360 255V405" stroke="#9ba994" stroke-width="2" stroke-dasharray="14 12"/>${cars}<rect x="16" y="16" width="688" height="76" rx="10" fill="#102a23"/><text x="30" y="44" fill="#f6cf71" font-size="19" font-family="Arial">DEMO · KHÔNG PHẢI CAMERA HÀ NỘI</text><text x="30" y="72" fill="#d3e8b4" font-size="14" font-family="Arial">${escape(camera.name)}</text><text x="20" y="383" fill="white" font-size="14" font-family="Arial">Khung mô phỏng tạo lúc ${escape(new Date(now).toISOString())}</text></svg>`;
}
