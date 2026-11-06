# Smart Parking — Đăng nhập

Local Node.js + TypeScript + PostgreSQL authentication application. The Vietnamese interface follows the supplied login use case: enter account details, sign in, or recover a forgotten password. Login leads to an authenticated account screen; parking operations are outside this implementation.

## Run locally

Requires Node.js 22.12+ and PostgreSQL. Docker is optional.

1. Start a local PostgreSQL database, or open Docker Desktop, wait for its engine to be running, then run `docker compose up -d` from this directory. Docker's PostgreSQL uses host port **5433** to avoid conflicting with an existing PostgreSQL installation on 5432. The Compose database credentials are for local development only.
2. In `backend`, run `npm install`. Copy `.env.example` to `.env` **only if you do not already have one**. Set `DATABASE_URL` to your database (`postgresql://parking:parking@localhost:5433/smart_parking` for Docker) and `APP_URL=http://localhost:5173`. Existing environment settings are preserved by this implementation.
3. Run `npm run db:migrate` in `backend`. This creates the authentication tables without deleting existing data. The unused original Prisma skeleton is retained; this implementation uses `pg` and `sql/001_auth.sql`, not Prisma migrations.
4. Set `SEED_EMAIL`, `SEED_NAME`, `SEED_ROLE` (`admin`, `manager`, or `employee`), and a unique `SEED_PASSWORD` of 12–128 characters in `backend/.env`. Run `npm run user:create`. Existing accounts are not overwritten. Remove `SEED_PASSWORD` from `.env` afterward.
5. Run `npm run dev` in `backend`.
6. In another terminal, run `npm install` then `npm run dev` in `frontend`. Open **http://localhost:5173**.

The login page is served by the frontend on **5173**; the API runs on **3000**. Both development servers must be running. Opening the API root in development redirects to `APP_URL` (5173 by default). If you see `Cannot GET /` on port 3000, restart the backend to load the latest code, then open the frontend URL.

During development, a loopback `APP_URL` permits `localhost`, `127.0.0.1`, and `[::1]` on the same protocol and port, so either local frontend address works. Production permits only the exact `APP_URL` origin. Restart the backend after changing environment settings.

Email is used as the login identifier. Roles are loaded from the database. Signed-in admins and managers have a “Tạo tài khoản” action. Admins can create admin, manager or employee accounts; managers can create only employees. Employees cannot create accounts. The server enforces these permissions independently of the form. Creation requires a name, unique email, role, password and matching confirmation (12–128 characters). The creator remains signed in as themselves, and the new account ID is shown after success.

Run `npm run db:migrate` when updating: existing `staff` accounts become `employee`; existing customers remain customers outside the staff hierarchy and cannot create accounts. `npm run user:create` supports admin, manager and employee for initial provisioning. Public registration is not enabled.

Seed settings in `.env` do not create an account automatically. Run `npm run user:create` and confirm it prints `User created.` before trying to sign in with **SEED_EMAIL** and **SEED_PASSWORD**. `SEED_NAME` is only a display name. Passwords must contain 12–128 characters. You can run `npm run user:check` to check account existence, seed validation and password matching without printing the password or hash. Changing a seed password does not update an already existing account; use the forgot-password flow for that.

## Forgot password and email OTP

Managers, employees and existing customers submit their registered full name, contact phone number, account ID and email. The current account ID is the UUID shown on the account screen. Name and ID must match the account. Phone is collected as contact information only; SMS OTP is not implemented. Administrators can select “Tôi là quản trị viên” to use email only; the server checks the stored role.

A six-digit OTP goes to the registered email. Enter it in the same browser to proceed directly to the new password and confirmation form. Codes expire after five minutes, permit five attempts, and work once. Requests have a 60-second per-account cooldown as well as IP rate limits. Codes are stored as digests bound to a secret HttpOnly browser cookie. Successful verification creates a 15-minute reset authorization held in page memory; refreshing the password form requires requesting another code. Password changes revoke outstanding codes, reset authorizations and login sessions.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and optional `SMTP_USER` / `SMTP_PASS` for delivery. Without SMTP in development, OTPs appear only in the backend terminal. Production requires SMTP. The API never returns OTPs. Unknown accounts and mismatched identity details receive a generic response. Existing reset links remain supported until they expire.

Run `npm run db:migrate` in `backend` after updating to add the OTP table without deleting data.

## Change password

Signed-in users of all roles can choose “Đổi mật khẩu” from their account screen. `/change-password` checks the existing session before showing the new password and confirmation fields. No old password or identity details are requested again. Recovery links check their token before showing the same fields. Both paths revalidate authorization when saving, require matching passwords of 12–128 characters, and revoke all sessions and recovery links after success. The user then signs in with the new password.

## API

| Method | Endpoint                    | Body / behavior                                                                           |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/api/auth/users` | `{name,email,role,password,confirm}`; admin creates any staff role, manager creates employees; returns new account ID |
| POST   | `/api/auth/login`           | `{email,password,remember?:boolean}`; sets HttpOnly cookie and returns public user fields |
| GET    | `/api/auth/me`              | Returns current user or 401                                                               |
| POST   | `/api/auth/logout`          | Deletes session and clears cookie                                                         |
| POST   | `/api/auth/forgot-password` | `{email,name,phone,accountId}` (admins: `{email}`); requests email OTP, returns challengeId                                                            |
| POST   | `/api/auth/reset-password`  | `{token,password,confirm}`; consumes reset link                                                   |
| POST   | `/api/auth/verify-otp` | `{challengeId,code}` plus browser cookie; consumes OTP and returns reset authorization |
| POST   | `/api/auth/verify-reset`    | `{token}`; checks recovery authorization without consuming the link |
| POST   | `/api/auth/change-password` | `{password,confirm}`; requires a valid session; revokes all sessions and reset links |
| GET    | `/api/health`               | Checks PostgreSQL connectivity                                                            |

Passwords use salted asynchronous scrypt. Random session and reset secrets are stored as SHA-256 digests in PostgreSQL. Sessions last 8 hours, or 30 days with “Ghi nhớ đăng nhập”; ordinary session cookies are cleared when the browser session ends. Authentication endpoints have an IP-based request limiter; origin checks and SameSite cookies protect browser writes. SQL values use [node-postgres parameterized queries](https://node-postgres.com/features/queries), and password resets use a [single-client transaction](https://node-postgres.com/features/transactions).

## Verification and deployment

Run `npm run build` in both directories, and `npm test` in `backend`. Run `npm run test:integration` in `backend` **against an initialized test database** to exercise the actual HTTP and PostgreSQL flows; it creates and deletes only its own randomly named users. This tests successful and failed login, cookies, session restoration, single-use reset, session revocation, and logout.

For production, build both projects. Run `npm start` in `backend` and serve `frontend/dist` with SPA fallback to `index.html`; reverse-proxy `/api` to the backend on the same public origin. Set `NODE_ENV=production`, an HTTPS `APP_URL`, production database credentials and SMTP delivery. Configure proxy trust explicitly for your topology before relying on client-IP limiting behind a proxy. The default in-memory limiter applies per Node process; multiple replicas need a shared limiter store. Schedule deletion of expired sessions and reset rows. Docker Compose's development password must be replaced for deployment.
