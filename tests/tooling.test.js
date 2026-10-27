import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createStaticServer, PROJECT_ROOT } from '../scripts/server.mjs';

function get(port, route, method = 'GET') {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path: route, method }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('local server serves modules with CSP and rejects traversal/nonpublic paths/methods', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixturelang-server-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><p>Local</p>');
  await writeFile(path.join(root, 'src', 'worker.js'), 'export const local = true;');
  await writeFile(path.join(root, 'package.json'), '{"private":true}');
  const server = createStaticServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    // root is an exact mkdtemp-created path within the operating system temp dir.
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  assert.equal(server.address().address, '127.0.0.1');
  const port = server.address().port;
  const home = await get(port, '/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-security-policy'], /connect-src 'none'/u);
  assert.match(home.headers['content-security-policy'], /worker-src 'self'/u);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.match(home.body, /Local/u);
  const module = await get(port, '/src/worker.js?cache=1');
  assert.equal(module.status, 200);
  assert.match(module.headers['content-type'], /text\/javascript/u);
  assert.equal((await get(port, '/src/worker.js', 'HEAD')).body, '');
  for (const route of ['/%2e%2e/package.json', '/src/../../package.json', '/src/%2e%2e/package.json']) {
    assert.equal((await get(port, route)).status, 403, route);
  }
  assert.equal((await get(port, '/src/%5c../package.json')).status, 400);
  assert.equal((await get(port, '/%GG')).status, 400);
  assert.equal((await get(port, '/package.json')).status, 404);
  assert.equal((await get(port, '/src/missing.js')).status, 404);
  assert.equal((await get(port, '/', 'POST')).status, 405);
});

test('CLI produces deterministic JSON and requires explicit raw/spreadsheet CSV choice', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixturelang-cli-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'tiny.fixture');
  await writeFile(file, 'fixture tiny seed 7 { table users rows 3 { id: id = seq(1); name: string = pick("=1+1") missing every 3; } }');
  const invoke = arguments_ => spawnSync(process.execPath, ['scripts/cli.mjs', file, ...arguments_], {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10000
  });
  const first = invoke(['--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stderr, '');
  const parsed = JSON.parse(first.stdout);
  assert.equal(parsed.fixture, 'tiny');
  assert.equal(parsed.tables.users.length, 3);
  assert.equal(invoke(['--json']).stdout, first.stdout);
  const omitted = invoke(['--csv', 'users']);
  assert.equal(omitted.status, 1);
  assert.equal(omitted.stdout, '');
  assert.match(omitted.stderr, /--mode raw\|spreadsheet/u);
  const raw = invoke(['--csv', 'users', '--mode', 'raw']);
  assert.equal(raw.status, 0, raw.stderr);
  assert.match(raw.stdout, /=1\+1/u);
  assert.doesNotMatch(raw.stdout, /'=1/u);
  assert.match(raw.stderr, /1 missing/u);
  const protected_ = invoke(['--csv', 'users', '--mode', 'spreadsheet']);
  assert.equal(protected_.status, 0, protected_.stderr);
  assert.match(protected_.stdout, /'=1\+1/u);
  assert.match(protected_.stderr, /prefixed 2 cells/u);
  const unknown = invoke(['--csv', 'unknown', '--mode', 'raw']);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.stdout, '');
  assert.match(unknown.stderr, /Unknown table/u);
  await writeFile(file, 'fixture bad seed 1 { table a rows 2 { a: string = pick("x"); ');
  const bad = invoke(['--json']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /tiny\.fixture:\d+:\d+ \[SYNTAX\]/u);
  await writeFile(file, Buffer.from([0xff, 0xfe]));
  assert.match(invoke(['--json']).stderr, /valid UTF-8/u);
  await writeFile(file, ' '.repeat(65536 * 4 + 1));
  assert.match(invoke(['--json']).stderr, /read limit/u);
});
