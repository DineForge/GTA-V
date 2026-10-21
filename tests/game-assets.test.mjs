import test from 'node:test';
import assert from 'node:assert/strict';
import { serveGameAsset } from '../hosting/serve-game-assets.mjs';

function fixture() {
  const body = new Uint8Array([0, 97, 115, 109, 1, 2, 3, 4]);
  const catalog = { inventoryHash: 'inventory', sourceFiles: 12482, sourceBytes: 21158604965, files: { '/b/test/engine.wasm': { key: 'sha256/abc', size: 8, type: 'application/wasm' } } };
  const calls = [];
  const store = {
    async getMetadata(key) { calls.push(['metadata', key]); return {}; },
    async get(key, options) {
      calls.push(['get', key, options.type]);
      if (key.startsWith('ready/')) return { inventoryHash: 'inventory', sourceFiles: 12482, sourceBytes: 21158604965 };
      return options.type === 'stream' ? new Blob([body]).stream() : body.slice().buffer;
    }
  };
  const request = (headers = {}, method = 'GET', path = '/b/test/engine.wasm') => new Request('https://bta.example' + path, { method, headers });
  return { catalog, store, calls, request };
}

test('full asset streams with WASM MIME, isolation, and immutable cache headers', async () => {
  const f = fixture();
  const response = await serveGameAsset(f.request(), f.store, f.catalog);
  assert.equal(response.status, 200);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0,97,115,109,1,2,3,4]);
  assert.equal(response.headers.get('Content-Type'), 'application/wasm');
  assert.equal(response.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
  assert.match(response.headers.get('Cache-Control'), /immutable/);
});

test('closed, open, and suffix ranges return the requested bytes', async () => {
  for (const [range, expected, contentRange] of [['bytes=1-3',[97,115,109],'bytes 1-3/8'],['bytes=6-',[3,4],'bytes 6-7/8'],['bytes=-2',[3,4],'bytes 6-7/8']]) {
    const f = fixture();
    const response = await serveGameAsset(f.request({ Range: range }), f.store, f.catalog);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), contentRange);
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], expected);
  }
});

test('invalid ranges are rejected without a storage body read', async () => {
  for (const range of ['bytes=8-9','bytes=4-2','bytes=-0','bytes=0-1,3-4','bytes=9007199254740992-']) {
    const f = fixture();
    const response = await serveGameAsset(f.request({ Range: range }), f.store, f.catalog);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('Content-Range'), 'bytes */8');
    assert.equal(f.calls.some(c => c[0] === 'get'), false);
  }
});

test('HEAD and conditional requests avoid reading file bodies', async () => {
  const f = fixture();
  const head = await serveGameAsset(f.request({}, 'HEAD'), f.store, f.catalog);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '8');
  assert.equal(await head.text(), '');
  const cached = await serveGameAsset(f.request({ 'If-None-Match': '"abc"' }), f.store, f.catalog);
  assert.equal(cached.status, 304);
  assert.equal(f.calls.some(c => c[0] === 'get'), false);
});

test('mismatched If-Range returns the full object', async () => {
  const f = fixture();
  const response = await serveGameAsset(f.request({ Range: 'bytes=0-3', 'If-Range': '"old"' }), f.store, f.catalog);
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 8);
});

test('unknown paths and methods do not access storage', async () => {
  const f = fixture();
  assert.equal((await serveGameAsset(f.request({}, 'GET', '/b/test/missing'), f.store, f.catalog)).status, 404);
  assert.equal((await serveGameAsset(f.request({}, 'POST'), f.store, f.catalog)).status, 405);
  assert.deepEqual(f.calls, []);
});

test('missing and failed storage return uncached errors without a remote fallback', async () => {
  const f = fixture();
  f.store.getMetadata = async () => null;
  const missing = await serveGameAsset(f.request(), f.store, f.catalog);
  assert.equal(missing.status, 503);
  assert.equal(missing.headers.get('Cache-Control'), 'no-store');
  f.store.getMetadata = async () => { throw new Error('internal detail'); };
  const failed = await serveGameAsset(f.request(), f.store, f.catalog);
  assert.equal(failed.status, 503);
  assert.equal((await failed.text()).includes('internal detail'), false);
});

test('readiness requires the receipt for the complete inventory', async () => {
  const f = fixture();
  const good = await serveGameAsset(f.request({}, 'GET', '/api/game-status'), f.store, f.catalog);
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), { ready: true, files:12482, bytes:21158604965 });
  f.store.get = async () => ({ inventoryHash:'inventory', sourceFiles:1, sourceBytes:8 });
  const partial = await serveGameAsset(f.request({}, 'GET', '/api/game-status'), f.store, f.catalog);
  assert.equal(partial.status, 503);
  assert.equal((await partial.json()).ready, false);
});
