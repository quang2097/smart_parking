import { fork, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const backendDir = fileURLToPath(new URL('../../Web/backend/', import.meta.url));
const child = fork(resolve(backendDir, 'src/testing/camera-web-fixture.ts'), [], {
  cwd: backendDir, execArgv: ['--import', pathToFileURL(resolve(backendDir, 'node_modules/tsx/dist/loader.mjs')).href], silent: true,
});
child.stderr.on('data', data => process.stderr.write(data));
const sdk = process.env.ANDROID_HOME || `${process.env.LOCALAPPDATA}/Android/Sdk`;
const serial = process.env.ANDROID_SERIAL || 'emulator-5554';
const executable = resolve(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const adb = (...args) => {
  const result = spawnSync(executable, ['-s', serial, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};
let ws, evaluate, originalBackend, port;
try {
  const details = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', code => reject(new Error(`Camera backend exited: ${code}`))); });
  if (details.error) throw new Error(details.error);
  port = new URL(details.origin).port;
  adb('reverse', `tcp:${port}`, `tcp:${port}`);
  adb('shell', 'am', 'start', '-n', 'com.smarttraffic.android/.MainActivity');
  let socket;
  for (let i=0; i<50 && !socket; i++) {
    let pid;
    try { pid = adb('shell', 'pidof', 'com.smarttraffic.android'); }
    catch { await new Promise(resolve=>setTimeout(resolve,100)); continue; }
    socket = adb('shell', 'cat', '/proc/net/unix').match(new RegExp(`@webview_devtools_remote_${pid}\\b`))?.[0].slice(1);
    if (!socket) await new Promise(resolve=>setTimeout(resolve,100));
  }
  if (!socket) throw new Error('Debug WebView not found; install and launch the current debug APK.');
  adb('forward', 'tcp:9223', `localabstract:${socket}`);
  const targets = await (await fetch('http://127.0.0.1:9223/json')).json();
  const target = targets.find(item => item.type==='page' && item.url.startsWith('https://localhost'));
  if (!target) throw new Error('App WebView not found');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let sequence=0; const pending=new Map();
  ws.onmessage = event => { const message=JSON.parse(event.data);
    const callback=pending.get(message.id); if(callback){pending.delete(message.id);if(message.error)callback.reject(new Error(message.error.message));else callback.resolve(message.result)} };
  const command=(method,params)=>new Promise((resolve,reject)=>{
    const id=++sequence;const deadline=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`))},15000);
    pending.set(id,{resolve:value=>{clearTimeout(deadline);resolve(value)},reject:error=>{clearTimeout(deadline);reject(error)}});ws.send(JSON.stringify({id,method,params}));
  });
  evaluate=async expression=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value};
  const wait=async expression=>{const end=Date.now()+15000;while(Date.now()<end){try{if(await evaluate(expression))return}catch{}await new Promise(resolve=>setTimeout(resolve,100))}throw new Error(`Android camera UI timed out: ${expression}`)};
  const closed=async()=>{let active=1;for(let i=0;i<60 && active;i++){await new Promise(resolve=>setTimeout(resolve,100));active=(await(await fetch(details.origin+'/test/camera-stats')).json()).sourceStreams}assert.equal(active,0,'Camera must close its upstream stream')};
  const choose=async id=>{
    await evaluate(`document.querySelector('#camera-choice').value=${JSON.stringify(id)};document.querySelector('#camera-choice').dispatchEvent(new Event('change'))`);
    try { await wait(`document.querySelector('#camera-image').hidden===false`); }
    catch(error) { throw new Error(`${id}: ${await evaluate(`document.querySelector('#camera-status').textContent`)}; ${error.message}`); }
  };
  originalBackend=await evaluate(`localStorage.getItem('smart-traffic.backend')`);
  await evaluate(`localStorage.setItem('smart-traffic.backend',${JSON.stringify(`http://127.0.0.1:${port}`)})`);
  await command('Page.reload',{});await wait(`!!document.querySelector('#auth-form')`);
  assert.equal(await evaluate(`window.Capacitor.isPluginAvailable('TrafficCamera')`),true);
  assert.equal(await evaluate(`(async()=>{try{await window.Capacitor.Plugins.TrafficCamera.setBackend({base:'file:///private'});return false}catch{return true}})()`),true);
  await evaluate(`document.querySelector('#email').value=${JSON.stringify(details.email)};document.querySelector('#password').value=${JSON.stringify(details.password)};document.querySelector('#auth-form').requestSubmit()`);
  await wait(`document.querySelector('#camera-road')?.options.length===3`);
  await evaluate(`document.querySelector('#camera-road').value='hanoi-demo';document.querySelector('#camera-road').dispatchEvent(new Event('change'))`);
  await wait(`document.querySelector('#camera-choice').options.length===5`);
  await choose('demo');assert.match(await evaluate(`document.querySelector('#camera-kind').textContent`),/DEMO/);
  const output=fileURLToPath(new URL('../android/app/build/outputs/',import.meta.url));mkdirSync(output,{recursive:true});
  await evaluate(`document.querySelector('#camera-observation').scrollIntoView()`);
  await new Promise(resolve=>setTimeout(resolve,300));
  const screenshot=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});writeFileSync(resolve(output,'android-camera-demo.png'),Buffer.from(screenshot.data,'base64'));
  await choose('snapshot');assert.equal(await evaluate(`document.querySelector('#camera-image').naturalWidth`),80);
  await choose('mjpeg');assert.match(await evaluate(`document.querySelector('#camera-status').textContent`),/MJPEG/);
  assert.equal((await(await fetch(details.origin+'/test/camera-stats')).json()).sourceStreams,1);
  await evaluate(`document.querySelector('#camera-stop').click()`);await closed();
  await evaluate(`document.querySelector('#camera-reconnect').click()`);await wait(`document.querySelector('#camera-image').hidden===false`);
  adb('shell','input','keyevent','KEYCODE_HOME');await closed();
  adb('shell','am','start','-n','com.smarttraffic.android/.MainActivity');
  await wait(`document.querySelector('#camera-image').hidden===true`);
  await evaluate(`document.querySelector('#camera-reconnect').click()`);await wait(`document.querySelector('#camera-image').hidden===false`);
  await evaluate(`document.querySelector('#camera-choice').value='offline';document.querySelector('#camera-choice').dispatchEvent(new Event('change'))`);
  await wait(`document.querySelector('#camera-status').classList.contains('traffic-error')`);await closed();
  assert.equal(await evaluate(`document.querySelector('#camera-image').hasAttribute('src')`),false);
  await evaluate(`document.querySelector('#camera-road').value='empty-road';document.querySelector('#camera-road').dispatchEvent(new Event('change'))`);
  await wait(`document.querySelector('#camera-status').textContent.startsWith('0 camera')`);
  assert.equal(await evaluate(`document.querySelector('#camera-choice').disabled`),true);
  await evaluate(`document.querySelector('#logout').click()`);await wait(`!!document.querySelector('#forgot')`);
  assert.equal(await evaluate(`(async()=>(await fetch('/api/cameras/demo/snapshot')).status)()`),401);
  console.log('PASS Android UC09: actual backend/native session cookies, demo/JPEG/MJPEG, Stop and background cancellation, reconnect, camera switching, stale-image removal, empty road and logout');
} finally {
  if(evaluate){try{await evaluate(`window.Capacitor.Plugins.TrafficCamera.stopMedia()`);await evaluate(`window.Capacitor.Plugins.CapacitorCookies.clearAllCookies()`);await evaluate(originalBackend===null?`localStorage.removeItem('smart-traffic.backend')`:`localStorage.setItem('smart-traffic.backend',${JSON.stringify(originalBackend)})`);await evaluate(`location.reload()`)}catch{}}
  ws?.close();try{adb('forward','--remove','tcp:9223');if(port)adb('reverse','--remove',`tcp:${port}`)}catch{}
  if(child.connected){const stopped=new Promise(resolve=>child.once('exit',resolve));child.send('stop');await stopped}
}
