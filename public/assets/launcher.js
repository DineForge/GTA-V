'use strict';
const form = document.getElementById('launch-form');
const checkButton = document.getElementById('check-device');
const playButton = document.getElementById('play-button');
const feedback = document.getElementById('feedback');
const summary = document.getElementById('device-summary');
const list = document.getElementById('checks');
const presets = {
  safe: { low: '1', fps: '30', res: '1280x720', shadows: '0' },
  performance: { low: '1', fps: '60', res: '960x540', shadows: '0' },
  balanced: { low: '1', fps: '60', res: '1280x720', shadows: '0' },
  quality: { low: '1', fps: '60', res: '1920x1080', shadows: '0' }
};
let checking = false;
async function checkDevice() {
  if (checking) return false;
  checking = true;
  playButton.disabled = true;
  checkButton.disabled = true;
  checkButton.textContent = 'Checking…';
  feedback.textContent = '';
  summary.textContent = 'Checking browser and graphics support…';
  list.hidden = false;
  list.replaceChildren();
  const failures = [];
  function result(label, passed, reason) {
    const item = document.createElement('li');
    item.textContent = `${passed ? 'Pass' : 'Unavailable'} · ${label}`;
    list.append(item);
    if (!passed) failures.push(reason);
  }
  let device;
  try {
    result('Secure connection', isSecureContext, 'Open this site over HTTPS.');
    result('Shared memory / isolation', crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined', 'Shared memory is unavailable. Open the site directly, outside an embedded browser.');
    result('OffscreenCanvas', typeof OffscreenCanvas !== 'undefined', 'Update to a desktop browser with OffscreenCanvas support.');
    const memory64 = typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,5,4,1,7,0,1]));
    result('WebAssembly Memory64', memory64, 'Update Chrome or Edge to a version supporting WebAssembly Memory64.');
    let adapter;
    try { adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }); } catch {}
    result('WebGPU adapter', !!adapter, 'Enable hardware acceleration and use a WebGPU-capable browser and GPU.');
    if (adapter) {
      result('BC texture compression', adapter.features.has('texture-compression-bc'), 'This GPU lacks the BC texture compression required by the renderer.');
      try { device = await adapter.requestDevice(); result('Basic GPU device', true); }
      catch { result('Basic GPU device', false, 'The graphics device could not start. Update the browser and GPU driver.'); }
    }
    try {
      const status = await fetch('/api/game-status', { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      const installed = status.ok && (await status.json()).ready;
      result('Independent game asset copy', installed, 'The complete game asset copy is not ready. Retry later.');
      const response = await fetch('/b/8b0b5899ed/loader.js', { signal: AbortSignal.timeout(15000) });
      const code = response.ok ? await response.text() : '';
      result('Game engine delivery', response.ok && code.includes('importScripts'), 'Game asset delivery is unavailable. Try again later or open the browser guide.');
    } catch { result('Game engine delivery', false, 'Game storage did not respond. Check your connection and try again.'); }
    summary.textContent = failures.length ? 'This device is not ready to launch.' : 'Basic checks passed. Ready to try.';
    feedback.textContent = failures.length ? failures.join(' ') : 'Basic checks do not guarantee world rendering or performance.';
    return failures.length === 0;
  } catch {
    summary.textContent = 'Device check could not finish.';
    feedback.textContent = 'Retry the check or open the full browser guide below.';
    return false;
  } finally {
    device?.destroy();
    checking = false;
    playButton.disabled = false;
    checkButton.disabled = false;
    checkButton.textContent = 'Check again ↗';
  }
}
checkButton.addEventListener('click', checkDevice);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (checking) return;
  const mode = new FormData(form).get('mode');
  const profile = document.getElementById('preset').value;
  if (!await checkDevice()) return;
  const params = new URLSearchParams({ ...presets[profile], mode });
  playButton.disabled = true;
  playButton.textContent = 'Opening Los Santos…';
  location.assign('/play/?' + params.toString());
});
