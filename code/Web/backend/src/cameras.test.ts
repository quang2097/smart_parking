import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedCameraOrigins, parseCameraCatalog, validateCameraUrl, demoCameraFrame } from './camera-catalog.js';

test('camera configuration confines URLs to exact, explicitly permitted origins', () => {
  const allowed = allowedCameraOrigins('https://camera.example.com,http://127.0.0.1:8090');
  assert.equal(validateCameraUrl('https://camera.example.com/snapshot.jpg?channel=1', allowed).hostname, 'camera.example.com');
  for (const url of ['https://camera.example.com.evil.test/snapshot', 'http://camera.example.com/snapshot', 'https://camera.example.com:444/snapshot', 'file:///private', 'https://user:password@camera.example.com/snapshot', 'https://camera.example.com/snapshot#fragment']) assert.throws(() => validateCameraUrl(url, allowed));
  assert.throws(() => allowedCameraOrigins('https://camera.example.com/api'));
});
test('camera catalog validates identities, formats, polling bounds and credentials', () => {
  const allowed = allowedCameraOrigins('https://camera.example.com');
  const camera = { id: 'one', name: 'Camera one', source: 'Authorized test source', kind: 'snapshot', url: 'https://camera.example.com/image.jpg', refreshSeconds: 10 };
  const catalog = (item: unknown) => ({ roads: [{ id: 'road', name: 'Road', location: 'Hanoi', cameras: [item] }] });
  assert.equal(parseCameraCatalog(catalog(camera), allowed).roads[0].cameras[0].kind, 'snapshot');
  for (const patch of [{ id: undefined }, { id: '../secret' }, { kind: 'rtsp' }, { refreshSeconds: 0 }, { refreshSeconds: 301 }, { url: 'https://other.example.com/image.jpg' }, { authorizationEnv: 'invalid-secret' }]) assert.throws(() => parseCameraCatalog(catalog({ ...camera, ...patch }), allowed));
  assert.throws(() => parseCameraCatalog({ roads: [{ name: 'Missing identity', location: 'Hanoi', cameras: [] }] }, allowed));
  assert.throws(() => parseCameraCatalog({ roads: [{ id: 'r', name: 'Road', location: 'Hanoi', cameras: [camera, camera] }] }, allowed));
});
test('demo frames are explicitly labelled, change with time and escape source labels', () => {
  const camera = { id: 'demo', name: '<script>alert(1)</script>', source: 'Local demo', kind: 'demo' as const, refreshSeconds: 5 };
  const first = demoCameraFrame(camera, 1000);
  assert.match(first, /DEMO/); assert.match(first, /KHÔNG PHẢI CAMERA HÀ NỘI/);
  assert.doesNotMatch(first, /<script>/); assert.match(first, /&lt;script&gt;/);
  assert.notEqual(first, demoCameraFrame(camera, 2000));
});
