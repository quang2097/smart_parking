import "./style.css";
type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "employee" | "customer";
};
type Mode = "login" | "forgot" | "otp" | "reset" | "change" | "create" | "account";
let mode: Mode = location.pathname === "/reset-password" ? "reset" : location.pathname === "/change-password" ? "change" : "login";
let user: User | null = null;
let challengeId = "";
let resetToken = new URLSearchParams(location.search).get("token") || "";
// Keep the reset secret out of subsequent URLs and browser referrers.
if (resetToken) history.replaceState(null, "", "/reset-password");
const root = document.querySelector<HTMLDivElement>("#app")!;
const icon = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M9 25V7h8a6 6 0 0 1 0 12h-8m0-7h8a1 1 0 0 1 0 2H9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const arrow = '<span aria-hidden="true">↗</span>';
const roleNames = {
  admin: "Quản trị viên",
  manager: "Quản lý",
  employee: "Nhân viên",
  customer: "Khách hàng",
};
async function api(path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "include",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error(
      "Không thể kết nối máy chủ. Vui lòng kiểm tra kết nối và thử lại.",
    );
  }
  const data =
    response.status === 204
      ? {}
      : await response
          .json()
          .catch(() => ({ message: "Máy chủ trả về phản hồi không hợp lệ." }));
  if (!response.ok)
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
  return `<div class="form-options"><label class="check"><input type="checkbox" id="admin-recovery"> Tôi là quản trị viên</label></div><div id="recovery-identity"><label for="name">Họ và tên</label><input id="name" name="name" autocomplete="name" required maxlength="200" placeholder="Họ tên đã đăng ký"><label for="phone">Số điện thoại</label><input id="phone" name="phone" type="tel" autocomplete="tel" required minlength="7" maxlength="25" placeholder="Số điện thoại liên hệ"><label for="accountId">Mã tài khoản / nhân viên / khách hàng</label><input id="accountId" name="accountId" required maxlength="100" placeholder="Mã tài khoản được cấp"></div>`;
}
function creationFields() {
  return `<label for="name">Họ và tên</label><input id="name" name="name" autocomplete="off" required maxlength="200" placeholder="Họ tên người dùng"><label for="role">Vai trò</label><select id="role" name="role" required><option value="employee">Nhân viên</option>${user?.role === "admin" ? '<option value="manager">Quản lý</option><option value="admin">Quản trị viên</option>' : ""}</select>`;
}
function render() {
  const changing = mode === "reset" || mode === "change";
  const titles = {
    login: "Chào mừng trở lại.",
    forgot: "Quên mật khẩu?",
    otp: "Xác thực người dùng.",
    reset: "Tạo mật khẩu mới.",
    change: "Đổi mật khẩu.",
    create: "Tạo tài khoản.",
    account: "Đăng nhập thành công.",
  };
  const subtitles = {
    login: "Đăng nhập để tiếp tục với Smart Parking.",
    forgot:
      "Nhập email, họ tên, số điện thoại và mã tài khoản để yêu cầu đặt lại mật khẩu. Quản trị viên chỉ cần email.",
    otp: "Nhập mã OTP gồm 6 chữ số được gửi đến email đã đăng ký. Mã có hiệu lực 5 phút và chỉ dùng được một lần.",
    reset: "Chọn mật khẩu mới để bảo vệ tài khoản của bạn.",
    change: "Nhập mật khẩu mới và xác nhận để cập nhật tài khoản.",
    create: "Nhập thông tin đăng nhập và vai trò cho tài khoản mới.",
    account: "Tài khoản của bạn đã sẵn sàng để sử dụng.",
  };
  document.title = `${changing ? "Đổi mật khẩu" : mode === "account" ? "Tài khoản" : "Đăng nhập"} · Smart Parking`;
  root.innerHTML = `<main class="layout"><aside class="story"><a class="brand" href="/">${icon}<span>smart<span class="brand-light">parking</span><sup>®</sup></span></a><div class="story-body"><div class="eyebrow"><span></span> DI CHUYỂN THÔNG MINH HƠN</div><h1>Điểm đỗ an tâm.<br>Hành trình<br><em>thảnh thơi.</em></h1><p>Kết nối bãi đỗ, đơn giản hóa quản lý.<br>Một không gian cho mọi hành trình.</p><div class="parking-art" aria-hidden="true"><div class="lane lane-one"></div><div class="lane lane-two"></div><div class="bay b1"><i></i></div><div class="bay b2"><i></i></div><div class="bay b3"></div><div class="bay b4"><i></i></div><div class="park-sign">P</div><div class="route"></div><div class="art-label"><span>✓</span> Sẵn sàng cho hành trình của bạn</div></div></div><div class="story-foot"><span>THÔNG MINH. AN TOÀN. TIỆN LỢI.</span><span>01 — 03</span></div></aside><section class="content"><div class="top-note">HỆ THỐNG QUẢN LÝ BÃI ĐỖ XE <span>●</span></div><div class="form-wrap"><div class="section-tag">${mode === "account" ? "KẾT NỐI THÀNH CÔNG" : "TÀI KHOẢN CỦA BẠN"}</div><h2>${titles[mode]}</h2><p class="subtitle">${subtitles[mode]}</p><div id="feedback" role="status" aria-live="polite" tabindex="-1" hidden></div>${mode === "account" ? `<div class="account"><div class="avatar">✓</div><h3 id="account-name"></h3><p id="account-email"></p><p id="account-id"></p><span class="role">${user ? roleNames[user.role] : ""}</span><p class="account-note">Bạn đã xác thực thành công vào hệ thống Smart Parking.</p>${user && ["admin", "manager"].includes(user.role) ? `<button class="primary" id="create-user">Tạo tài khoản ${arrow}</button>` : ""}<button class="primary" id="change-password">Đổi mật khẩu ${arrow}</button><button class="primary" id="logout">Đăng xuất ${arrow}</button></div>` : `<form id="auth-form">${mode === "create" ? creationFields() : ""}${!changing && mode !== "otp" ? '<label for="email">Địa chỉ email</label><input id="email" name="email" type="email" autocomplete="username" placeholder="ban@example.com" required maxlength="254">' : ""}${mode === "forgot" ? recoveryFields() : ""}${mode === "otp" ? '<label for="code">Mã OTP qua email</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="Nhập 6 chữ số" required>' : ""}${mode !== "forgot" && mode !== "otp" ? passwordField(changing || mode === "create" ? "Mật khẩu mới" : "Mật khẩu", "password", changing || mode === "create" ? "new-password" : "current-password", changing || mode === "create" ? 12 : 1) : ""}${changing || mode === "create" ? passwordField("Xác nhận mật khẩu", "confirm", "new-password", 12) : ""}${mode === "login" ? '<div class="form-options"><label class="check"><input type="checkbox" name="remember"> Ghi nhớ đăng nhập</label><button type="button" class="text-button" id="forgot">Quên mật khẩu?</button></div>' : ""}<button class="primary" type="submit">${mode === "create" ? "Tạo tài khoản" : mode === "login" ? "Đăng nhập" : mode === "forgot" ? "Gửi mã OTP qua email" : mode === "otp" ? "Xác nhận mã OTP" : "Lưu mật khẩu mới"} ${arrow}</button>${mode !== "login" ? `<button type="button" class="back" id="back">${mode === "change" || mode === "create" ? "← Quay lại tài khoản" : "← Quay lại đăng nhập"}</button>` : ""}</form>${mode === "login" ? '<div class="help"><span class="help-icon">i</span><p>Chưa có tài khoản?<br><span>Liên hệ quản trị viên bãi đỗ để được cấp quyền truy cập.</span></p></div>' : ""}`}</div><footer><span>© ${new Date().getFullYear()} Smart Parking</span><span class="secure"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1 2 3v4c0 4 6 7 6 7s6-3 6-7V3L8 1Z" stroke="currentColor"/><path d="m5 7 2 2 4-4" stroke="currentColor"/></svg> Kết nối được bảo mật</span></footer></section></main>`;
  if (user && mode === "account") {
    document.querySelector("#account-name")!.textContent = user.name;
    document.querySelector("#account-email")!.textContent = user.email;
    document.querySelector("#account-id")!.textContent = `Mã tài khoản: ${user.id}`;
  }
  document.querySelector("#forgot")?.addEventListener("click", () => {
    mode = "forgot";
    render();
  });
  document.querySelector("#create-user")?.addEventListener("click", () => {
    mode = "create";
    render();
  });
  document.querySelector("#change-password")?.addEventListener("click", () => {
    mode = "change";
    history.pushState(null, "", "/change-password");
    render();
  });
  document.querySelector("#back")?.addEventListener("click", () => {
    mode = (mode === "change" || mode === "create") && user ? "account" : "login";
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
      mode = "reset";
      history.replaceState(null, "", "/reset-password");
      render();
    } else {
      const result = await api(mode === "change" ? "change-password" : "reset-password", {
        token: resetToken,
        password,
        confirm: String(data.get("confirm") || ""),
      });
      resetToken = "";
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
      mode = requested === "change" ? "change" : "account";
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
void initialize();
