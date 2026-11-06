import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { pool } from "./db.js";
import { digest, hashPassword, newToken } from "./security.js";

test("account creation enforces admin, manager and employee hierarchy", async () => {
  const ids: string[] = [];
  const prefix = randomUUID();
  const password = "Hierarchy password 2026!";
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  let counter = 0;
  const create = (role: string, cookie = "", email = `${prefix}-${counter++}@example.com`) => fetch(`http://127.0.0.1:${address.port}/api/auth/users`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Created user", email, password, confirm: password, role }),
  });
  try {
    const hash = await hashPassword(password);
    const cookies: Record<string, string> = {};
    for (const role of ["admin", "manager", "employee"]) {
      const id = randomUUID(), token = newToken(); ids.push(id);
      await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Role test',$3,$4)", [id, `${prefix}-${role}@example.com`, role, hash]);
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(token), id]);
      cookies[role] = `parking_session=${token}`;
    }
    assert.equal((await create("employee")).status, 401);
    for (const role of ["admin", "manager", "employee"]) {
      const response = await create(role, cookies.admin);
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.user.role, role);
      assert.equal(body.user.password_hash, undefined);
    }
    assert.equal((await create("employee", cookies.manager)).status, 201);
    assert.equal((await create("manager", cookies.manager)).status, 403);
    assert.equal((await create("admin", cookies.manager)).status, 403);
    assert.equal((await create("employee", cookies.employee)).status, 403);
    assert.equal((await create("owner", cookies.admin)).status, 400);
    assert.equal((await create("employee", cookies.admin, `${prefix}-admin@example.com`)).status, 409);
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [ids[0]]);
    assert.equal((await create("employee", cookies.admin)).status, 401);
  } finally {
    try { await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[]) OR email LIKE $2", [ids, `${prefix}-%`]); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pool.end();
    }
  }
});
