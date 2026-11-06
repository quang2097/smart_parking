import test from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins } from "./origins.js";

test("development permits loopback aliases only on the configured protocol and port", () => {
  const origins = allowedOrigins(new URL("http://localhost:5173"), false);
  for (const origin of [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ]) {
    assert.equal(origins.has(origin), true);
  }
  for (const origin of [
    "http://127.0.0.1:5174",
    "https://localhost:5173",
    "http://localhost.evil.example:5173",
    "null",
  ]) {
    assert.equal(origins.has(origin), false);
  }
});

test("production and non-loopback APP_URL retain an exact origin allowlist", () => {
  assert.deepEqual(
    [...allowedOrigins(new URL("https://localhost:5173"), true)],
    ["https://localhost:5173"],
  );
  assert.deepEqual(
    [...allowedOrigins(new URL("https://parking.example"), false)],
    ["https://parking.example"],
  );
  assert.equal(
    allowedOrigins(new URL("http://127.0.0.1:5173"), false).has(
      "http://localhost:5173",
    ),
    true,
  );
});
