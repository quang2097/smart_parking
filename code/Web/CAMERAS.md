# Hanoi camera observation — web, desktop and Android

The supplied use case is: **select a road → select a camera on that road → observe traffic**. Both existing account roles can use the shared panel after login on web, desktop and Android. It is separate from simulated traffic-light control.

## iHanoi access findings

Checked on **15–16 November 2026**. The official Hanoi Public Administration Service Center guide describes signing into iHanoi using VNeID or a registered phone account, then selecting Traffic → Traffic cameras → a location:

- [Official iHanoi camera guide, 28 June 2025](https://ttpvhcc.hanoi.gov.vn/video/bi-quyet-di-chuyen-thong-minh-voi-camera-giao-thong-tren-ihanoi-2850250627195842357.htm)
- [Ministry of Public Security announcement of Hanoi Smart Police on iHanoi](https://mps.gov.vn/bai-viet/cong-an-tp-ha-noi-ra-mat-03-san-pham-giai-phap-chuyen-doi-so-trong-diem-phuc-vu-nhan-dan-1788370902)
- [Official iHanoi Android listing](https://play.google.com/store/apps/details?id=com.viettel.citizens.hanoi)

No documented third-party public camera API or reusable anonymous feed URL was verified in the official materials checked. Citizen access inside the application does not establish permission to redistribute its feeds. This is an access-research limitation, not a claim that an integration API cannot exist. No protected endpoints were bypassed, app sessions extracted, or provider restrictions removed. `ihanoiConnected` is explicitly `false` in this proof of concept.

For a direct integration, request an approved camera catalogue/feed interface and redistribution terms from iHanoi/Viettel or the camera authority. Do not put VNeID credentials into this application. If approved HTTP snapshot or MJPEG feeds are supplied, configure them below. A provider using a different catalogue, signed playback sessions, HLS, RTSP or WebRTC needs an additional adapter; those protocols are not implemented here.

## Try the proof of concept

Use the existing database and account setup in `README.md`. Start the backend (`npm run dev` from `Web/backend`) and web frontend (`npm run dev` from `Web/frontend`). Sign in and open **Quan sát giao thông Hà Nội** above the signal dashboard.

1. Choose **Kim Mã · minh họa** or **Giải Phóng · minh họa**.
2. Choose one of that road's DEMO cameras.
3. The backend generates a changing traffic illustration every five seconds. Stop, reconnect, switch road/camera, and verify that closing the panel stops viewing.

These road/camera entries are test data. The images are labelled **DEMO · KHÔNG PHẢI CAMERA HÀ NỘI** in the image and interface. They are not real Hanoi cameras, live video, or traffic measurements. No remote camera connection is needed for this demo. Without a catalogue, production shows an empty configuration state rather than automatically enabling demo cameras.

## Connect an authorized camera

Copy `backend/cameras.example.json` to `backend/cameras.local.json`. Replace its road, camera and source details with your authorized source. This file is ignored by Git. In the backend environment, set:

```dotenv
CAMERA_CATALOG_FILE=./cameras.local.json
CAMERA_ALLOWED_ORIGINS=http://127.0.0.1:8090
```

Restart the backend. The example snapshot URL is `http://127.0.0.1:8090/snapshot.jpg` and its MJPEG URL is `http://127.0.0.1:8090/video`; these are configuration examples, not a running camera service. Replace them with the snapshot/MJPEG endpoints of your own camera or an authorized camera gateway. `127.0.0.1` here means the backend machine. To reach an approved LAN camera, use its IP and port in both the URL and exact allowed origin, for example `http://192.168.1.50:8080`.

For authenticated sources, a camera may specify `"authorizationEnv": "MY_CAMERA_AUTHORIZATION"`. Put the provider's complete authorization header value in the server environment, such as `MY_CAMERA_AUTHORIZATION=Bearer <provider-issued-token>`. Omit that property for sources without authorization. The example's MJPEG entry requires this environment variable: remove that entry/property if your source does not use it. Do not commit credentials. Prefer HTTPS outside a trusted local development network.

Supported modes:

| Mode | Source | Viewer behavior |
| --- | --- | --- |
| `demo` | Generated local SVG traffic illustration | Clearly labelled, refreshed periodically |
| `snapshot` | HTTP(S) JPEG, PNG or WebP image | Refresh interval of 5–300 seconds; default 10 seconds |
| `mjpeg` | HTTP(S) `multipart/x-mixed-replace; boundary=...` | Continuous image stream, with an explicit reconnect after the bounded viewing session |

The backend only accepts URLs from its server-local catalogue and exact allowed origins. Browser requests cannot supply a source URL. The gateway sends only configured source authorization, not the user's application cookies. It rejects redirects rather than forwarding credentials to another location, rejects unsupported media types, limits snapshots to 5 MiB/10 seconds, and limits MJPEG connections to 64 MiB/60 seconds with a 10-second first-data deadline. At most 16 source transfers run at once, with two per account. These are per-process proof-of-concept limits; a multi-instance production service needs shared quotas and provider-approved caching/rate policies.

Media endpoints recheck the active application session at each connection. An already-open MJPEG connection can remain until its 60-second cap after session revocation. No footage is recorded. Received-at time is the gateway reception time, not a verified capture timestamp; a provider can return an old image. Snapshot errors remove the old displayed image. MJPEG sessions are cleared at their time cap and require reconnecting.

## API

| Method | Endpoint | Result |
| --- | --- | --- |
| GET | `/api/cameras/roads` | Road metadata, camera counts, demo indicator and integration status |
| GET | `/api/cameras/roads/:roadId/cameras` | Cameras belonging to the selected road; no upstream URLs or credentials |
| GET | `/api/cameras/:cameraId/snapshot` | Generated demo or authorized image |
| GET | `/api/cameras/:cameraId/stream` | Authorized MJPEG stream |

All endpoints require a valid session for an active admin or user. No schema migration is needed: the proof of concept uses a server-local camera catalogue and existing session tables. The web app uses the same-origin gateway, so source cameras do not need browser CORS access. Production deployment must preserve streaming responses and disable reverse-proxy buffering for MJPEG.

Desktop and Android now include the same camera viewer. Choose the backend in the app's connection panel; the camera catalogue is configured once on that backend. No upstream camera URLs, credentials, CORS changes or public tunnel are required in the client. Local desktop, emulator, LAN and HTTPS tunnel addresses work as described in the root README.

Desktop serves binary media and MJPEG through its `traffic://app` protocol, using the isolated native session that holds login cookies. Metadata goes through the existing restricted IPC API. Android preserves Capacitor's asset loader and intercepts only local `/api/cameras/:id/snapshot|stream` requests, forwarding them through a native HTTP connection with cookies from the same WebView cookie store used by Capacitor HTTP login. Neither bridge exposes session cookies to JavaScript. Redirects, unexpected formats, invalid routes and oversized media are rejected.

Stop, camera switching, closing the panel and logout clear media. Native clients explicitly cancel active media transfers; Android also cancels on activity pause/destroy. Backgrounding pauses the viewer and clears the image; reconnect manually after returning. Backend changes cancel old media before new playback. Native metadata and media are read-only; editing signal plans remains a separate admin operation.

## Verification

From `Web/backend`, run `npm test` and `npm run test:integration`. Camera unit tests check exact-origin configuration, malformed catalogues, demo labelling and escaping. `cameras.integration.ts` checks the UC09 road/camera flow, both roles, session expiry/deactivation, secret hiding, real snapshot/MJPEG proxying through a controlled source, offline responses, oversized images, unsupported types and blocked redirects.

From `Desktop`, run `npm run test:camera-web` for the actual web frontend without native transport, or `npm run test:camera-native` for the actual packaged Electron shell and native cookie/media bridge. Both tests use real cookie login, the real backend, local PostgreSQL and controlled JPEG/MJPEG sources. They verify selection, demo/JPEG/MJPEG display, Stop closing the upstream stream, switching, pause/reconnect, stale-image removal, empty roads, mobile width and logout cleanup. Screenshots are saved under `Desktop/release/screenshots` with `web-camera-` or `desktop-camera-` prefixes.

For Android, build and install the current debug APK into a disposable test emulator, then run `npm run test:camera` from `Android`. It launches the real app, creates a temporary backend fixture, uses `adb reverse` for the backend connection, and tests real native cookie/media handling. It verifies JPEG/MJPEG, demo labels, Stop, camera switching, stale images, empty roads, logout revocation, and closing the upstream MJPEG stream when the activity is sent to the background. It restores the prior backend setting, clears local test cookies, removes port mappings and deletes the fixture account. `ANDROID_SERIAL` defaults to `emulator-5554`; `ANDROID_HOME` selects the SDK. A screenshot is saved to `Android/android/app/build/outputs/android-camera-demo.png`.

Native tests require installed dependencies in the backend and shared frontend; database setup is the same as other integration tests. No iHanoi footage or production camera credentials are used in any test.
