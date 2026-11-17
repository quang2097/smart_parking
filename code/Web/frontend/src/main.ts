import "./style.css";
import { mountDashboard, stopDashboard } from "./traffic";
import { request, mountConnection } from "./connection";
import { mountCameraViewer, stopCameraViewer } from './cameras';
import { mountRecovery } from './recovery';
type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "user";
};
type Mode = "login" | "forgot" | "otp" | "reset" | "change" | "create" | "account";
let mode: Mode = location.pathname === "/reset-password" ? "reset" : location.pathname === "/change-password" ? "change" : "login";
let user: User | null = null;
let challengeId = "";
let changingAccount = false;
let resetToken = new URLSearchParams(location.search).get("token") || "";
// Keep the reset secret out of subsequent URLs and browser referrers.
if (resetToken) history.replaceState(null, "", "/reset-password");
const root = document.querySelector<HTMLDivElement>("#app")!;
const icon = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="10" y="3" width="12" height="23" rx="5" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="9" r="2" fill="currentColor"/><circle cx="16" cy="15" r="2" fill="currentColor"/><circle cx="16" cy="21" r="2" fill="currentColor"/><path d="M16 26v5" stroke="currentColor" stroke-width="2"/></svg>`;
const arrow = '<span aria-hidden="true">↗</span>';
const roleNames = {
  admin: "Quản trị viên",
  user: "Người dùng",
};
async function api(path: string, body?: unknown) {
  let response: { status: number; data: any };
  try {
    response = await request(path.startsWith("/") ? path : `/api/auth/${path}`, body);
  } catch {
    throw new Error(
      "Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối và thử lại.",
    );
  }
  const data = response.status === 204 ? {} : response.data;
  if (response.status < 200 || response.status >= 300)
    throw Object.assign(
      new Error(data.message || "Có lỗi xảy ra. Vui lòng thử lại."),
      { status: response.status },
    );
  return data;
}
function passwordField(
  label: string,
  id: string,
  autocomplete: string,
  min = 1,
) {
  return `<label for="${id}">${label}</label><div class="password"><input id="${id}" name="${id}" type="password" autocomplete="${autocomplete}" placeholder="${min === 12 ? "Tối thiểu 12 ký tự" : "Nhập mật khẩu của bạn"}" required minlength="${min}" maxlength="128"><button type="button" class="reveal" aria-label="Hiện mật khẩu" aria-pressed="false" data-for="${id}">Hiện</button></div>`;
}
function recoveryFields() {
  return `<div class="form-options"><label class="check"><input type="checkbox" id="admin-recovery"> Tôi là quản trị viên</label></div><div id="recovery-identity"><label for="name">Họ và tên</label><input id="name" name="name" autocomplete="name" required maxlength="200" placeholder="Họ tên đã đăng ký"><label for="phone">Số điện thoại</label><input id="phone" name="phone" type="tel" autocomplete="tel" required minlength="7" maxlength="25" placeholder="Số điện thoại liên hệ"><label for="accountId">Mã tài khoản</label><input id="accountId" name="accountId" required maxlength="100" placeholder="Mã tài khoản được cấp"></div>`;
}
function creationFields() {
  return `<label for="name">Họ và tên</label><input id="name" name="name" autocomplete="off" required maxlength="200" placeholder="Họ tên người dùng"><label for="role">Vai trò</label><select id="role" name="role" required><option value="user">Người dùng</option><option value="admin">Quản trị viên</option></select>`;
}
function render() {
  stopDashboard();
  stopCameraViewer();
  const changing = mode === "reset" || mode === "change";
  const titles = {
    login: "Chào mừng trở lại.",
    forgot: "Quên mật khẩu?",
    otp: "Xác thực người dùng.",
    reset: "Tạo mật khẩu mới.",
    change: "Đổi mật khẩu.",
    create: "Tạo tài khoản.",
    account: "Trung tâm điều khiển.",
  };
  const subtitles = {
    login: "Đăng nhập để tiếp tục với Smart Traffic.",
    forgot:
      "Nhập email, họ tên, số điện thoại và mã tài khoản để yêu cầu đặt lại mật khẩu. Quản trị viên chỉ cần email.",
    otp: "Nhập mã OTP gồm 6 chữ số được gửi đến email đã đăng ký. Mã có hiệu lực 5 phút và chỉ dùng được một lần.",
    reset: "Chọn mật khẩu mới để bảo vệ tài khoản của bạn.",
    change: "Nhập mật khẩu mới và xác nhận để cập nhật tài khoản.",
    create: "Nhập thông tin đăng nhập và vai trò cho tài khoản mới.",
    account: "Giám sát và cấu hình tín hiệu tại các nút giao.",
  };
  if (changingAccount && mode === 'forgot') {
    titles.forgot = 'Xác thực trước khi đổi mật khẩu.';
    subtitles.forgot = 'Xác thực bằng OTP gửi đến email của bạn trước khi nhập mật khẩu mới.';
  }
  document.title = `${changing ? "Đổi mật khẩu" : mode === "account" ? "Tài khoản" : "Đăng nhập"} · Smart Traffic`;
  root.innerHTML = `<main class="layout"><aside class="story"><a class="brand" href="/">${icon}<span>smart<span class="brand-light">traffic</span><sup>®</sup></span></a><div class="story-body"><div class="eyebrow"><span></span> DI CHUYỂN THÔNG MINH HƠN</div><h1>Nhịp đèn thông minh.<br>Giao thông<br><em>thông suốt.</em></h1><p>Giám sát nút giao, điều phối tín hiệu.<br>Một hệ thống cho những hành trình an toàn.</p><div class="signal-art" aria-hidden="true"><i></i><i></i><i></i></div></div><div class="story-foot"><span>THÔNG MINH. AN TOÀN. TIỆN LỢI.</span><span>01 — 03</span></div></aside><section class="content"><div class="top-note">ĐIỀU KHIỂN ĐÈN GIAO THÔNG <span>●</span></div><div class="form-wrap"><div class="section-tag">${mode === "account" ? "KẾT NỐI THÀNH CÔNG" : "TÀI KHOẢN CỦA BẠN"}</div><h2>${titles[mode]}</h2><p class="subtitle">${subtitles[mode]}</p><div id="feedback" role="status" aria-live="polite" tabindex="-1" hidden></div>${mode === "account" ? `<div class="account"><div class="avatar">✓</div><h3 id="account-name"></h3><p id="account-email"></p><p id="account-id"></p><span class="role">${user ? roleNames[user.role] : ""}</span><p class="account-note">Bạn đã xác thực thành công vào hệ thống Smart Traffic.</p>${user && user.role === "admin" ? `<button class="primary" id="create-user">Tạo tài khoản ${arrow}</button>` : ""}<button class="primary" id="change-password">Đổi mật khẩu ${arrow}</button><button class="primary" id="logout">Đăng xuất ${arrow}</button></div>` : `<form id="auth-form">${mode === "create" ? creationFields() : ""}${!changing && mode !== "otp" ? '<label for="email">Địa chỉ email</label><input id="email" name="email" type="email" autocomplete="username" placeholder="ban@example.com" required maxlength="254">' : ""}${mode === "forgot" ? recoveryFields() : ""}${mode === "otp" ? '<label for="code">Mã OTP qua email</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="Nhập 6 chữ số" required>' : ""}${mode !== "forgot" && mode !== "otp" ? passwordField(changing || mode === "create" ? "Mật khẩu mới" : "Mật khẩu", "password", changing || mode === "create" ? "new-password" : "current-password", changing || mode === "create" ? 12 : 1) : ""}${changing || mode === "create" ? passwordField("Xác nhận mật khẩu", "confirm", "new-password", 12) : ""}${mode === "login" ? '<div class="form-options"><label class="check"><input type="checkbox" name="remember"> Ghi nhớ đăng nhập</label><button type="button" class="text-button" id="forgot">Quên mật khẩu?</button></div>' : ""}<button class="primary" type="submit">${mode === "create" ? "Tạo tài khoản" : mode === "login" ? "Đăng nhập" : mode === "forgot" ? "Gửi mã OTP qua email" : mode === "otp" ? "Xác nhận mã OTP" : "Lưu mật khẩu mới"} ${arrow}</button>${mode !== "login" ? `<button type="button" class="back" id="back">${mode === "change" || mode === "create" ? "← Quay lại tài khoản" : "← Quay lại đăng nhập"}</button>` : ""}</form>${mode === "login" ? '<div class="help"><span class="help-icon">i</span><p>Chưa có tài khoản?<br><span>Liên hệ quản trị viên hệ thống để được cấp quyền truy cập.</span></p></div>' : ""}`}</div><footer><span>© ${new Date().getFullYear()} Smart Traffic</span><span class="secure"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1 2 3v4c0 4 6 7 6 7s6-3 6-7V3L8 1Z" stroke="currentColor"/><path d="m5 7 2 2 4-4" stroke="currentColor"/></svg> Kết nối được bảo mật</span></footer></section></main>`;
  if (user && mode === "account") {
    root.querySelector(".layout")!.classList.add("dashboard-layout");
    root.querySelector(".account")!.insertAdjacentHTML("afterend", '<section id="traffic-dashboard" aria-label="Điều khiển giao thông"></section>');
    mountDashboard(document.querySelector("#traffic-dashboard")!, user.role, api);
    root.querySelector('.account')!.insertAdjacentHTML('afterend', '<section id="camera-observation" aria-label="Quan sát giao thông Hà Nội"></section>');
    mountCameraViewer(root.querySelector('#camera-observation')!, api);
    document.querySelector("#account-name")!.textContent = user.name;
    document.querySelector("#account-email")!.textContent = user.email;
    document.querySelector("#account-id")!.textContent = `Mã tài khoản: ${user.id}`;
  }
  document.querySelector("#forgot")?.addEventListener("click", () => {
    changingAccount = false;
    mode = "forgot";
    render();
  });
  document.querySelector("#create-user")?.addEventListener("click", () => {
    mode = "create";
    render();
  });
  document.querySelector("#change-password")?.addEventListener("click", () => {
    changingAccount = true;
    mode = "forgot";
    history.pushState(null, "", "/change-password");
    render();
  });
  document.querySelector("#back")?.addEventListener("click", () => {
    mode = (mode === "change" || mode === "create" || changingAccount) && user ? "account" : "login";
    changingAccount = false;
    challengeId = '';
    resetToken = "";
    history.replaceState(null, "", "/");
    render();
  });
  document.querySelectorAll<HTMLButtonElement>(".reveal").forEach((button) =>
    button.addEventListener("click", () => {
      const input = document.getElementById(
        button.dataset.for!,
      ) as HTMLInputElement;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "Ẩn" : "Hiện";
      button.setAttribute("aria-pressed", String(show));
      button.setAttribute("aria-label", show ? "Ẩn mật khẩu" : "Hiện mật khẩu");
    }),
  );
  document.querySelector<HTMLInputElement>("#admin-recovery")?.addEventListener("change", (event) => {
    const exempt = (event.currentTarget as HTMLInputElement).checked;
    const fields = document.querySelector<HTMLDivElement>("#recovery-identity")!;
    fields.hidden = exempt;
    fields.querySelectorAll("input").forEach((input) => {
      input.disabled = exempt;
      input.required = !exempt;
    });
  });
  document.querySelector("#auth-form")?.addEventListener("submit", submit);
  mountRecovery(root, mode === 'account' ? user?.role ?? null : null, api, mode === 'forgot' && !changingAccount);
  if (changingAccount && mode === 'forgot' && user) {
    document.querySelector('#back')!.textContent = '← Quay lại tài khoản';
    for (const [key, value] of Object.entries({ email: user.email, name: user.name, accountId: user.id })) {
      document.querySelector<HTMLInputElement>(`[name="${key}"]`)!.value = value;
    }
    if (user.role === 'admin') {
      const checkbox = document.querySelector<HTMLInputElement>('#admin-recovery')!;
      checkbox.checked = true; checkbox.dispatchEvent(new Event('change'));
    }
  }
  document
    .querySelector<HTMLButtonElement>("#logout")
    ?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      try {
        await api("logout", {});
        user = null;
        mode = "login";
        render();
      } catch (error) {
        feedback((error as Error).message, true);
        button.disabled = false;
      }
    });
}
function feedback(message: string, error = false) {
  const el = document.querySelector<HTMLDivElement>("#feedback")!;
  el.hidden = false;
  el.className = error ? "error" : "success";
  el.setAttribute("role", error ? "alert" : "status");
  el.textContent = message;
  el.focus();
}
async function submit(event: Event) {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const data = new FormData(form);
  const button = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  const password = String(data.get("password") || "");
  if ((mode === "reset" || mode === "change" || mode === "create") && password !== data.get("confirm")) {
    feedback("Mật khẩu xác nhận không khớp.", true);
    return;
  }
  button.disabled = true;
  button.textContent = "Đang xử lý…";
  form.setAttribute("aria-busy", "true");
  try {
    if (mode === "create") {
      const result = await api("users", {
        name: String(data.get("name") || "").trim(),
        email: String(data.get("email") || "").trim(),
        role: String(data.get("role") || ""),
        password, confirm: String(data.get("confirm") || ""),
      });
      mode = "account";
      render();
      feedback(`${result.message} Mã tài khoản: ${result.user.id}`);
    } else if (mode === "login") {
      const result = await api("login", {
        email: String(data.get("email")).trim(),
        password,
        remember: data.get("remember") === "on",
      });
      user = result.user;
      mode = "account";
      render();
    } else if (mode === "forgot") {
      const result = await api("forgot-password", {
        email: String(data.get("email")).trim(),
        name: String(data.get("name") || "").trim(),
        phone: String(data.get("phone") || "").trim(),
        accountId: String(data.get("accountId") || "").trim(),
      });
      challengeId = result.challengeId;
      mode = "otp";
      render();
      feedback(result.message);
    } else if (mode === "otp") {
      const result = await api("verify-otp", { challengeId, code: String(data.get("code") || "") });
      resetToken = result.token;
      challengeId = "";
      mode = changingAccount ? 'change' : 'reset';
      history.replaceState(null, "", changingAccount ? '/change-password' : '/reset-password');
      render();
    } else {
      const result = await api(mode === "change" ? "change-password" : "reset-password", {
        token: resetToken,
        password,
        confirm: String(data.get("confirm") || ""),
      });
      resetToken = "";
      changingAccount = false;
      user = null;
      mode = "login";
      history.replaceState(null, "", "/");
      render();
      feedback(result.message);
    }
  } catch (error) {
    feedback((error as Error).message, true);
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = `${mode === "create" ? "Tạo tài khoản" : mode === "login" ? "Đăng nhập" : mode === "forgot" ? "Gửi mã OTP qua email" : mode === "otp" ? "Xác nhận mã OTP" : "Lưu mật khẩu mới"} ${arrow}`;
      form.removeAttribute("aria-busy");
    }
  }
}
async function initialize() {
  root.innerHTML = '<main class="content"><p role="status">Đang kiểm tra phiên xác thực…</p></main>';
  const requested = mode;
  try {
    if (requested === "reset") {
      await api("verify-reset", { token: resetToken });
    } else {
      const result = await api("me");
      user = result.user;
      changingAccount = requested === 'change';
      mode = requested === "change" ? "forgot" : "account";
    }
    render();
  } catch (error) {
    mode = "login";
    resetToken = "";
    history.replaceState(null, "", "/");
    render();
    if (requested !== "login" || (error as { status?: number }).status !== 401)
      feedback((error as Error).message, true);
  }
}
mountConnection();
void initialize();
