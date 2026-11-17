# Smart Traffic Android

Capacitor Android application using the shared web interface and native HTTP/cookie transport. See the [client setup and connection guide](../README.md).

Install dependencies in `Web/frontend` and `Android`, then run `npm run build` here for a debug APK, or `npm run sync` and `npm run open` to work in Android Studio. Java 21 and Android SDK 36 are required. The default backend is `http://10.0.2.2:3000` for the Android emulator; a physical phone needs the backend PC's LAN address or USB port reversal. Change this in the app's connection panel.

The Hanoi camera viewer supports road/camera selection, demo images, snapshots and MJPEG through the native authenticated media bridge. Camera playback stops when the activity goes to the background and can be reconnected on return. Configure authorized camera sources on the backend as described in [the camera guide](../Web/CAMERAS.md). After installing a current debug APK on a disposable emulator, `npm run test:camera` runs real camera/backend integration tests and saves a screenshot.
