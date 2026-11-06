import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
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
const cookieName = production ? "__Host-parking_session" : "parking_session";
const cookieOptions = {
  httpOnly: true,
  secure: production,
  sameSite: "lax" as const,
  path: "/",
};
function sessionToken(req: Request) {
  const value = req.headers.cookie
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
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
app.post("/api/auth/forgot-password", limiter, async (req, res) => {
  const { email } = req.body ?? {};
  if (!validEmail(email)) {
    res.status(400).json({ message: "Vui lòng nhập email hợp lệ." });
    return;
  }
  const { rows } = await pool.query(
    "SELECT id,email FROM users WHERE email=$1 AND active=true",
    [email.trim().toLowerCase()],
  );
  if (rows[0]) {
    const token = newToken();
    await pool.query(
      "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
      [digest(token), rows[0].id],
    );
    const url = new URL("/reset-password", appUrl);
    url.searchParams.set("token", token);
    try {
      if (mail)
        await mail.sendMail({
          from: process.env.SMTP_FROM,
          to: rows[0].email,
          subject: "Đặt lại mật khẩu Smart Parking",
          text: `Mở liên kết để đặt lại mật khẩu (hết hạn sau 15 phút): ${url}\nNếu bạn không yêu cầu, hãy bỏ qua email này.`,
        });
      else console.log("Development password reset link:", url.toString());
    } catch {
      await pool.query("DELETE FROM password_resets WHERE token_hash=$1", [
        digest(token),
      ]);
      console.error("Password reset email delivery failed.");
    }
  }
  res.json({
    message:
      "Nếu email đã được đăng ký, bạn sẽ nhận được liên kết đặt lại mật khẩu.",
  });
});
app.post("/api/auth/reset-password", limiter, async (req, res) => {
  const { token, password } = req.body ?? {};
  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !validPassword(password)
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
