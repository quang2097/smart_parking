# Use-case tests

UC09 (Hanoi traffic observation) is covered by `cameras.test.ts`, `cameras.integration.ts`, `npm run test:camera-web` and `npm run test:camera-native` in `Desktop`, and `npm run test:camera` in `Android`. Native tests verify actual login cookies, JPEG/MJPEG playback and upstream cancellation; Android includes a real background/resume check. See [camera verification and source configuration](CAMERAS.md).

The eleven supplied diagrams represent seven distinct use cases. `backend/src/use-cases.integration.ts` gives each one a named scenario, UC01–UC07, and adds UC08 for the server-local temporary administrator. Each scenario uses a fresh Express app and rate limiter, real HTTP requests, PostgreSQL, randomly named accounts, and cleanup of its own records.

Recovery tests run a loopback SMTP inbox from `backend/src/testing/smtp.ts`. They read the OTP from the email actually sent by Nodemailer, rather than inserting a known code or reset authorization to bypass verification. The fixture overrides SMTP configuration within its test process, so no email is sent to external addresses. Database timestamps are adjusted to test expiry and cooldown without waiting several minutes.

| ID | Use case | Backend scenario covers | Shared UI scenario covers |
| --- | --- | --- | --- |
| UC01 | Đăng nhập | Both roles; correct/wrong/unknown/inactive accounts; invalid input; session flags; remembered login; replaced and expired sessions; logout; untrusted browser origin | Login reaches dashboard; ordinary users have no account-creation, review or signal-configuration controls |
| UC02 | Đổi mật khẩu | Both roles verify an actual email OTP; missing verification rejected; mismatch rejected; single-use authorization; all old sessions revoked; new password works; pending admin request closed | Requests email verification before showing the new-password form; successful change returns to login |
| UC03 | Quên mật khẩu | Complete emailed recovery/reset; password policy and confirmation; replay rejection; revoked sessions; unknown-account acknowledgement; admin email-only recovery; stale admin request closed | Forgot → OTP → reset → login; confirmation mismatch keeps the form open |
| UC04 | Tạo tài khoản (admin) | Admin creates admin and user; created account can log in; hashed password; no hash in response; unauthorized/disabled actor blocked; invalid inputs and legacy roles rejected; duplicate email conflict | Creates both roles; confirmation mismatch blocked; creation control hidden from ordinary users |
| UC05 | Tạo yêu cầu đổi mật khẩu | Required name/email/phone/UUID; mismatched/unknown/admin/inactive account handling; acknowledgement privacy; saved details; one pending request; submission rate limit | Personal-information dialog submits a request and displays acknowledgement |
| UC06 | Xác thực người dùng | Captured SMTP OTP; browser/challenge binding; malformed and wrong codes; five attempts; cooldown; expired OTP; replay; hashed and expired reset authorization; SMTP failure removes unusable challenge | Wrong code leaves OTP form visible; correct code advances to reset |
| UC07 | Xử lý yêu cầu (admin) | Admin sees contact details; anonymous/user/expired-admin denied; invalid reviews; missing request; reject preserves password and session; approve revokes sessions, OTPs and reset secrets; audit metadata; competing reviews yield one success and one conflict | Opens queue; rejects one request; approves another with a confirmed password; review control hidden from ordinary users |
| UC08 | Temporary administrator | Input validation; collision refusal; admin login; creates a persistent admin; active lease survives pruning; idempotent deletion revokes login; persistent accounts survive cleanup | Server-terminal feature; no client provisioning bypass |

Existing regression tests complement these scenarios: `change.integration.ts` checks expired and other-account authorizations; `temporary-admin.integration.ts` checks orphan cleanup; `roles.integration.ts` checks the role matrix and expired sessions; `auth.integration.ts`, `otp.integration.ts` and `recovery.integration.ts` retain their lifecycle checks. `signals.test.ts` and `traffic.integration.ts` cover traffic phase safety, timing validation, admin/user access, saved plans, history and version conflicts.

## Run

Requires Node.js, installed dependencies and a migrated local **test database**. Set `DATABASE_URL` to that database and run `npm run db:migrate` from `Web/backend` before the first test run. Keep `NODE_ENV` unset or set to `development`, as with the existing integration tests. Fixtures use unique account IDs and remove their own records; do not run integration suites against a production database.

From `Web/backend`:

```powershell
npm run test:use-cases
npm run test:all
npm run build
```

`test:use-cases` runs the eight named business scenarios. `test:all` runs backend unit tests and all PostgreSQL integration tests, including those scenarios. No backend server needs to be running; the test creates HTTP and SMTP servers on temporary ports.

From `Desktop`:

```powershell
npm test
npm run test:use-cases
```

The UI test builds the shared frontend and runs the real Electron shell against a local fixture API. It prints a result for each diagrammed use case and also checks native cookie handling, the API allowlist, preservation of timing edits and removal of stale signals. Screenshots are written under `Desktop/release/screenshots`. UI fixtures test navigation and controls; real backend permissions, password hashing, persistence and email delivery are tested separately by the PostgreSQL/SMTP suite.

The same frontend is bundled into Android. Its separate `npm run test:smoke` command in `Android` checks the real Android WebView/native HTTP bridge in an installed debug APK on an Android Studio emulator; see the root README for device setup. The seven-use-case UI suite runs in Electron and does not claim Android device coverage for every screen. Process-signal handling and terminal password masking are not automated by UC08; it tests the provisioning/cleanup service. The earlier interactive Ctrl+C lifecycle verification is documented in `USE_CASES.md`.
