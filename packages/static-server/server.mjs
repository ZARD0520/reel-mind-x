import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as proxyRequest } from 'node:http';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 80);
const distDir = join(process.cwd(), 'dist');
const apiOrigin = process.env.API_ORIGIN || 'http://api:3888';

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

function proxy(req, res, prefix) {
  const target = new URL(req.url || '/', apiOrigin);
  target.pathname = target.pathname.replace(prefix, '') || '/';

  const upstream = proxyRequest(
    target,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
        'x-forwarded-host': req.headers.host || '',
        'x-forwarded-proto': 'http',
      },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstream.on('error', () => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad gateway');
  });
  req.pipe(upstream);
}

async function serveFile(res, filePath) {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error('not a file');
    }
    res.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    proxy(req, res, '/api');
    return;
  }

  if (url.pathname.startsWith('/static/')) {
    proxy(req, res, '/static');
    return;
  }

  if (url.pathname.startsWith('/files/')) {
    proxy(req, res, '');
    return;
  }

  const requestedPath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(distDir, requestedPath === '/' ? 'index.html' : requestedPath);
  const fallbackPath = join(distDir, 'index.html');

  try {
    const fileStat = await stat(filePath);
    await serveFile(res, fileStat.isFile() ? filePath : fallbackPath);
  } catch {
    await serveFile(res, fallbackPath);
  }
}).listen(port, '0.0.0.0');
