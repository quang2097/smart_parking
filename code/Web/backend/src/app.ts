import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { randomInt, randomUUID } from "node:crypto";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import nodemailer from "nodemailer";
import { pool } from "./db.js";
import { allowedOrigins } from "./origins.js";
import {
  digest,
  hashPassword,
  newToken,
  validEmail,
  validPassword,
  verifyPassword,
} from "./security.js";

const production = process.env.NODE_ENV === "production";
const appUrl = new URL(process.env.APP_URL || "http://localhost:5173");
const origins = allowedOrigins(appUrl, production);
if (
  production &&
  (appUrl.protocol !== "https:" ||
    !process.env.SMTP_HOST ||
    !process.env.SMTP_FROM)
)
  throw new Error(
    "Production requires HTTPS APP_URL, SMTP_HOST and SMTP_FROM.",
  );
const mail = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_PORT === "465",
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
        : {}),
    })
  : null;
const otpCookieName = production ? "__Host-parking_otp" : "parking_otp";
const cookieName = production ? "__Host-parking_session" : "parking_session";
const cookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/",
};
function sessionToken(req: Request, name = cookieName) {
  const value = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : "";
}
export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: [...origins], credentials: true }));
app.use(express.json({ limit: "8kb" }));
// The Vite frontend owns the login page during local development.
if (!production) {
  app.get("/", (_req, res) => {
    res.redirect(302, appUrl.origin);
  });
}
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use("/api", (req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.headers.origin &&
    !origins.has(req.headers.origin)
  ) {
    res.status(403).json({ message: "Nguồn yêu cầu không hợp lệ." });
    return;
  }
  next();
});
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.",
  },
});
app.post("/api/auth/login", limiter, async (req, res) => {
  const { email, password, remember = false } = req.body ?? {};
  if (
    !validEmail(email) ||
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 128 ||
    typeof remember !== "boolean"
  ) {
    res
      .status(400)
      .json({ message: "Vui lòng nhập email và mật khẩu hợp lệ." });
    return;
  }
  const { rows } = await pool.query(
    "SELECT id,email,name,role,password_hash,active FROM users WHERE email=$1",
    [email.trim().toLowerCase()],
  );
  const user = rows[0];
  const verified = await verifyPassword(
    password,
    user?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`,
  );
  if (!user || !verified || !user.active) {
    res.status(401).json({ message: "Email hoặc mật khẩu không chính xác." });
    return;
  }
  const token = newToken();
  const duration = (remember ? 30 * 24 : 8) * 60 * 60 * 1000;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize login with password reset so an old password cannot create a
    // fresh session after a reset has revoked the existing sessions.
    const current = await client.query(
      "SELECT password_hash,active FROM users WHERE id=$1 FOR UPDATE",
      [user.id],
    );
    if (
      !current.rows[0]?.active ||
      current.rows[0].password_hash !== user.password_hash
    ) {
      await client.query("ROLLBACK");
      res.status(401).json({ message: "Email hoặc mật khẩu không chính xác." });
      return;
    }
    await client.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
      [digest(token), user.id, new Date(Date.now() + duration)],
    );
    const previous = sessionToken(req);
    if (previous)
      await client.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(previous),
      ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  res.cookie(cookieName, token, {
    ...cookieOptions,
    ...(remember ? { maxAge: duration } : {}),
  });
  res.json({
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});
app.get("/api/auth/me", async (req, res) => {
  const token = sessionToken(req);
  if (!token) {
    res.status(401).json({ message: "Vui lòng đăng nhập." });
    return;
  }
  const { rows } = await pool.query(
    "SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true",
    [digest(token)],
  );
  if (!rows[0]) {
    res.clearCookie(cookieName, cookieOptions);
    res.status(401).json({ message: "Phiên đăng nhập đã hết hạn." });
    return;
  }
  res.json({ user: rows[0] });
});
app.post("/api/auth/logout", async (req, res) => {
  const token = sessionToken(req);
  if (token)
    await pool.query("DELETE FROM sessions WHERE token_hash=$1", [
      digest(token),
    ]);
  res.clearCookie(cookieName, cookieOptions).status(204).end();
});
app.post("/api/auth/users", limiter, async (req, res) => {
  const token = sessionToken(req);
  if (!token) {
    res.status(401).json({ message: "Vui lòng đăng nhập." });
    return;
  }
  const { name, email, password, confirm, role } = req.body ?? {};
  if (typeof name !== "string" || !name.trim() || name.length > 200 || !validEmail(email) || !validPassword(password) || password !== confirm || !["admin", "manager", "employee"].includes(role)) {
    res.status(400).json({ message: "Vui lòng nhập họ tên, email, vai trò và mật khẩu hợp lệ (12–128 ký tự), xác nhận phải khớp." });
    return;
  }
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT u.id,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true FOR UPDATE OF u", [digest(token)]);
    const session = await client.query("SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()", [digest(token)]);
    const actor = rows[0];
    if (!actor || session.rows[0]?.user_id !== actor.id) {
      await client.query("ROLLBACK");
      res.status(401).json({ message: "Phiên đăng nhập đã hết hạn." });
      return;
    }
    if (!(actor.role === "admin" || (actor.role === "manager" && role === "employee"))) {
      await client.query("ROLLBACK");
      res.status(403).json({ message: "Bạn không có quyền tạo tài khoản với vai trò này." });
      return;
    }
    const created = await client.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING id,email,name,role", [randomUUID(), email.trim().toLowerCase(), name.trim(), role, hash]);
    await client.query("COMMIT");
    if (!created.rows[0]) {
      res.status(409).json({ message: "Email đã được sử dụng. Vui lòng chọn email khác." });
      return;
    }
    res.status(201).json({ user: created.rows[0], message: "Đã tạo tài khoản thành công." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});
app.post("/api/auth/forgot-password", limiter, async (req, res) => {
  const { email, name, phone, accountId } = req.body ?? {};
  if (!validEmail(email)) {
    res.status(400).json({ message: "Vui lòng nhập email hợp lệ." });
    return;
  }
  const { rows } = await pool.query(
    "SELECT id,email,name,role FROM users WHERE email=$1 AND active=true",
    [email.trim().toLowerCase()],
  );
  const user = rows[0];
  const identityValid =
    typeof name === "string" && name.trim().length > 0 && name.length <= 200 &&
    typeof phone === "string" && /^[+\d][\d ().-]{6,24}$/.test(phone.trim()) &&
    typeof accountId === "string" && accountId.trim().length > 0 && accountId.length <= 100;
  // A client-side admin checkbox never grants the exemption.
  if (user?.role !== "admin" && !identityValid) {
    res.status(400).json({ message: "Vui lòng nhập họ tên, số điện thoại và mã tài khoản hợp lệ. Quản trị viên được miễn các thông tin này." });
    return;
  }
  const identityMatches = user && identityValid &&
    name.trim().normalize("NFC").toLocaleLowerCase("vi") === user.name.trim().normalize("NFC").toLocaleLowerCase("vi") &&
    accountId.trim().toLowerCase() === user.id.toLowerCase();
  let challenge = newToken();
  let challengeId = digest(challenge);
  if (user && (user.role === "admin" || identityMatches)) {
    const code = String(randomInt(1000000)).padStart(6, "0");
    const client = await pool.connect();
    let issued = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user.id]);
      const recent = await client.query("SELECT challenge_hash FROM email_otps WHERE user_id=$1 AND created_at>now()-interval '60 seconds'", [user.id]);
      const previous = sessionToken(req, otpCookieName);
      if (previous && recent.rows[0]?.challenge_hash === digest(previous)) {
        challenge = previous;
        challengeId = digest(previous);
      }
      if (!recent.rows[0]) {
        await client.query("DELETE FROM email_otps WHERE user_id=$1", [user.id]);
        await client.query(
          "INSERT INTO email_otps(challenge_hash,user_id,code_hash,expires_at,request_name,request_phone,request_account_id) VALUES($1,$2,$3,now()+interval '5 minutes',$4,$5,$6)",
          [challengeId, user.id, digest(challenge + code), user.role === "admin" ? null : name.trim(), user.role === "admin" ? null : phone.trim(), user.role === "admin" ? null : accountId.trim()],
        );
        issued = true;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    if (issued) {
      try {
        if (mail) await mail.sendMail({
          from: process.env.SMTP_FROM, to: user.email,
          subject: "Mã xác thực Smart Parking",
          text: `Mã OTP của bạn: ${code}. Mã hết hạn sau 5 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
        });
        else console.log("Development email OTP:", code);
      } catch {
        await pool.query("DELETE FROM email_otps WHERE challenge_hash=$1", [challengeId]);
        console.error("OTP email delivery failed.");
      }
    }
  }
  res.cookie(otpCookieName, challenge, { ...cookieOptions, maxAge: 5 * 60 * 1000 }).json({
    challengeId,
    message: "Nếu thông tin khớp với tài khoản, mã OTP sẽ được gửi đến email đã đăng ký. Mã có hiệu lực 5 phút. Chờ 60 giây trước khi yêu cầu mã mới.",
  });
});
app.post("/api/auth/verify-otp", limiter, async (req, res) => {
  const { challengeId, code } = req.body ?? {};
  const challenge = sessionToken(req, otpCookieName);
  if (!challenge || challengeId !== digest(challenge) || typeof code !== "string" || !/^\d{6}$/.test(code)) {
    res.status(400).json({ message: "Mã OTP không hợp lệ hoặc đã hết hạn." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const owner = await client.query("SELECT user_id FROM email_otps WHERE challenge_hash=$1", [challengeId]);
    if (owner.rows[0]) await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [owner.rows[0].user_id]);
    const { rows } = await client.query("SELECT * FROM email_otps WHERE challenge_hash=$1 AND expires_at>now() AND attempts<5 FOR UPDATE", [challengeId]);
    const otp = rows[0];
    if (!otp || otp.code_hash !== digest(challenge + code)) {
      if (otp) await client.query("UPDATE email_otps SET attempts=attempts+1 WHERE challenge_hash=$1", [challengeId]);
      await client.query("COMMIT");
      res.status(400).json({ message: "Mã OTP không hợp lệ hoặc đã hết hạn." });
      return;
    }
    const active = await client.query("SELECT active FROM users WHERE id=$1", [otp.user_id]);
    if (!active.rows[0]?.active) {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "Mã OTP không hợp lệ hoặc đã hết hạn." });
      return;
    }
    const token = newToken();
    await client.query("INSERT INTO password_resets(token_hash,user_id,expires_at,request_name,request_phone,request_account_id) VALUES($1,$2,now()+interval '15 minutes',$3,$4,$5)", [digest(token), otp.user_id, otp.request_name, otp.request_phone, otp.request_account_id]);
    await client.query("DELETE FROM email_otps WHERE challenge_hash=$1", [challengeId]);
    await client.query("COMMIT");
    res.clearCookie(otpCookieName, cookieOptions).json({ token });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});
app.post("/api/auth/verify-reset", limiter, async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) {
    res.status(400).json({ message: "Liên kết không hợp lệ." });
    return;
  }
  const { rows } = await pool.query(
    "SELECT u.id FROM password_resets r JOIN users u ON u.id=r.user_id WHERE r.token_hash=$1 AND r.expires_at>now() AND u.active=true",
    [digest(token)],
  );
  if (!rows[0]) {
    res.status(400).json({ message: "Liên kết đã hết hạn hoặc đã được sử dụng." });
    return;
  }
  res.json({ verified: true });
});
app.post("/api/auth/change-password", limiter, async (req, res) => {
  const token = sessionToken(req);
  if (!token) {
    res.status(401).json({ message: "Vui lòng đăng nhập." });
    return;
  }
  const { password, confirm } = req.body ?? {};
  if (!validPassword(password) || password !== confirm) {
    res.status(400).json({ message: "Mật khẩu phải có 12–128 ký tự và xác nhận phải khớp." });
    return;
  }
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true FOR UPDATE OF u",
      [digest(token)],
    );
    // Recheck after acquiring the user lock: a concurrent reset may have
    // revoked this session while this transaction was waiting.
    const session = await client.query(
      "SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()",
      [digest(token)],
    );
    if (!rows[0] || session.rows[0]?.user_id !== rows[0].id) {
      await client.query("ROLLBACK");
      res.clearCookie(cookieName, cookieOptions).status(401).json({ message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
      return;
    }
    await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, rows[0].id]);
    await client.query("DELETE FROM sessions WHERE user_id=$1", [rows[0].id]);
    await client.query("DELETE FROM email_otps WHERE user_id=$1", [rows[0].id]);
    await client.query("DELETE FROM password_resets WHERE user_id=$1", [rows[0].id]);
    await client.query("COMMIT");
    res.clearCookie(cookieName, cookieOptions).json({ message: "Đã đổi mật khẩu. Vui lòng đăng nhập bằng mật khẩu mới." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.post("/api/auth/reset-password", limiter, async (req, res) => {
  const { token, password, confirm } = req.body ?? {};
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !validPassword(password) || password !== confirm
  ) {
    res.status(400).json({
      message: "Liên kết không hợp lệ hoặc mật khẩu phải có 12–128 ký tự.",
    });
    return;
  }
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT u.id FROM users u JOIN password_resets r ON r.user_id=u.id WHERE r.token_hash=$1 AND r.expires_at>now() AND u.active=true FOR UPDATE OF u",
      [digest(token)],
    );
    const reset = await client.query(
      "DELETE FROM password_resets WHERE token_hash=$1 AND expires_at>now() RETURNING user_id",
      [digest(token)],
    );
    if (!rows[0] || !reset.rows[0]) {
      await client.query("ROLLBACK");
      res
        .status(400)
        .json({ message: "Liên kết đã hết hạn hoặc đã được sử dụng." });
      return;
    }
    await client.query("UPDATE users SET password_hash=$1 WHERE id=$2", [
      hash,
      rows[0].id,
    ]);
    await client.query("DELETE FROM sessions WHERE user_id=$1", [rows[0].id]);
    await client.query("DELETE FROM email_otps WHERE user_id=$1", [rows[0].id]);
    await client.query("DELETE FROM password_resets WHERE user_id=$1", [
      rows[0].id,
    ]);
    await client.query("COMMIT");
    res
      .clearCookie(cookieName, cookieOptions)
      .json({ message: "Đã đặt lại mật khẩu. Vui lòng đăng nhập." });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});
app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof SyntaxError) {
    res.status(400).json({ message: "Dữ liệu không hợp lệ." });
    return;
  }
  console.error(
    "Request failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  res.status(503).json({
    message: "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại sau.",
  });
});
