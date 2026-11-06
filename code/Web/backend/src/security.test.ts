import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  newToken,
  digest,
  validEmail,
  validPassword,
} from "./security.js";
test("password hashes use independent salts and reject a wrong password", async () => {
  const password = "Secure parking password 2026!";
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword("wrong password", a), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});
test("session and reset tokens are random and stored as digests", () => {
  const a = newToken(),
    b = newToken();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
  assert.notEqual(digest(a), a);
  assert.equal(digest(a), digest(a));
});
test("credential validation enforces email shape and password bounds", () => {
  assert.equal(validEmail("staff@example.com"), true);
  for (const email of ["bad", "a@b", "a b@example.com", null])
    assert.equal(validEmail(email), false);
  assert.equal(validPassword("long enough password"), true);
  assert.equal(validPassword("short"), false);
  assert.equal(validPassword("a".repeat(129)), false);
});
