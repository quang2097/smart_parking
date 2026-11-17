# Smart Traffic desktop

Electron application using the shared web interface and the existing backend. See the [client setup and connection guide](../README.md).

Install dependencies in `Web/frontend` and `Desktop`, then run `npm start` here. Run `npm run dist` for the Windows installer or `npm run pack` for the unpacked app. Use the app's connection panel to choose `http://localhost:3000`, a LAN backend, or an HTTPS tunnel.

The Hanoi camera viewer supports road/camera selection, labelled demo images, HTTP snapshots and continuous MJPEG using native session cookies. Stop and backgrounding clear the view; reconnect to resume. See [camera source setup](../Web/CAMERAS.md). `npm run test:camera-native` exercises the real native app against a disposable backend fixture.
