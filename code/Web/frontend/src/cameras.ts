import { cancelCameraMedia } from './connection';
type Api = (path: string, body?: unknown) => Promise<any>;
type Camera = { id: string; name: string; source: string; kind: 'demo' | 'snapshot' | 'mjpeg'; mediaPath: string; refreshSeconds: number };
let cleanup = () => {};
export function stopCameraViewer() { cleanup(); cleanup = () => {}; }

export function mountCameraViewer(host: HTMLElement, api: Api) {
  stopCameraViewer();
  host.innerHTML = `<details open class="camera-panel"><summary><span>Quan sát giao thông Hà Nội</span><span class="role">Bản thử nghiệm web</span></summary><p class="camera-intro">Chọn tuyến đường, sau đó chọn camera trên tuyến. Nguồn iHanoi chưa được tích hợp; hình minh họa được gắn nhãn DEMO. Camera thật cần nguồn được cấp quyền.</p><div class="camera-selectors"><label for="camera-road">1. Chọn tuyến đường<select id="camera-road" disabled><option value="">Đang tải tuyến đường…</option></select></label><label for="camera-choice">2. Chọn camera trên tuyến<select id="camera-choice" disabled><option value="">Chọn tuyến đường trước</option></select></label></div><p id="camera-status" role="status" aria-live="polite">Đang tải danh sách…</p><div class="camera-heading"><div><h3 id="camera-name">Chưa chọn camera</h3><p id="camera-source"></p></div><span id="camera-kind" class="role" hidden></span></div><div class="camera-screen"><img id="camera-image" alt="" hidden><p id="camera-placeholder">Hình ảnh camera sẽ hiển thị ở đây.</p></div><div class="camera-toolbar"><p id="camera-time">Không có dữ liệu camera.</p><div><button type="button" id="camera-reconnect" disabled>Kết nối lại</button><button type="button" id="camera-stop" disabled>Dừng xem</button></div></div><p class="camera-footnote">Đây là màn hình quan sát. Hình ảnh không xác nhận trạng thái đèn và không tự động điều khiển tín hiệu. Ảnh định kỳ không phải video liên tục; thời gian nhận ảnh không phải thời gian camera ghi hình.</p></details>`;
  const panel = host.querySelector<HTMLDetailsElement>('details')!;
  panel.querySelector('.role')!.textContent = 'Quan sát camera · Thử nghiệm';
  const roads = host.querySelector<HTMLSelectElement>('#camera-road')!;
  const choices = host.querySelector<HTMLSelectElement>('#camera-choice')!;
  const status = host.querySelector<HTMLElement>('#camera-status')!;
  const picture = host.querySelector<HTMLImageElement>('#camera-image')!;
  const placeholder = host.querySelector<HTMLElement>('#camera-placeholder')!;
  const time = host.querySelector<HTMLElement>('#camera-time')!;
  const reconnect = host.querySelector<HTMLButtonElement>('#camera-reconnect')!;
  const stop = host.querySelector<HTMLButtonElement>('#camera-stop')!;
  let cameras: Camera[] = [], revision = 0, disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined, blobUrl = '';
  const report = (value: string, error = false) => { status.textContent = value; status.classList.toggle('traffic-error', error); };
  const clearMedia = (message: string) => {
    clearTimeout(timer); controller?.abort(); controller = undefined;
    picture.onload = null; picture.onerror = null; picture.removeAttribute('src'); picture.hidden = true;
    if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = '';
    placeholder.textContent = message; placeholder.hidden = false;
    time.textContent = 'Không hiển thị khung hình cũ.'; stop.disabled = true;
    return cancelCameraMedia().catch(() => {});
  };
  const options = (select: HTMLSelectElement, entries: { id: string; name: string }[], label: string) => {
    select.replaceChildren(new Option(label, ''), ...entries.map(entry => new Option(entry.name, entry.id)));
  };
  async function chooseCamera() {
    const current = ++revision;
    await clearMedia('Đang kết nối camera…');
    if (disposed || current !== revision) return;
    const camera = cameras.find(camera => camera.id === choices.value);
    reconnect.disabled = !camera;
    const badge = host.querySelector<HTMLElement>('#camera-kind')!;
    badge.hidden = !camera;
    host.querySelector('#camera-name')!.textContent = camera?.name ?? 'Chưa chọn camera';
    host.querySelector('#camera-source')!.textContent = camera?.source ?? '';
    if (!camera) { placeholder.textContent = 'Chọn camera trên tuyến đường.'; report('Chọn camera để bắt đầu quan sát.'); return; }
    if (!/^\/api\/cameras\/[a-z0-9-]+\/(snapshot|stream)$/.test(camera.mediaPath)) { report('Đường dẫn camera không hợp lệ.', true); return; }
    badge.textContent = camera.kind === 'demo' ? 'DEMO · Không phải camera thật' : camera.kind === 'mjpeg' ? 'Luồng MJPEG' : `Ảnh mỗi ${camera.refreshSeconds}s`;
    stop.disabled = false;
    if (camera.kind === 'mjpeg') {
      report('Đang mở luồng camera. Mỗi phiên xem tối đa 60 giây.');
      picture.alt = camera.name;
      picture.onload = () => { if (current !== revision || disposed) return; picture.hidden = false; placeholder.hidden = true; report('Đã nhận hình từ luồng MJPEG.'); time.textContent = 'Nguồn không cung cấp thời gian ghi hình đã xác minh.'; };
      picture.onerror = () => { if (current !== revision || disposed) return; clearMedia('Camera ngoại tuyến hoặc luồng đã kết thúc.'); report('Không xem được luồng. Nhấn Kết nối lại để thử lại.', true); };
      picture.src = `${camera.mediaPath}?t=${Date.now()}`;
      timer = setTimeout(() => { if (current !== revision) return; clearMedia('Phiên xem đã kết thúc.'); report('Nhấn Kết nối lại để mở phiên xem mới.'); }, 60000);
      return;
    }
    const update = async () => {
      if (disposed || current !== revision || !panel.open) return;
      const pending = new AbortController(); controller = pending;
      const timeout = setTimeout(() => pending.abort(), 12000);
      try {
        const response = await fetch(`${camera.mediaPath}?t=${Date.now()}`, { credentials: 'include', signal: pending.signal, cache: 'no-store' });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Camera hiện không khả dụng.');
        }
        const blob = await response.blob();
        if (disposed || current !== revision) return;
        const nextUrl = URL.createObjectURL(blob);
        const decoded = new Image(); decoded.src = nextUrl;
        try { await decoded.decode(); } catch { URL.revokeObjectURL(nextUrl); throw new Error('Nguồn camera không trả về ảnh hợp lệ.'); }
        if (disposed || current !== revision) { URL.revokeObjectURL(nextUrl); return; }
        if (blobUrl) URL.revokeObjectURL(blobUrl); blobUrl = nextUrl;
        picture.src = blobUrl; picture.alt = camera.name; picture.hidden = false; placeholder.hidden = true; stop.disabled = false;
        time.textContent = `Nhận ảnh: ${new Date(response.headers.get('X-Camera-Received-At') || Date.now()).toLocaleTimeString('vi-VN')}`;
        report(camera.kind === 'demo' ? 'Đang xem hình mô phỏng cục bộ. Chưa kết nối camera Hà Nội / iHanoi.' : 'Đã nhận ảnh từ nguồn được cấu hình.');
        timer = setTimeout(() => { void update(); }, camera.refreshSeconds * 1000);
      } catch (error) {
        if (disposed || current !== revision) return;
        clearMedia('Không có hình ảnh camera.'); report((error as Error).message, true);
      } finally { clearTimeout(timeout); }
    };
    void update();
  }
  roads.onchange = async () => {
    const current = ++revision; clearMedia('Chọn camera trên tuyến đường.'); cameras = [];
    choices.disabled = true; reconnect.disabled = true;
    options(choices, [], roads.value ? 'Đang tải camera…' : 'Chọn tuyến đường trước');
    host.querySelector('#camera-name')!.textContent = 'Chưa chọn camera'; host.querySelector('#camera-source')!.textContent = ''; host.querySelector<HTMLElement>('#camera-kind')!.hidden = true;
    if (!roads.value) return;
    try {
      const data = await api(`/api/cameras/roads/${roads.value}/cameras`);
      if (disposed || current !== revision) return;
      cameras = data.cameras; options(choices, cameras, cameras.length ? 'Chọn camera' : 'Tuyến đường chưa có camera');
      choices.disabled = !cameras.length; report(`${cameras.length} camera trên tuyến ${data.road.name}.`);
    } catch (error) { if (!disposed && current === revision) { options(choices, [], 'Không tải được camera'); report((error as Error).message, true); } }
  };
  choices.onchange = () => { void chooseCamera(); };
  reconnect.onclick = () => { void chooseCamera(); };
  stop.onclick = () => { revision++; clearMedia('Đã dừng xem camera.'); report('Đã dừng. Nhấn Kết nối lại để xem tiếp.'); };
  const pause = () => {
    revision++; clearMedia('Đã tạm dừng khi rời màn hình.');
    report('Đã tạm dừng camera. Nhấn Kết nối lại để xem tiếp.');
  };
  const visibility = () => { if (document.hidden) pause(); };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('traffic-camera-paused', pause);
  window.addEventListener('pagehide', pause);
  panel.ontoggle = () => { if (panel.open && choices.value) void chooseCamera(); else if (!panel.open) { revision++; clearMedia('Đã đóng màn hình quan sát.'); } };
  void api('/api/cameras/roads').then(data => {
    if (disposed) return;
    options(roads, data.roads, data.roads.length ? 'Chọn tuyến đường' : 'Chưa cấu hình nguồn camera');
    roads.disabled = !data.roads.length;
    report(data.roads.length ? 'Chọn tuyến đường để xem danh sách camera.' : 'Chưa có nguồn camera. Quản trị viên máy chủ cần cấu hình nguồn được cấp quyền.');
  }).catch(error => { if (!disposed) { options(roads, [], 'Không tải được tuyến đường'); report(error.message, true); } });
  cleanup = () => {
    disposed = true; revision++; clearMedia('');
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('traffic-camera-paused', pause);
    window.removeEventListener('pagehide', pause);
  };
}
