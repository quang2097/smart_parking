import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { hashPassword, validEmail, validPassword } from "./security.js";
try {
  if (process.argv[2] === "migrate") {
    await pool.query(await readFile("sql/001_auth.sql", "utf8"));
    console.log("Authentication tables are ready.");
  } else if (process.argv[2] === "check") {
    const { SEED_EMAIL: email, SEED_PASSWORD: password } = process.env;
    if (!validEmail(email) || !password)
      throw new Error(
        "Set SEED_EMAIL and SEED_PASSWORD to check the seed account.",
      );
    const { rows } = await pool.query(
      "SELECT active,password_hash FROM users WHERE email=$1",
      [email.trim().toLowerCase()],
    );
    const user = rows[0];
    const { verifyPassword } = await import("./security.js");
    console.log(
      JSON.stringify(
        {
          accountExists: Boolean(user),
          seedNameConfigured: Boolean(process.env.SEED_NAME),
          seedRoleValid: ["admin", "manager", "employee"].includes(
            process.env.SEED_ROLE || "admin",
          ),
          seedPasswordMeetsPolicy: validPassword(password),
          accountActive: user?.active ?? false,
          seedPasswordMatches: user
            ? await verifyPassword(password, user.password_hash)
            : false,
          loginUses: "SEED_EMAIL, not SEED_NAME",
        },
        null,
        2,
      ),
    );
  } else if (process.argv[2] === "user") {
    const {
      SEED_EMAIL: email,
      SEED_PASSWORD: password,
      SEED_NAME: name,
      SEED_ROLE: role = "admin",
    } = process.env;
    if (!validEmail(email))
      throw new Error("SEED_EMAIL must be a valid email address.");
    if (!validPassword(password))
      throw new Error(
        "SEED_PASSWORD must contain 12–128 characters. Update backend/.env, then run npm run user:create again.",
      );
    if (!name)
      throw new Error(
        "Set SEED_NAME in backend/.env (the display name, not the login identifier).",
      );
    if (!["admin", "manager", "employee"].includes(role))
      throw new Error("SEED_ROLE must be admin, manager or employee.");
    const result = await pool.query(
      "INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING id",
      [
        randomUUID(),
        email.toLowerCase(),
        name,
        role,
        await hashPassword(password),
      ],
    );
    console.log(
      result.rowCount
        ? "User created."
        : "User already exists; password unchanged.",
    );
  } else throw new Error("Expected migrate, user or check");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
