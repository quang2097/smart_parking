const { validateCameraMediaPath } = require('./policy.cjs');

// Camera bytes flow through the app origin; session cookies stay in native storage.
function cameraMedia(apiSession, getBackend) {
  const active = new Set();
  const error = (status, message) => new Response(JSON.stringify({ message }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  return {
    cancelAll() { for (const controller of active) controller.abort(); active.clear(); },
    async handle(request) {
      const address = new URL(request.url);
      let path;
      try { path = validateCameraMediaPath(address.pathname); } catch { return error(400, 'Đường dẫn camera không hợp lệ.'); }
      const base = getBackend();
      if (!base || request.method !== 'GET') return error(403, 'Chưa chọn máy chủ hoặc yêu cầu không hợp lệ.');
      const streaming = path.endsWith('/stream');
      const controller = new AbortController(); active.add(controller);
      const abort = () => controller.abort();
      request.signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, streaming ? 65000 : 12000);
      const cleanup = () => { clearTimeout(timeout); active.delete(controller); request.signal.removeEventListener('abort', abort); };
      let reader;
      try {
        const response = await apiSession.fetch(base + path, { method: 'GET', credentials: 'include', redirect: 'error', signal: controller.signal });
        if (!response.ok) { await response.body?.cancel(); cleanup(); return error(response.status === 401 ? 401 : 502, 'Camera không khả dụng hoặc phiên đăng nhập đã hết hạn.'); }
        const type = response.headers.get('content-type') || '';
        const allowed = streaming ? /^multipart\/x-mixed-replace\s*;\s*boundary=/i.test(type) : /^image\/(svg\+xml|jpeg|png|webp)(?:;|$)/i.test(type);
        if (!allowed || !response.body) { await response.body?.cancel(); cleanup(); return error(502, 'Định dạng camera không hợp lệ.'); }
        reader = response.body.getReader(); let bytes = 0;
        const body = new ReadableStream({
          async pull(target) {
            try {
              const { value, done } = await reader.read();
              if (done) { cleanup(); target.close(); return; }
              bytes += value.length;
              if (bytes > (streaming ? 64 : 5) * 1024 * 1024) throw new Error('Camera media limit');
              target.enqueue(value);
            } catch (failure) { controller.abort(); cleanup(); target.error(failure); }
          },
          async cancel() { controller.abort(); cleanup(); await reader.cancel().catch(() => {}); },
        });
        const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        const received = response.headers.get('x-camera-received-at'); if (received) headers['X-Camera-Received-At'] = received;
        return new Response(body, { headers });
      } catch { controller.abort(); cleanup(); return error(502, 'Không thể kết nối camera.'); }
    },
  };
}
module.exports = { cameraMedia };
