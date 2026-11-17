import { Capacitor, CapacitorHttp, CapacitorCookies, registerPlugin } from '@capacitor/core';
const TrafficCamera = registerPlugin<{ setBackend(options: { base: string }): Promise<void>; stopMedia(): Promise<void> }>('TrafficCamera');

type Result = { status: number; data: any };
declare global {
  interface Window {
    desktopTraffic?: {
      request: (base: string, path: string, body?: unknown) => Promise<Result>;
      clearSession: () => Promise<void>;
      stopCameraMedia: () => Promise<void>;
    };
  }
}
export const nativeClient = Boolean(window.desktopTraffic) || Capacitor.isNativePlatform();
export async function cancelCameraMedia() {
  if (window.desktopTraffic) await window.desktopTraffic.stopCameraMedia();
  else if (Capacitor.isNativePlatform()) await TrafficCamera.stopMedia();
}
const storageKey = 'smart-traffic.backend';
export function backendAddress() {
  return localStorage.getItem(storageKey) || (Capacitor.isNativePlatform() ? 'http://10.0.2.2:3000' : 'http://localhost:3000');
}
export function normalizeBackend(value: string) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Nhập địa chỉ gốc HTTP/HTTPS, không gồm /api, mật khẩu hoặc tham số.');
  }
  return url.origin;
}
export async function saveBackend(value: string) {
  const next = normalizeBackend(value);
  if (window.desktopTraffic) await window.desktopTraffic.clearSession();
  else {
    await CapacitorCookies.clearCookies({ url: backendAddress() });
    await TrafficCamera.setBackend({ base: next });
  }
  localStorage.setItem(storageKey, next);
}
export async function request(path: string, body?: unknown): Promise<Result> {
  if (window.desktopTraffic) return window.desktopTraffic.request(backendAddress(), path, body);
  if (Capacitor.isNativePlatform()) {
    await TrafficCamera.setBackend({ base: normalizeBackend(backendAddress()) });
    const result = await CapacitorHttp.request({
      url: `${backendAddress()}${path}`,
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { data: body }),
      responseType: 'json', connectTimeout: 10000, readTimeout: 10000,
      disableRedirects: true,
    });
    return { status: result.status, data: result.data };
  }
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  return { status: response.status, data: response.status === 204 ? {} : await response.json().catch(() => ({ message: 'Máy chủ trả về phản hồi không hợp lệ.' })) };
}

// The local bundle and native HTTP keep the UI independent of the Vite server.
export function mountConnection() {
  if (!nativeClient) return;
  document.body.classList.add('native-client');
  const panel = document.createElement('details');
  panel.className = 'connection-panel';
  panel.innerHTML = `<summary>Smart Traffic · ${window.desktopTraffic ? 'Desktop' : 'Android'} · Kết nối máy chủ</summary><form><label for="backend-url">Địa chỉ backend</label><input id="backend-url" type="url" required autocomplete="url" placeholder="http://192.168.1.10:3000"><p>Máy tính: localhost:3000 · Giả lập Android: 10.0.2.2:3000 · Điện thoại: IP LAN của máy chủ. Có thể dùng địa chỉ HTTPS của tunnel sau này.</p><p class="local-warning">HTTP chỉ dành cho mạng phát triển tin cậy. Đổi máy chủ sẽ xóa phiên trên thiết bị và yêu cầu đăng nhập lại.</p><div class="connection-actions"><button type="button" id="test-backend">Kiểm tra kết nối</button><button type="submit">Lưu & kết nối lại</button></div><p role="status" aria-live="polite" id="connection-status"></p></form>`;
  document.body.prepend(panel);
  const input = panel.querySelector<HTMLInputElement>('input')!;
  input.value = backendAddress();
  const status = panel.querySelector<HTMLElement>('#connection-status')!;
  panel.querySelector('form')!.onsubmit = async event => {
    event.preventDefault();
    try { await saveBackend(input.value); location.replace('/'); }
    catch (error) { status.textContent = (error as Error).message; }
  };
  panel.querySelector<HTMLButtonElement>('#test-backend')!.onclick = async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    status.textContent = 'Đang kiểm tra…';
    try {
      if (normalizeBackend(input.value) !== backendAddress()) throw new Error('Lưu địa chỉ mới trước khi kiểm tra kết nối.');
      const result = await request('/api/health');
      if (result.status !== 200 || result.data?.status !== 'ok') throw new Error('Backend hoặc cơ sở dữ liệu chưa sẵn sàng.');
      status.textContent = 'Đã kết nối backend và cơ sở dữ liệu.';
    } catch (error) { status.textContent = (error as Error).message; }
    finally { button.disabled = false; }
  };
}
