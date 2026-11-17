import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createStaticServer, resolveInsideRoot } from '../scripts/serve.mjs';

let workDir;
let server;
let port;
let fileLinkCreated = false;

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

  // Folders whose names need URL encoding.
  for (const name of ['sub#part', 'sub%part']) {
    await mkdir(path.join(site, name));
    await writeFile(path.join(site, name, 'index.html'), `<title>${name}</title>`);
  }

  // Links. A junction needs no special privilege on Windows; on other systems
  // the same call makes a plain symbolic link to a folder.
  await mkdir(path.join(workDir, 'outside'));
  await writeFile(path.join(workDir, 'outside', 'proof.txt'), 'outside through a link');
  await writeFile(path.join(workDir, 'outside', 'index.html'), '<title>outside index</title>');
  await symlink(path.join(workDir, 'outside'), path.join(site, 'linked'), 'junction');
  await symlink(path.join(site, 'sub'), path.join(site, 'inside-link'), 'junction');
  await symlink(path.join(site, '.hidden'), path.join(site, 'alias'), 'junction');
  await symlink(site, path.join(workDir, 'site-link'), 'junction');
  // A link to a single file may need a privilege on Windows: the test that
  // uses it is skipped when it cannot be created.
  try {
    await symlink(path.join(workDir, 'secret.txt'), path.join(site, 'secret-link.txt'), 'file');
    fileLinkCreated = true;
  } catch {
    fileLinkCreated = false;
  }

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

// Links: nothing outside the root may be read through them.

test('a link to a folder outside the root does not give access to its files', async () => {
  const file = await rawRequest('/linked/proof.txt');
  assert.equal(file.status, 404);
  assert.ok(!file.body.includes('outside through a link'));
});

test('a link to a folder outside the root does not give access to its index', async () => {
  for (const attempt of ['/linked/', '/linked']) {
    const response = await rawRequest(attempt);
    assert.notEqual(response.status, 200, attempt);
    assert.ok(!response.body.includes('outside index'), attempt);
  }
});

test('a link to a single file outside the root is not followed', async (t) => {
  if (!fileLinkCreated) {
    t.skip('this system does not allow creating links to files');
    return;
  }
  const response = await rawRequest('/secret-link.txt');
  assert.equal(response.status, 404);
  assert.ok(!response.body.includes('outside the site'));
});

test('a link to a folder inside the root is followed', async () => {
  const response = await rawRequest('/inside-link/');
  assert.equal(response.status, 200);
  assert.equal(response.body, '<!doctype html><title>sub</title>');
});

test('a link cannot be used to reach a dot folder', async () => {
  const response = await rawRequest('/alias/file.txt');
  assert.equal(response.status, 404);
  assert.ok(!response.body.includes('hidden'));
});

test('a root that is itself a link works', async () => {
  const linkedRoot = createStaticServer({ root: path.join(workDir, 'site-link') });
  await new Promise((resolve) => linkedRoot.listen(0, '127.0.0.1', resolve));
  try {
    const { port: linkedPort } = linkedRoot.address();
    const response = await fetch(`http://127.0.0.1:${linkedPort}/app.js`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'export const answer = 42;\n');
    // Links that leave a linked root are refused as well.
    assert.equal((await fetch(`http://127.0.0.1:${linkedPort}/linked/proof.txt`)).status, 404);
  } finally {
    await new Promise((resolve) => linkedRoot.close(resolve));
  }
});

test('a root that does not exist serves nothing and does not crash', async () => {
  const missing = createStaticServer({ root: path.join(workDir, 'does-not-exist') });
  await new Promise((resolve) => missing.listen(0, '127.0.0.1', resolve));
  try {
    const { port: missingPort } = missing.address();
    assert.equal((await fetch(`http://127.0.0.1:${missingPort}/`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${missingPort}/app.js`)).status, 404);
  } finally {
    await new Promise((resolve) => missing.close(resolve));
  }
});

// Redirects of folders keep the encoding of the URL.

test('the redirect of a folder keeps the percent encoding of its name', async () => {
  for (const [requested, location, body] of [
    ['/sub%23part', '/sub%23part/', '<title>sub#part</title>'],
    ['/sub%25part', '/sub%25part/', '<title>sub%part</title>'],
  ]) {
    const redirect = await rawRequest(requested);
    assert.equal(redirect.status, 301, requested);
    assert.equal(redirect.headers.location, location, requested);
    const page = await rawRequest(redirect.headers.location);
    assert.equal(page.status, 200, requested);
    assert.equal(page.body, body, requested);
  }
});

test('the redirect keeps the query string', async () => {
  const redirect = await rawRequest('/sub?x=1&y=%23');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/sub/?x=1&y=%23');
});

test('the redirect never points to another host', async () => {
  // The URL parser turns this path into //sub, which a browser would read as a
  // host name; the redirect must stay on this server.
  const redirect = await rawRequest('/..//sub');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, '/sub/');
});
