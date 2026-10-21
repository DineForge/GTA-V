/** Serve only cataloged, immutable files. No upstream fallback is permitted. */
export async function serveGameAsset(request, store, catalog) {
  const pathname = new URL(request.url).pathname;
  const isolation = {
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff'
  };
  const error = (message, status, extra = {}) => new Response(request.method === 'HEAD' ? null : message, {
    status, headers: { ...isolation, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
  });
  if (!['GET', 'HEAD'].includes(request.method)) return error('Method not allowed', 405, { Allow: 'GET, HEAD' });
  if (pathname === '/api/game-status') {
    try {
      const receipt = await store.get('ready/' + catalog.inventoryHash, { type: 'json' });
      const ready = !!receipt && receipt.inventoryHash === catalog.inventoryHash && receipt.sourceFiles === catalog.sourceFiles && receipt.sourceBytes === catalog.sourceBytes;
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ready, files: ready ? receipt.sourceFiles : 0, bytes: ready ? receipt.sourceBytes : 0 }), {
        status: ready ? 200 : 503,
        headers: { ...isolation, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    } catch { return error('Game storage is temporarily unavailable', 503, { 'Retry-After': '30' }); }
  }
  let decoded;
  try { decoded = decodeURI(pathname); } catch { return error('Invalid path', 400); }
  const file = Object.hasOwn(catalog.files, decoded) ? catalog.files[decoded] : null;
  if (!file) return error('Game asset not found', 404);
  const etag = '"' + file.key.slice('sha256/'.length) + '"';
  const headers = { ...isolation, 'Content-Type': file.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'Netlify-CDN-Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes', ETag: etag };
  // Readiness is audited during import; never substitute remote files for missing blobs.
  try {
    if (!await store.getMetadata(file.key)) return error('Game asset is not installed', 503, { 'Retry-After': '30' });
    const match = request.headers.get('If-None-Match');
    if (match?.split(',').map(s => s.trim().replace(/^W\//, '')).some(s => s === etag || s === '*')) {
      return new Response(null, { status: 304, headers });
    }
    let start = 0, end = file.size - 1;
    let range = request.headers.get('Range');
    const ifRange = request.headers.get('If-Range');
    if (ifRange && ifRange !== etag) range = null;
    if (range) {
      const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
      const invalid = () => error('Invalid byte range', 416, { 'Content-Range': `bytes */${file.size}` });
      if (!parsed || (!parsed[1] && !parsed[2]) || !file.size) return invalid();
      if (parsed[1]) {
        start = Number(parsed[1]);
        if (parsed[2]) end = Math.min(Number(parsed[2]), end);
      } else {
        const suffix = Number(parsed[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
        start = Math.max(0, file.size - suffix);
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= file.size) return invalid();
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1));
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`;
    if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
    if (range) {
      const bytes = await store.get(file.key, { type: 'arrayBuffer' });
      if (!bytes || bytes.byteLength !== file.size) return error('Game asset is incomplete', 503);
      return new Response(bytes.slice(start, end + 1), { status: 206, headers });
    }
    const stream = await store.get(file.key, { type: 'stream' });
    if (!stream) return error('Game asset is not installed', 503, { 'Retry-After': '30' });
    return new Response(stream, { headers });
  } catch { return error('Game storage is temporarily unavailable', 503, { 'Retry-After': '30' }); }
}
