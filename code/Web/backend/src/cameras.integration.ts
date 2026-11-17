import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { digest, newToken } from './security.js';
import { cameraRouter } from './cameras.js';
import { parseCameraCatalog } from './camera-catalog.js';

test('UC09 Hanoi observation: road → camera → authenticated demo/snapshot/MJPEG; safe source failures', async () => {
  const ids = [randomUUID(), randomUUID()], tokens = [newToken(), newToken()];
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  let receivedAuthorization = '', receivedCookie = '', redirectTargetHit = false;
  const held: ServerResponse[] = [];
  const source = createServer((req, res) => {
    receivedAuthorization = String(req.headers.authorization ?? '');
    receivedCookie = String(req.headers.cookie ?? '');
    if (req.url === '/hold') { held.push(res); }
    else if (req.url === '/image') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(image); }
    else if (req.url === '/stream') { res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary=frame' }); res.end(Buffer.concat([Buffer.from('--frame\r\nContent-Type: image/png\r\n\r\n'), image, Buffer.from('\r\n--frame--\r\n')])); }
    else if (req.url === '/redirect') { res.writeHead(302, { Location: '/private' }); res.end(); }
    else if (req.url === '/private') { redirectTargetHit = true; res.end('secret'); }
    else if (req.url === '/html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<script>bad()</script>'); }
    else if (req.url === '/huge') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(Buffer.alloc(5 * 1024 * 1024 + 1)); }
    else { res.writeHead(503); res.end('Source offline'); }
  });
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve));
  const address = source.address(); assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const previous = process.env.CAMERA_ALLOWED_ORIGINS, previousSecret = process.env.CAMERA_TEST_AUTH;
  process.env.CAMERA_ALLOWED_ORIGINS = origin; process.env.CAMERA_TEST_AUTH = 'Bearer fixture-only-secret';
  const catalog = parseCameraCatalog({ roads: [
    { id: 'road-a', name: 'Kim Mã · test', location: 'Hanoi test only', cameras: [
      { id: 'demo-a', name: 'Demo A', kind: 'demo', source: 'Local simulation' },
      ...['image','stream','redirect','html','huge','offline','hold'].map(path => ({ id: path, name: path, source: 'Authorized fixture', kind: path === 'stream' ? 'mjpeg' : 'snapshot', url: `${origin}/${path}`, authorizationEnv: 'CAMERA_TEST_AUTH' })),
    ] }, { id: 'road-b', name: 'Giải Phóng · test', location: 'Hanoi test only', cameras: [] },
  ] }, new Set([origin]));
  const app = express();
  app.use('/api/cameras', cameraRouter(req => req.headers.cookie?.match(/traffic_session=([a-f0-9]{64})/)?.[1] ?? '', catalog));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const apiAddress = server.address(); assert.ok(apiAddress && typeof apiAddress !== 'string');
  const get = (path: string, actor?: number) => fetch(`http://127.0.0.1:${apiAddress.port}/api/cameras/${path}`, { headers: actor === undefined ? {} : { Cookie: `traffic_session=${tokens[actor]}` } });
  try {
    for (let i = 0; i < ids.length; i++) {
      await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Camera test',$3,'unused')", [ids[i], `camera-${ids[i]}@example.com`, i ? 'user' : 'admin']);
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(tokens[i]), ids[i]]);
    }
    for (const path of ['roads','roads/road-a/cameras','demo-a/snapshot','stream/stream']) assert.equal((await get(path)).status, 401);
    for (const role of [0,1]) {
      const roads = await (await get('roads', role)).json(); assert.equal(roads.roads.length, 2); assert.equal(roads.ihanoiConnected, false);
      const response = await get('roads/road-a/cameras', role), text = await response.text();
      assert.doesNotMatch(text, /fixture-only-secret|CAMERA_TEST_AUTH|127\.0\.0\.1|authorizationEnv|"url"/);
      assert.equal(JSON.parse(text).cameras.length, 8);
      const demo = await get('demo-a/snapshot', role); assert.match(demo.headers.get('content-type')!, /image\/svg\+xml/); assert.match(await demo.text(), /DEMO/);
    }
    assert.deepEqual((await (await get('roads/road-b/cameras', 1)).json()).cameras, []);
    assert.equal((await get('roads/missing/cameras', 1)).status, 404);
    assert.equal((await get('missing/snapshot', 1)).status, 404);
    assert.equal((await get('image/stream', 1)).status, 400);
    const snapshot = await get('image/snapshot?url=http://untrusted.invalid', 1);
    assert.equal(snapshot.status, 200); assert.deepEqual(Buffer.from(await snapshot.arrayBuffer()), image);
    assert.equal(receivedAuthorization, 'Bearer fixture-only-secret'); assert.equal(receivedCookie, ''); assert.ok(snapshot.headers.get('x-camera-received-at'));
    const stream = await get('stream/stream', 1); assert.equal(stream.status, 200); assert.match(await stream.text(), /--frame/);
    for (const path of ['redirect','html','huge','offline']) {
      const response = await get(`${path}/snapshot`, 1); assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /fixture-only-secret|private|127\.0\.0\.1/);
    }
    assert.equal(redirectTargetHit, false);
    const pending = [get('hold/snapshot', 1), get('hold/snapshot', 1)];
    for (let i = 0; i < 150 && held.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(held.length, 2);
    assert.equal((await get('image/snapshot', 1)).status, 429);
    for (const response of held) { response.writeHead(200, { 'Content-Type': 'image/png' }); response.end(image); }
    for (const response of await Promise.all(pending)) { assert.equal(response.status, 200); await response.arrayBuffer(); }
    delete process.env.CAMERA_TEST_AUTH;
    assert.equal((await get('image/snapshot', 1)).status, 502);
    await pool.query('UPDATE users SET active=false WHERE id=$1', [ids[1]]);
    assert.equal((await get('demo-a/snapshot', 1)).status, 401);
    await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [ids[0]]);
    assert.equal((await get('roads', 0)).status, 401);
  } finally {
    for (const response of held) if (!response.writableEnded) response.end();
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => source.close(() => resolve()));
    if (previous === undefined) delete process.env.CAMERA_ALLOWED_ORIGINS; else process.env.CAMERA_ALLOWED_ORIGINS = previous;
    if (previousSecret === undefined) delete process.env.CAMERA_TEST_AUTH; else process.env.CAMERA_TEST_AUTH = previousSecret;
    await pool.end();
  }
});
