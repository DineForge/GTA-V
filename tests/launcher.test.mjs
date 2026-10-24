import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/assets/launcher.js', import.meta.url), 'utf8');
function launcher(validEngine) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: 'safe', textContent: '', handlers: {},
      addEventListener(type, handler) { this.handlers[type] = handler; },
      append() {}, replaceChildren() {} });
    return elements.get(id);
  };
  let destination;
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => ({}) },
    isSecureContext: true, crossOriginIsolated: true, SharedArrayBuffer, OffscreenCanvas: class {},
    WebAssembly: { validate: () => true },
    navigator: { gpu: { requestAdapter: async () => ({ features: new Set(['texture-compression-bc']), requestDevice: async () => ({ destroy() {} }) }) } },
    AbortSignal, URLSearchParams, Uint8Array,
    FormData: class { get() { return 'story'; } },
    location: { assign(url) { destination = url; } },
    async fetch(url, options) {
      requests.push([url, options]);
      if (url === '/api/game-status') return Response.json({ ready: true });
      if (url.endsWith('/loader.js')) return new Response("importScripts('/chunk-index.js', '/chunk-fetch.js');");
      if (url === '/assets/game-engine.json') return Response.json({ url: '/__chunks/engine/0000.bin' });
      return new Response(new Uint8Array(validEngine ? [0,97,115,109,1,0,0,0] : [60,104,116,109,108,62,0,0]), { status: 206 });
    }
  });
  vm.runInContext(source, context);
  return { elements, requests, destination: () => destination,
    launch: () => element('launch-form').handlers.submit({ preventDefault() {} }) };
}

test('launch verifies the stored engine and forwards selected mode and graphics', async () => {
  const app = launcher(true);
  await app.launch();
  const destination = new URL(app.destination(), 'https://example.test');
  assert.equal(destination.pathname, '/play/');
  assert.equal(destination.searchParams.get('mode'), 'story');
  assert.equal(destination.searchParams.get('fps'), '30');
  assert.equal(app.requests.find(([url]) => url.startsWith('/__chunks/'))[1].headers.Range, 'bytes=0-7');
});

test('a corrupt or HTML engine response keeps the player on the launcher', async () => {
  const app = launcher(false);
  await app.launch();
  assert.equal(app.destination(), undefined);
  assert.match(app.elements.get('feedback').textContent, /engine could not be read/);
  assert.equal(app.elements.get('play-button').disabled, false);
});
