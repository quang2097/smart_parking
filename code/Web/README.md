# Smart Traffic — Traffic Light Control

The web proof of concept now includes **Quan sát giao thông Hà Nội**: select a road, select a camera, then view labelled local demo frames or an authorized HTTP snapshot/MJPEG source. Direct iHanoi access has not been verified. See [camera research, setup and limitations](CAMERAS.md).

Node.js, TypeScript and PostgreSQL application with a Vietnamese interface. Admins manage accounts, intersections and signal timing. Users monitor intersections and change history. Authentication, email OTP recovery and password changes remain available.

## Local setup

Requires Node.js 22.12+ and PostgreSQL. Docker is optional.

1. Start PostgreSQL. For the existing development database, run `docker compose up -d`. The legacy database name and volume are intentionally retained so existing accounts are preserved.
2. Run `npm install` in `backend` and `frontend` if dependencies are missing.
3. Copy `backend/.env.example` to `backend/.env` only if no `.env` exists. Configure `DATABASE_URL` and `APP_URL=http://localhost:5173`. Do not replace an existing database URL just to rename the application.
4. In `backend`, run `npm run db:migrate`. This executes `sql/001_auth.sql`, `sql/002_traffic.sql` and `sql/003_recovery_requests.sql`. The application uses `pg` and SQL migrations; the unused Prisma skeleton is not the database authority.
5. For a first account, set `SEED_EMAIL`, `SEED_NAME`, `SEED_ROLE=admin` and a unique `SEED_PASSWORD` (12–128 characters), then run `npm run user:create`. Remove `SEED_PASSWORD` afterward. Existing accounts are never overwritten. `npm run user:check` verifies the configured account without exposing secrets.
6. Run `npm run dev` in each directory. Open **http://localhost:5173**. The API listens on **3000**.

## Roles and migration

Only `admin` and `user` are accepted by account creation, provisioning and the database constraint. Admins create either role and configure intersections. Users have read-only traffic access. Public registration is disabled. Permissions are enforced by the server.

Migration retains admins and converts legacy manager, employee, staff and customer accounts to users, preserving IDs, passwords and recovery records. Sessions for converted accounts are revoked. Cookies now use `traffic_session` and `traffic_otp`; everyone signs in again after upgrading. Both SQL files are repeatable and preserve existing intersection configurations.

## Traffic dashboard

Sign in as an admin to add a named intersection and its location. New intersections start with an all-red hold. Choose automatic mode, enter timing values, and save. Both roles can inspect signal colors, countdowns, plan timing and the latest 50 changes per intersection. Signal status is refreshed every two seconds. Background refresh leaves unsaved forms intact; if another admin changes a plan, reload before saving. A version conflict returns HTTP 409.

Automatic simulation alternates two non-conflicting through movements: all-red clearance → North–South green → North–South yellow → all-red clearance → East–West green → East–West yellow. Green durations accept 10–180 seconds, yellow 3–10 seconds and all-red clearance 2–10 seconds. Saving any configuration restarts the cycle at all-red clearance. All-red mode holds both movements red. Changes and their actor are recorded transactionally with configuration snapshots.

**This release is software simulation.** Signal colors are calculated from the server clock and saved plan; they are not confirmed physical lamp states. No physical controller, MQTT connection, sensor feedback, adaptive traffic algorithm, pedestrian phase or turn movement is implemented. The interface labels this explicitly and removes stale colors on connection failure. Connecting real lights requires a controller protocol and feedback integration.

## API

All traffic routes require a valid, active session. Writes require an admin.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/traffic/intersections` | Saved plans, calculated signals, server time, `simulation: true` |
| POST | `/api/traffic/intersections` | `{name,location}`; creates an all-red intersection |
| POST | `/api/traffic/intersections/:id/configure` | `{version,mode,north_south_green,east_west_green,yellow,all_red}`; mode is `automatic` or `all_red` |
| GET | `/api/traffic/intersections/:id/history` | Latest 50 changes with actor name and configuration snapshot |
| POST | `/api/auth/users` | Admin creates `{name,email,role,password,confirm}` |
| POST | `/api/auth/login` | `{email,password,remember?:boolean}`; sets HttpOnly cookie |
| GET | `/api/auth/me` | Current account |
| POST | `/api/auth/logout` | Revokes current session |
| POST | `/api/auth/forgot-password` | `{email,name,phone,accountId}`; admins use `{email}` |
| POST | `/api/auth/verify-otp` | `{challengeId,code}` with browser cookie; returns reset authorization |
| POST | `/api/auth/verify-reset` | `{token}`; checks recovery authorization |
| POST | `/api/auth/reset-password` | `{token,password,confirm}` |
| POST | `/api/auth/change-password` | `{token,password,confirm}` with current session and email-verified authorization |
| POST | `/api/auth/recovery-requests` | `{name,email,phone,accountId}`; submits a user recovery request for admin review |
| GET | `/api/auth/recovery-requests` | Admin lists up to 100 requests, pending first |
| POST | `/api/auth/recovery-requests/:id/review` | Admin submits `{decision:"approve"|"reject",note?,password?,confirm?}`; approval requires a confirmed new password |
| GET | `/api/health` | Checks database connectivity |

Users recover accounts with their registered name, account UUID displayed on the dashboard, email and contact phone. Phone is contact information, not SMS verification. Admins only need email; the server verifies the stored role. Email OTPs expire after five minutes, allow five attempts and a 60-second request cooldown. Successful verification returns a 15-minute reset authorization held in page memory. Password changes revoke all sessions and recovery authorizations.

Signed-in password changes also require email verification: complete the OTP flow, then send its authorization as `token` alongside `{password,confirm}` to `/api/auth/change-password`. The server checks it belongs to the signed-in account and consumes it once. Users unable to use self-service recovery can choose **Gửi yêu cầu cho quản trị viên**. Admins use **Xử lý yêu cầu đổi mật khẩu** to inspect submitted personal information, verify the requester, set a new confirmed password or reject the request. Approval revokes the user's sessions and recovery authorizations; rejection preserves their password. Self-service recovery closes pending requests. Administrators communicate an approved password through a verified contact channel; the API does not email plaintext passwords.

For server-local access, run `npm run start:temporary-admin` in `backend`. It prompts for name, email and hidden password/confirmation, creates a temporary admin and starts the server. It never overwrites existing accounts. Orderly shutdown removes that account and its sessions; accounts it provisioned remain. Hard-kill/power-loss orphans are removed before the next server startup. See the [complete use-case audit and lifecycle details](USE_CASES.md). Permanent provisioning through `npm run user:create` is separate.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` and optional `SMTP_USER`/`SMTP_PASS`. Without SMTP in development, OTPs print only in the backend console. Production requires SMTP and an HTTPS `APP_URL`. Passwords use salted asynchronous scrypt; session and recovery secrets are stored as SHA-256 digests. Browser writes use origin checks and SameSite cookies; authentication endpoints are rate limited.

## Verification and deployment

Run `npm run build` in each directory and `npm test` in `backend`. Run `npm run test:integration` in `backend` against an initialized test database. Integration tests use randomly named records and clean up their own records. They cover authentication, OTP, password changes, both roles, traffic access, validation, saved plans, history and stale configuration conflicts.

Build both projects for production. Serve `frontend/dist` with SPA fallback and reverse proxy `/api` to the backend on the same public origin. Run `npm start` in `backend`. Configure production database credentials, SMTP and an HTTPS `APP_URL`. Replace Compose's development password. Configure proxy trust for the deployment topology, use a shared rate limiter for multiple replicas, and schedule cleanup of expired authentication records.
