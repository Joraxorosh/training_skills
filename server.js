'use strict';

// Минимальный статический сервер без зависимостей.
// Запуск: node server.js  (PORT и HOST можно задать через переменные окружения)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const zlib = require('zlib');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.txt', '.md']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; manifest-src 'self'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some((part) => {
    const tag = part.trim();
    return tag === etag || tag.replace(/^W\//, '') === bare;
  });
}

function pickEncoding(ext, acceptEncoding) {
  if (!COMPRESSIBLE.has(ext) || !acceptEncoding) return null;
  if (/\bbr\b/i.test(acceptEncoding)) return 'br';
  if (/\bgzip\b/i.test(acceptEncoding)) return 'gzip';
  return null;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (pathname.includes('\0')) return send(res, 400, 'Bad Request');

  if (pathname === '/healthz') return send(res, 200, 'ok', { 'Cache-Control': 'no-store' });
  if (pathname.endsWith('/')) pathname += 'index.html';

  const file = path.join(ROOT, path.normalize(pathname));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, 'Not Found');

    const ext = path.extname(file).toLowerCase();
    const etag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
      'Last-Modified': stat.mtime.toUTCString(),
      Vary: 'Accept-Encoding',
    };

    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, headers);
      return res.end();
    }

    const encoding = pickEncoding(ext, req.headers['accept-encoding']);
    if (encoding) headers['Content-Encoding'] = encoding;
    else headers['Content-Length'] = stat.size;

    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();

    const stream = fs.createReadStream(file);
    const onError = (streamErr) => {
      if (streamErr && !res.destroyed) res.destroy();
    };
    if (encoding === 'br') {
      pipeline(stream, zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }), res, onError);
    } else if (encoding === 'gzip') {
      pipeline(stream, zlib.createGzip(), res, onError);
    } else {
      pipeline(stream, res, onError);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Тренажёр запущен: http://localhost:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
