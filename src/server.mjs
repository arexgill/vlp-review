import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildReport } from './build-report.mjs';

const HOST = '127.0.0.1';
const STATIC = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);
const BODY_LIMIT = 256 * 1024;
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(response, status, body, contentType = 'application/json; charset=utf-8', extraHeaders = {}) {
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    'content-type': contentType
  });
  response.end(body);
}

function sendJson(response, status, value, extraHeaders) {
  send(response, status, JSON.stringify(value), 'application/json; charset=utf-8', extraHeaders);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let oversized = false;

    request.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        oversized = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      if (oversized) {
        reject(new HttpError(413, 'Request body exceeds 256 KiB'));
        return;
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON'));
      }
    });
  });
}

async function serveStatic(response, publicDir, pathname, method) {
  const asset = STATIC.get(pathname);
  if (!asset) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(response, 405, { error: 'Method not allowed' }, { allow: 'GET, HEAD' });
    return;
  }

  const [fileName, contentType] = asset;
  try {
    const contents = await readFile(path.join(publicDir, fileName));
    send(response, 200, method === 'HEAD' ? '' : contents, contentType);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }
    throw error;
  }
}

export function createVlpServer({ session, publicDir }) {
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${HOST}`);
      if (url.pathname === '/api/session') {
        if (request.method !== 'GET') {
          sendJson(response, 405, { error: 'Method not allowed' }, { allow: 'GET' });
          return;
        }

        const clientSession = {
          ...session,
          openapi: session.openapi ? { paths: Object.keys(session.openapi.paths || {}) } : null
        };
        sendJson(response, 200, clientSession);
        return;
      }

      if (url.pathname === '/api/report') {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Method not allowed' }, { allow: 'POST' });
          return;
        }
        if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
          throw new HttpError(415, 'Content-Type must be application/json');
        }
        const payload = await readJson(request);
        const markdown = buildReport(session, payload.responses || []);
        sendJson(response, 200, { markdown });
        return;
      }

      await serveStatic(response, publicDir, url.pathname, request.method || 'GET');
    } catch (error) {
      const status = error.status || 500;
      const message = status === 500 ? 'Internal server error' : error.message;
      if (!response.headersSent) sendJson(response, status, { error: message });
      else response.end();
    }
  });
}

export function listen(server, { port }) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      resolve({ host: HOST, port: actualPort, url: `http://${HOST}:${actualPort}` });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, HOST);
  });
}
