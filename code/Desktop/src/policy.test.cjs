const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { validateRequest, assetPath, validateCameraMediaPath } = require('./policy.cjs');
test('native bridge confines calls to known API endpoints and root backend addresses', () => {
  assert.equal(validateRequest('http://localhost:3000', '/api/auth/login', { email: 'operator@example.com' }).url, 'http://localhost:3000/api/auth/login');
  assert.equal(validateRequest('https://traffic.example.com', '/api/traffic/intersections/abcd-1234/history').payload, undefined);
  for (const base of ['file:///C:/private', 'http://user:pass@localhost', 'https://example.com/api', 'https://example.com/?next=other']) assert.throws(() => validateRequest(base, '/api/health'));
  for (const route of ['//evil.example/api/health', '/api/auth/login?redirect=other', '/api/../private', '/private']) assert.throws(() => validateRequest('http://localhost:3000', route));
  assert.throws(() => validateRequest('http://localhost:3000', '/api/auth/login', { data: 'x'.repeat(9000) }));
});
test('packaged asset handler rejects encoded traversal', () => {
  const root = path.resolve('ui');
  assert.equal(assetPath(root, '/assets/app.js'), path.join(root, 'assets', 'app.js'));
  assert.throws(() => assetPath(root, '/%2e%2e/private'));
  assert.throws(() => assetPath(root, '/%2e%2e%5cprivate'));
});
test('camera metadata and media are read-only, bounded routes without URL injection', () => {
  assert.equal(validateRequest('http://localhost:3000', '/api/cameras/roads').url, 'http://localhost:3000/api/cameras/roads');
  assert.ok(validateRequest('https://example.com', '/api/cameras/roads/kim-ma/cameras'));
  assert.throws(() => validateRequest('http://localhost:3000', '/api/cameras/roads', {}));
  assert.equal(validateCameraMediaPath('/api/cameras/camera-one/stream'), '/api/cameras/camera-one/stream');
  for (const route of ['/api/cameras/camera-one/snapshot?url=http://evil.test', '/api/cameras/../private/snapshot', 'https://evil.test/api/cameras/cam/snapshot', '/api/cameras/roads']) assert.throws(() => validateCameraMediaPath(route));
});
