# Smart Parking — Đăng nhập

Local Node.js + TypeScript + PostgreSQL authentication application. The Vietnamese interface follows the supplied login use case: enter account details, sign in, or recover a forgotten password. Login leads to an authenticated account screen; parking operations are outside this implementation.

## Run locally

Requires Node.js 22.12+ and PostgreSQL. Docker is optional.

1. Start a local PostgreSQL database, or open Docker Desktop, wait for its engine to be running, then run `docker compose up -d` from this directory. Docker's PostgreSQL uses host port **5433** to avoid conflicting with an existing PostgreSQL installation on 5432. The Compose database credentials are for local development only.
2. In `backend`, run `npm install`. Copy `.env.example` to `.env` **only if you do not already have one**. Set `DATABASE_URL` to your database (`postgresql://parking:parking@localhost:5433/smart_parking` for Docker) and `APP_URL=http://localhost:5173`. Existing environment settings are preserved by this implementation.
3. Run `npm run db:migrate` in `backend`. This creates the authentication tables without deleting existing data. The unused original Prisma skeleton is retained; this implementation uses `pg` and `sql/001_auth.sql`, not Prisma migrations.
4. Set `SEED_EMAIL`, `SEED_NAME`, `SEED_ROLE` (`admin`, `staff`, or `customer`), and a unique `SEED_PASSWORD` of 12–128 characters in `backend/.env`. Run `npm run user:create`. Existing accounts are not overwritten. Remove `SEED_PASSWORD` from `.env` afterward.
5. Run `npm run dev` in `backend`.
6. In another terminal, run `npm install` then `npm run dev` in `frontend`. Open **http://localhost:5173**.

The login page is served by the frontend on **5173**; the API runs on **3000**. Both development servers must be running. Opening the API root in development redirects to `APP_URL` (5173 by default). If you see `Cannot GET /` on port 3000, restart the backend to load the latest code, then open the frontend URL.

During development, a loopback `APP_URL` permits `localhost`, `127.0.0.1`, and `[::1]` on the same protocol and port, so either local frontend address works. Production permits only the exact `APP_URL` origin. Restart the backend after changing environment settings.

Email is used as the account identifier. Account creation is an administrator command; public registration is not part of the diagram. Actor names are not readable in the supplied image, so the three role names above are implementation assumptions. All three roles share login; their role is loaded from the database, never selected or granted by the login screen.

Seed settings in `.env` do not create an account automatically. Run `npm run user:create` and confirm it prints `User created.` before trying to sign in with **SEED_EMAIL** and **SEED_PASSWORD**. `SEED_NAME` is only a display name. Passwords must contain 12–128 characters. You can run `npm run user:check` to check account existence, seed validation and password matching without printing the password or hash. Changing a seed password does not update an already existing account; use the forgot-password flow for that.

## Forgot password

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and, if needed, `SMTP_USER` / `SMTP_PASS`. In development without SMTP, reset links appear **only in the backend terminal**, allowing the entire recovery flow to be exercised locally. The API never returns reset tokens. Links expire after 15 minutes and can be used once. Resetting a password revokes all sessions and all outstanding reset links for that account. Unknown emails receive the same public response as registered emails.

## API

| Method | Endpoint                    | Body / behavior                                                                           |
| ------ | --------------------------- | ----------------------------------------------------------------------------------------- |
| POST   | `/api/auth/login`           | `{email,password,remember?:boolean}`; sets HttpOnly cookie and returns public user fields |
| GET    | `/api/auth/me`              | Returns current user or 401                                                               |
| POST   | `/api/auth/logout`          | Deletes session and clears cookie                                                         |
| POST   | `/api/auth/forgot-password` | `{email}`; requests reset link                                                            |
| POST   | `/api/auth/reset-password`  | `{token,password}`; consumes reset link                                                   |
| GET    | `/api/health`               | Checks PostgreSQL connectivity                                                            |

Passwords use salted asynchronous scrypt. Random session and reset secrets are stored as SHA-256 digests in PostgreSQL. Sessions last 8 hours, or 30 days with “Ghi nhớ đăng nhập”; ordinary session cookies are cleared when the browser session ends. Authentication endpoints have an IP-based request limiter; origin checks and SameSite cookies protect browser writes. SQL values use [node-postgres parameterized queries](https://node-postgres.com/features/queries), and password resets use a [single-client transaction](https://node-postgres.com/features/transactions).

## Verification and deployment

Run `npm run build` in both directories, and `npm test` in `backend`. Run `npm run test:integration` in `backend` **against an initialized test database** to exercise the actual HTTP and PostgreSQL flows; it creates and deletes only its own randomly named users. This tests successful and failed login, cookies, session restoration, single-use reset, session revocation, and logout.

For production, build both projects. Run `npm start` in `backend` and serve `frontend/dist` with SPA fallback to `index.html`; reverse-proxy `/api` to the backend on the same public origin. Set `NODE_ENV=production`, an HTTPS `APP_URL`, production database credentials and SMTP delivery. Configure proxy trust explicitly for your topology before relying on client-IP limiting behind a proxy. The default in-memory limiter applies per Node process; multiple replicas need a shared limiter store. Schedule deletion of expired sessions and reset rows. Docker Compose's development password must be replaced for deployment.
