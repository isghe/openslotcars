import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticServer, resolveInsideRoot } from '../scripts/serve.mjs';

let workDir;
let server;
let port;

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'openslotcars-serve-'));
  const site = path.join(workDir, 'site');
  await mkdir(path.join(site, 'sub'), { recursive: true });
  await mkdir(path.join(site, '.hidden'), { recursive: true });
  await writeFile(path.join(site, 'index.html'), '<!doctype html><title>home</title>');
  await writeFile(path.join(site, 'app.js'), 'export const answer = 42;\n');
  await writeFile(path.join(site, 'style.css'), 'body { margin: 0; }\n');
  await writeFile(path.join(site, 'data.bin'), Buffer.from([1, 2, 3]));
  await writeFile(path.join(site, 'sub', 'index.html'), '<!doctype html><title>sub</title>');
  await writeFile(path.join(site, '.env'), 'TOKEN=hidden');
  await writeFile(path.join(site, '.hidden', 'file.txt'), 'hidden');
  await writeFile(path.join(workDir, 'secret.txt'), 'outside the site');

  server = createStaticServer({ root: site });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(workDir, { recursive: true, force: true });
});

/** Raw request: the path is sent exactly as given, without normalization. */
function rawRequest(requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: requestPath, method },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('serves index.html at the root', async () => {
  const response = await rawRequest('/');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.body, '<!doctype html><title>home</title>');
});

test('serves JavaScript with a JavaScript content type, as ES modules require', async () => {
  const response = await rawRequest('/app.js');
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(response.body, 'export const answer = 42;\n');
});

test('serves other file types with the right content type', async () => {
  assert.equal((await rawRequest('/style.css')).headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await rawRequest('/data.bin')).headers['content-type'], 'application/octet-stream');
});

test('redirects a folder to its trailing slash and serves its index', async () => {
  const redirect = await rawRequest('/sub');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/sub/');
  const page = await rawRequest('/sub/');
  assert.equal(page.status, 200);
  assert.equal(page.body, '<!doctype html><title>sub</title>');
});

test('answers 404 for a missing file', async () => {
  assert.equal((await rawRequest('/missing.js')).status, 404);
});

test('does not serve files outside the root or dot files', async () => {
  const attempts = [
    '/../secret.txt',
    '/..%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/%2e%2e%2fsecret.txt',
    '/sub/../../secret.txt',
    '/..\\secret.txt',
    '/.env',
    '/.hidden/file.txt',
    '/app.js%00.txt',
    '/C:/Windows/win.ini',
  ];
  for (const attempt of attempts) {
    const response = await rawRequest(attempt);
    assert.notEqual(response.status, 200, attempt);
    assert.ok(!response.body.includes('outside the site'), attempt);
    assert.ok(!response.body.includes('TOKEN=hidden'), attempt);
  }
});

test('rejects a malformed percent encoding', async () => {
  assert.equal((await rawRequest('/%E0%A4%A')).status, 400);
});

test('accepts only GET and HEAD', async () => {
  const post = await rawRequest('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('answers HEAD with the headers and no body', async () => {
  const response = await rawRequest('/app.js', 'HEAD');
  assert.equal(response.status, 200);
  const size = Buffer.byteLength('export const answer = 42;\n');
  assert.equal(response.headers['content-length'], String(size));
  assert.equal(response.body, '');
});

test('never lets the browser cache files while developing', async () => {
  const response = await rawRequest('/app.js');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('resolveInsideRoot allows plain paths and refuses unsafe ones', () => {
  const root = path.resolve('some', 'root');
  assert.equal(resolveInsideRoot(root, '/a/b.js'), path.join(root, 'a', 'b.js'));
  assert.equal(resolveInsideRoot(root, '/'), root);
  assert.equal(resolveInsideRoot(root, '/../x'), null);
  assert.equal(resolveInsideRoot(root, '/.git/config'), null);
  assert.equal(resolveInsideRoot(root, '/a\\b'), null);
  assert.equal(resolveInsideRoot(root, '/a:b'), null);
});
