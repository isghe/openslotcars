#!/usr/bin/env node
/**
 * Minimal static file server for local development.
 *
 * Browsers refuse to load ES modules from `file://` pages, so the game has to
 * be served over HTTP. Once published (for example on GitHub Pages) the files
 * are served the same way; this script does it on the local machine, with no
 * dependencies.
 *
 * Usage: node scripts/serve.mjs [--port 8080]
 *        PORT=8080 node scripts/serve.mjs
 *
 * The server listens on the loopback address only and serves the project
 * folder. Paths with dot segments (such as `.git`) are never served.
 *
 * Links (symbolic links and Windows junctions) are followed only while they
 * stay inside the served folder: both the folder and every file are resolved
 * to their real location, which must lie inside the real folder and must not
 * go through a dot segment either. The check and the read are two separate
 * steps, so this is not a defense against another process that changes the
 * served folder at the very moment of a request.
 */

import { createServer } from 'node:http';
import { stat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CONTENT_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
});

function send(response, status, headers, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function sendText(response, status, text, extraHeaders = {}) {
  send(
    response,
    status,
    {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(text),
      ...extraHeaders,
    },
    text,
  );
}

/**
 * Maps the path of a request to a file path inside `root`.
 * @returns {string|null} The absolute path, or `null` if the path is not
 *   allowed (dot segments, backslashes, colons or null bytes).
 */
export function resolveInsideRoot(root, pathname) {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  for (const segment of segments) {
    if (segment.startsWith('.') || /[\\:\0]/.test(segment)) return null;
  }
  const full = path.join(root, ...segments);
  const relative = path.relative(root, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return full;
}

/**
 * Resolves a path to its real location and accepts it only if it lies inside
 * the real root and is allowed there (see `resolveInsideRoot`).
 * @param {string} realRoot The root, already resolved to its real location.
 * @param {string} candidate A path that may go through links.
 * @returns {Promise<string|null>} The real path, or `null` if the file does
 *   not exist or is not allowed.
 */
async function resolveReal(realRoot, candidate) {
  const real = await realpath(candidate).catch(() => null);
  if (real === null) return null;
  const relative = path.relative(realRoot, real);
  if (relative === '') return real;
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  // The same rule as for the requested path, applied to where the path really
  // leads: a link must not be a way into a dot folder.
  return resolveInsideRoot(realRoot, relative.split(path.sep).join('/')) === null ? null : real;
}

/**
 * Creates the HTTP server, without starting it.
 * @param {{root: string}} options Folder to serve.
 */
export function createStaticServer({ root }) {
  const base = path.resolve(root);
  const realRootPromise = realpath(base).catch(() => null);

  return createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendText(response, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
        return;
      }

      let url;
      let pathname;
      try {
        url = new URL(request.url, 'http://localhost');
        pathname = decodeURIComponent(url.pathname);
      } catch {
        sendText(response, 400, 'Bad request\n');
        return;
      }

      const lexical = resolveInsideRoot(base, pathname);
      const realRoot = await realRootPromise;
      if (lexical === null || realRoot === null) {
        sendText(response, 404, 'Not found\n');
        return;
      }

      let file = await resolveReal(realRoot, lexical);
      let info = file === null ? null : await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        if (!pathname.endsWith('/')) {
          // The encoded path of the URL is kept as it came, so names with `#`
          // or `%` still lead to the folder; the leading slashes are reduced
          // to one, because `//host` would be read as another host.
          const encoded = url.pathname.replace(/^\/+/, '/');
          sendText(response, 301, '', { Location: `${encoded}/${url.search}` });
          return;
        }
        file = await resolveReal(realRoot, path.join(file, 'index.html'));
        info = file === null ? null : await stat(file).catch(() => null);
      }
      if (file === null || !info?.isFile()) {
        sendText(response, 404, 'Not found\n');
        return;
      }

      const body = await readFile(file);
      const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      send(
        response,
        200,
        { 'Content-Type': type, 'Content-Length': body.length },
        request.method === 'HEAD' ? undefined : body,
      );
    } catch {
      if (!response.headersSent) sendText(response, 500, 'Internal error\n');
      else response.end();
    }
  });
}

function parsePort(argv, environment) {
  const flag = argv.indexOf('--port');
  const raw = flag >= 0 ? argv[flag + 1] : environment.PORT;
  if (raw === undefined) return 8080;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError(`invalid port: ${raw}`);
  }
  return port;
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  let port;
  try {
    port = parsePort(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const server = createStaticServer({ root });
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Try: node scripts/serve.mjs --port ${port + 1}`
        : error.message,
    );
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Serving ${root} at http://127.0.0.1:${server.address().port}/`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
