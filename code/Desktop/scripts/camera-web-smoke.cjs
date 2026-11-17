// Browser-mode test: no Electron preload/IPC transport; actual web fetch, backend and database.
const { app, BrowserWindow } = require('electron');
const { fork } = require('node:child_process');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { mkdirSync, writeFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
app.setPath('userData', mkdtempSync(resolve(tmpdir(), 'camera-web-smoke-')));
const backend = resolve(__dirname, '../../Web/backend');
let child, window;
const native = process.argv.includes('--native-camera-test');
const deadline = setTimeout(() => { console.error('Camera web test timed out'); child?.send('stop'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  let exitCode = 0;
  try {
    child = fork(resolve(backend, 'src/testing/camera-web-fixture.ts'), [], { cwd: backend, execPath: process.execPath,
      execArgv: ['--import', pathToFileURL(resolve(backend, 'node_modules/tsx/dist/loader.mjs')).href], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, silent: true });
    child.stderr.on('data', data => process.stderr.write(data));
    const details = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', code => reject(new Error(`Backend fixture exited: ${code}`))); });
    if (details.error) throw new Error(details.error);
    if (native) {
      window = BrowserWindow.getAllWindows()[0];
      await window.loadURL('traffic://app/');
      await window.webContents.executeJavaScript(`localStorage.setItem('smart-traffic.backend', ${JSON.stringify(details.origin)})`);
      await window.loadURL('traffic://app/');
    } else {
      window = new BrowserWindow({ show: false, width: 1360, height: 1050, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
      await window.loadURL(details.origin);
    }
    const evaluate = expression => window.webContents.executeJavaScript(expression);
    const wait = expression => evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+12000; const check=()=>{if(${expression})resolve(true);else if(Date.now()>end)reject(new Error('UI timeout: '+${JSON.stringify(expression)}));else setTimeout(check,50)};check()})`);
    await wait(`document.querySelector('#auth-form')`);
    await evaluate(`document.querySelector('#email').value=${JSON.stringify(details.email)};document.querySelector('#password').value=${JSON.stringify(details.password)};document.querySelector('#auth-form').requestSubmit()`);
    await wait(`document.querySelector('#camera-road')?.options.length===3`);
    assert.equal(await evaluate(`!!window.desktopTraffic`), native);
    await evaluate(`document.querySelector('#camera-road').value='hanoi-demo';document.querySelector('#camera-road').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-choice').options.length===5`);
    await evaluate(`document.querySelector('#camera-choice').value='demo';document.querySelector('#camera-choice').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-image')?.hidden===false`);
    assert.match(await evaluate(`document.querySelector('#camera-status').textContent`), /mô phỏng/);
    assert.match(await evaluate(`document.querySelector('#camera-kind').textContent`), /DEMO/);
    const screenshots = resolve(__dirname, '../release/screenshots'); mkdirSync(screenshots, { recursive: true });
    const capture = async filename => {
      await new Promise(resolve => { window.webContents.once('paint', resolve); window.webContents.invalidate(); });
      await new Promise(resolve => setTimeout(resolve, 100));
      writeFileSync(resolve(screenshots, filename), (await window.webContents.capturePage()).toPNG());
    };
    await evaluate(`document.querySelector('#camera-observation').scrollIntoView()`);
    await new Promise(resolve => setTimeout(resolve, 300));
    await capture(native ? 'desktop-camera-demo.png' : 'web-camera-demo.png');
    await evaluate(`document.querySelector('#camera-stop').click()`);
    assert.equal(await evaluate(`document.querySelector('#camera-image').hidden`), true);
    await evaluate(`document.querySelector('#camera-reconnect').click()`);
    await wait(`document.querySelector('#camera-image').hidden===false`);
    await evaluate(`document.querySelector('#camera-choice').value='snapshot';document.querySelector('#camera-choice').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-image').hidden===false`);
    assert.equal(await evaluate(`document.querySelector('#camera-image').naturalWidth`), 80);
    await evaluate(`document.querySelector('#camera-choice').value='mjpeg';document.querySelector('#camera-choice').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-image').hidden===false`);
    assert.match(await evaluate(`document.querySelector('#camera-status').textContent`), /MJPEG/);
    assert.equal((await (await fetch(details.origin + '/test/camera-stats')).json()).sourceStreams, 1);
    await evaluate(`document.querySelector('#camera-stop').click()`);
    let open = 1;
    for (let i=0; i<50 && open; i++) { await new Promise(resolve=>setTimeout(resolve,100)); open=(await (await fetch(details.origin+'/test/camera-stats')).json()).sourceStreams; }
    assert.equal(open, 0, 'Stop must close upstream MJPEG connection');
    await evaluate(`document.querySelector('#camera-choice').value='offline';document.querySelector('#camera-choice').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-status').classList.contains('traffic-error')`);
    assert.equal(await evaluate(`document.querySelector('#camera-image').hasAttribute('src')`), false);
    await evaluate(`document.querySelector('#camera-road').value='empty-road';document.querySelector('#camera-road').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-status').textContent.startsWith('0 camera')`);
    assert.equal(await evaluate(`document.querySelector('#camera-choice').disabled`), true);
    window.setSize(390, 844);
    await evaluate(`document.querySelector('#camera-road').value='hanoi-demo';document.querySelector('#camera-road').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-choice').options.length===5`);
    await evaluate(`document.querySelector('#camera-choice').value='demo';document.querySelector('#camera-choice').dispatchEvent(new Event('change'))`);
    await wait(`document.querySelector('#camera-image').hidden===false`);
    await evaluate(`document.querySelector('#camera-observation').scrollIntoView()`);
    await new Promise(resolve => setTimeout(resolve, 300));
    await capture(native ? 'desktop-camera-mobile.png' : 'web-camera-mobile.png');
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), true);
    await evaluate(`window.dispatchEvent(new Event('traffic-camera-paused'))`);
    assert.equal(await evaluate(`document.querySelector('#camera-image').hidden`), true);
    await evaluate(`document.querySelector('#camera-reconnect').click()`);
    await wait(`document.querySelector('#camera-image').hidden===false`);
    await evaluate(`document.querySelector('#logout').click()`);
    await wait(`document.querySelector('#forgot')`);
    assert.equal(await evaluate(`!!document.querySelector('#camera-observation')`), false);
    console.log(`PASS UC09 ${native?'native desktop':'web'}: real login/cookies, demo/JPEG/MJPEG, Stop cancels upstream, switching, offline/empty states, pause/reconnect, layout and logout cleanup`);
  } catch (error) { console.error(error); exitCode = 1; }
  finally {
    clearTimeout(deadline);
    if (child && child.connected) { const exited = new Promise(resolve => child.once('exit', resolve)); child.send('stop'); await exited; }
    window?.destroy();
    app.exit(exitCode);
  }
});
if (native) require('../src/main.cjs');
