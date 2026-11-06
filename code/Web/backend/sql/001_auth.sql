BEGIN;
CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE CHECK(email=lower(email)),
 name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('admin','staff','customer')),
 password_hash TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
 token_hash TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS resets_user_idx ON password_resets(user_id);
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS request_name TEXT;
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS request_phone TEXT;
ALTER TABLE password_resets ADD COLUMN IF NOT EXISTS request_account_id TEXT;
CREATE TABLE IF NOT EXISTS email_otps (
 challenge_hash TEXT PRIMARY KEY,
 user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 code_hash TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 attempts INTEGER NOT NULL DEFAULT 0,
 request_name TEXT, request_phone TEXT, request_account_id TEXT
);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role='employee' WHERE role='staff';
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'employee';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('admin','manager','employee','customer'));

COMMIT;
