import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { pool } from "./db.js";
import { digest, hashPassword, newToken } from "./security.js";

test("email OTP is browser-bound, limited, expiring and single-use", async () => {
  const id = randomUUID(), email = `otp-${id}@example.com`;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = (path: string, body: unknown, cookie = "") => fetch(`http://127.0.0.1:${address.port}/api/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body),
  });
  const challenge = newToken(), challengeId = digest(challenge), code = "012345";
  const cookie = `parking_otp=${challenge}`;
  const verify = (value = code, browserCookie = cookie) => request("verify-otp", { challengeId, code: value }, browserCookie);
  try {
    await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'OTP test','customer',$3)", [id, email, await hashPassword("Original password 2026!")]);
    await pool.query("INSERT INTO email_otps(challenge_hash,user_id,code_hash,expires_at) VALUES($1,$2,$3,now()+interval '5 minutes')", [challengeId, id, digest(challenge + code)]);
    assert.equal((await verify(code, "")).status, 400);
    assert.equal((await verify("999999")).status, 400);
    assert.equal((await pool.query("SELECT attempts FROM email_otps WHERE user_id=$1", [id])).rows[0].attempts, 1);
    await pool.query("UPDATE email_otps SET attempts=5 WHERE user_id=$1", [id]);
    assert.equal((await verify()).status, 400);
    await pool.query("UPDATE email_otps SET attempts=0,expires_at=now()-interval '1 second' WHERE user_id=$1", [id]);
    assert.equal((await verify()).status, 400);
    await pool.query("UPDATE email_otps SET expires_at=now()+interval '5 minutes' WHERE user_id=$1", [id]);
    const verified = await verify();
    assert.equal(verified.status, 200);
    const { token } = await verified.json();
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal((await verify()).status, 400);
    const password = "OTP changed password 2026!";
    assert.equal((await request("reset-password", { token, password, confirm: password })).status, 200);
    assert.equal((await request("reset-password", { token, password, confirm: password })).status, 400);
    assert.equal((await request("login", { email, password })).status, 200);
    const recovery = { email, name: "OTP test", phone: "0901234567", accountId: id };
    const issued = await request("forgot-password", recovery);
    const first = await issued.json();
    assert.equal(issued.status, 200);
    assert.equal(first.token, undefined);
    assert.equal(first.code, undefined);
    assert.match(issued.headers.get("set-cookie")!, /HttpOnly/);
    const retry = await request("forgot-password", recovery, issued.headers.get("set-cookie")!.split(";")[0]!);
    assert.equal((await retry.json()).challengeId, first.challengeId);
    assert.equal((await pool.query("SELECT challenge_hash FROM email_otps WHERE user_id=$1", [id])).rows[0].challenge_hash, first.challengeId);
  } finally {
    try { await pool.query("DELETE FROM users WHERE id=$1", [id]); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pool.end();
    }
  }
});
