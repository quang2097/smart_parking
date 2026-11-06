import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { pool } from "./db.js";
import { hashPassword, digest, newToken } from "./security.js";

test("PostgreSQL authentication lifecycle", async () => {
  const id = randomUUID(),
    email = `auth-test-${id}@example.com`,
    password = "Integration password 2026!";
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/auth/`;
  const request = (
    path: string,
    body?: unknown,
    cookie = "",
    origin = "http://localhost:5173",
  ) =>
    fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: origin,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const login = async (pass = password, remember = false) =>
    request("login", { email, password: pass, remember });
  try {
    await pool.query(
      "INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5)",
      [id, email, "Integration test", "staff", await hashPassword(password)],
    );
    assert.equal((await request("me")).status, 401);
    const recovery = { email, name: "Integration test", phone: "0901234567", accountId: id };
    assert.equal((await request("forgot-password", { email, role: "admin" })).status, 400);
    assert.equal((await request("forgot-password", { ...recovery, phone: "bad" })).status, 400);
    assert.equal((await request("forgot-password", { ...recovery, accountId: randomUUID() })).status, 200);
    assert.equal((await pool.query("SELECT * FROM password_resets WHERE user_id=$1", [id])).rowCount, 0);
    assert.equal((await request("forgot-password", recovery)).status, 200);
    const recoveryRow = (await pool.query("SELECT request_name,request_phone,request_account_id FROM password_resets WHERE user_id=$1", [id])).rows[0];
    assert.deepEqual(recoveryRow, { request_name: recovery.name, request_phone: recovery.phone, request_account_id: id });
    await pool.query("DELETE FROM password_resets WHERE user_id=$1", [id]);
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [id]);
    assert.equal((await request("forgot-password", { email })).status, 200);
    assert.equal((await pool.query("SELECT request_phone FROM password_resets WHERE user_id=$1", [id])).rows[0].request_phone, null);
    await pool.query("DELETE FROM password_resets WHERE user_id=$1", [id]);
    await pool.query("UPDATE users SET role='staff' WHERE id=$1", [id]);
    assert.equal((await login("wrong password")).status, 401);
    assert.equal(
      (await request("login", { email: "' OR 1=1 --", password })).status,
      400,
    );
    const logged = await login();
    assert.equal(logged.status, 200);
    const setCookie = logged.headers.get("set-cookie")!;
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.doesNotMatch(setCookie, /Max-Age/i);
    const cookie = setCookie.split(";")[0]!;
    const publicData = await logged.json();
    assert.equal(publicData.user.role, "staff");
    assert.equal(publicData.user.password_hash, undefined);
    assert.equal((await request("me", undefined, cookie)).status, 200);
    const remembered = await request(
      "login",
      { email, password, remember: true },
      "",
      "http://127.0.0.1:5173",
    );
    assert.equal(remembered.status, 200);
    assert.equal(
      remembered.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:5173",
    );
    assert.match(remembered.headers.get("set-cookie")!, /Max-Age=2592000/);
    const rememberCookie = remembered.headers.get("set-cookie")!.split(";")[0]!;
    const token = newToken();
    await pool.query(
      "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')",
      [digest(token), id],
    );
    const newPassword = "Changed integration password!";
    assert.equal(
      (await request("reset-password", { token, password: newPassword }))
        .status,
      200,
    );
    assert.equal(
      (await request("reset-password", { token, password: newPassword }))
        .status,
      400,
    );
    assert.equal((await request("me", undefined, cookie)).status, 401);
    assert.equal((await request("me", undefined, rememberCookie)).status, 401);
    assert.equal((await login()).status, 401);
    const next = await login(newPassword);
    assert.equal(next.status, 200);
    const nextCookie = next.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await request("logout", {}, nextCookie)).status, 204);
    assert.equal((await request("me", undefined, nextCookie)).status, 401);
    const expired = newToken();
    await pool.query(
      "INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()-interval '1 minute')",
      [digest(expired), id],
    );
    assert.equal(
      (await request("reset-password", { token: expired, password })).status,
      400,
    );
    const blocked = await fetch(base + "login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://untrusted.example",
      },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(blocked.status, 403);
  } finally {
    try {
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await pool.end();
    }
  }
});
