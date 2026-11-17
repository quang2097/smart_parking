# Smart Traffic clients

The existing API in `Web/backend` is the authority for accounts, permissions and traffic plans. The web frontend is shared by the web, Electron desktop app and Capacitor Android app, retaining its Vietnamese interface and forest-green/cream theme. Desktop and Android bundle the interface, so Vite does not need to run for installed apps.

Implemented features match the current backend: login/logout, remembered sessions, email OTP recovery and reset, password changes, admin account creation, intersection creation, automatic/all-red plans, two-second signal refresh, configuration version conflicts and the latest 50 changes. Users monitor; admins configure. These are **software-simulated signals**, with no sensor input, adaptive optimization, physical controller, pedestrian phase or turn control. The clients do not add unsupported controls.

Authentication now also includes personal-information recovery requests, admin approval/rejection and email verification before password changes. Server-local temporary admin provisioning and the audit against all supplied authentication diagrams are documented in [Web/USE_CASES.md](Web/USE_CASES.md).

Every diagrammed authentication use case has a named backend scenario and shared UI coverage. See [Web/TESTING.md](Web/TESTING.md) for the coverage matrix, prerequisites and commands.

Web, desktop and Android also include Hanoi camera observation: choose a road and camera, then view labelled local demo frames or an authorized snapshot/MJPEG source. Both native apps use their existing session cookies for media and cancel playback on Stop or backgrounding. Real iHanoi feeds have not been connected. See [Web/CAMERAS.md](Web/CAMERAS.md).

## Start the backend

Follow [Web setup](Web/README.md) for PostgreSQL, `.env`, migrations and account provisioning. In `Web/backend`, run `npm install` then `npm run dev`. API port: **3000**. Both native clients connect directly to this API, using native HTTP and its existing cookie authentication. Browser CORS/origin protection remains unchanged. Never copy database credentials into a client.

## Build and run

Requires Node.js 22.12+ and npm. Install the shared frontend dependencies first:

```powershell
cd Web/frontend
npm ci
```

Desktop (from `Desktop`):

```powershell
npm ci
npm start
npm run dist
```

The last command builds a Windows NSIS installer in `Desktop/release`. `npm run pack` creates an unpacked application. The packaged app has an isolated renderer, a restricted native API bridge, no remote pages or Node.js access in the UI, and native session storage. The application requires the backend to perform actions; it does not start PostgreSQL or the API itself.

Android (from `Android`):

```powershell
npm ci
npm run sync
npm run open
npm run build
```

Android Studio can build/run the checked-in `Android/android` project. CLI builds require **JDK 21** and the Android SDK with platform 36; Gradle installs any missing build tools if SDK licenses are already accepted. Set `JAVA_HOME` and `ANDROID_HOME` if needed. On Windows, `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-local-java.ps1` from the repository root downloads a local JDK 21. The build script prefers that JDK when `JAVA_HOME` is unset and detects the standard Android Studio SDK location. The APK is `Android/android/app/build/outputs/apk/debug/app-debug.apk`. It is a development APK; distribution requires your own release signing configuration.

After editing the shared frontend, run the platform build/sync again to include the updated UI. Installed clients do not download new UI code from the backend.

## Choose a server in either app

Expand **Kết nối máy chủ** at the top, enter the backend's root address, save, then use **Kiểm tra kết nối**. Saving clears the device's cookies and reloads the login screen. No passwords or reset tokens are saved in local storage. The health check verifies the API and its database.

| Device | Backend address |
| --- | --- |
| Desktop on the backend PC | `http://localhost:3000` |
| Android Studio emulator | `http://10.0.2.2:3000` |
| USB Android with `adb reverse tcp:3000 tcp:3000` | `http://localhost:3000` |
| Physical Android on the same Wi-Fi | `http://<PC-LAN-IP>:3000` |
| Future tunnel | `https://<backend-tunnel-host>` |

For Wi-Fi, allow inbound TCP 3000 through the PC firewall on your private network and ensure the device can reach that PC. `localhost` on a phone means the phone itself. The Express server already listens on available interfaces. A tunnel must route `/api` to the API, not just the frontend. Use a root address without `/api`, a username, query, or fragment. HTTPS certificates must be valid; certificate verification is not bypassed. HTTP support is enabled for local development, and should be restricted or removed for production distribution. Native requests do not need an extra browser origin allowlist. Production backend requirements still apply as documented in `Web/README.md`.

Authentication cookies remain in each platform's cookie store. Remembered login follows the backend's 30-day cookie expiry; ordinary sessions follow the backend's session expiry and the platform's session-cookie lifecycle. A server switch clears local cookies but does not revoke sessions on the old server: log out first if revocation is wanted. Password changes revoke all sessions server-side.

## Verification

```powershell
cd Web/frontend
npm run build
cd ../backend
npm test
npm run build
cd ../../Desktop
npm test
npm run test:smoke
```

The desktop smoke test runs an isolated fixture server, checking the actual bundled app, login/dashboard, session/OTP cookies, health response, clearing cookies, blocked API paths, preservation of unsaved edits and removal of stale colors after connection failure. It saves desktop and mobile-layout screenshots under `Desktop/release/screenshots`. Backend integration tests (`npm run test:integration` in `Web/backend`) require an initialized test database. Do not point them at a production database.

For Android runtime verification, install the debug APK into a disposable Android Studio emulator, launch it, then run `npm run test:smoke` from `Android`. The test uses `adb` and the debug WebView to exercise native HTTP against a temporary local fixture, including session/OTP cookies, dashboard polling, unsaved edits, stale colors and logout. It restores the configured backend address and clears local cookies afterward. The default device is `emulator-5554`; override `ANDROID_SERIAL` for another emulator. A screenshot is saved to `Android/android/app/build/outputs/android-dashboard.png`. This test uses `10.0.2.2` and requires an Android Studio emulator.
