import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
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

test('CLI rejects a directory without producing data', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixturelang-directory-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const output = spawnSync(process.execPath, ['scripts/cli.mjs', root, '--json'], {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL'
  });
  assert.equal(output.error, undefined);
  assert.equal(output.signal, null);
  assert.equal(output.status, 1);
  assert.equal(output.stdout, '');
  assert.equal(output.stderr, 'Source must be a regular local file.\n');
});

test('POSIX CLI rejects FIFOs without a writer, including symlink targets', {
  skip: process.platform === 'win32' ? 'POSIX FIFO creation is unavailable on Windows.' : false
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixturelang-fifo-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const fifo = path.join(root, 'source.fixture');
  const created = spawnSync('mkfifo', [fifo], {
    encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL'
  });
  assert.equal(created.error, undefined, 'POSIX tooling tests require mkfifo.');
  assert.equal(created.status, 0, created.stderr);
  const linked = path.join(root, 'linked.fixture');
  await symlink(fifo, linked);
  for (const file of [fifo, linked]) {
    for (const args of [['--json'], ['--csv', 'rows', '--mode', 'raw'], ['--csv', 'rows', '--mode', 'spreadsheet']]) {
      const output = spawnSync(process.execPath, ['scripts/cli.mjs', file, ...args], {
        cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL'
      });
      assert.equal(output.error, undefined, `${file} ${args.join(' ')} must not wait for a writer.`);
      assert.equal(output.signal, null);
      assert.equal(output.status, 1);
      assert.equal(output.stdout, '');
      assert.equal(output.stderr, 'Source must be a regular local file.\n');
    }
  }
});

test('POSIX CLI still reads symlinks to regular fixture files', {
  skip: process.platform === 'win32' ? 'Windows symlink creation can require additional privileges.' : false
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixturelang-file-link-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'source.fixture');
  const linked = path.join(root, 'linked.fixture');
  await writeFile(file, 'fixture tiny seed 0 { table rows rows 1 { id: id = seq(1); } }');
  await symlink(file, linked);
  const invoke = target => spawnSync(process.execPath, ['scripts/cli.mjs', target, '--json'], {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL'
  });
  const direct = invoke(file);
  const throughLink = invoke(linked);
  for (const output of [direct, throughLink]) {
    assert.equal(output.error, undefined);
    assert.equal(output.status, 0, output.stderr);
    assert.equal(output.stderr, '');
  }
  assert.equal(throughLink.stdout, direct.stdout);
});

test('POSIX CLI rejects a source replaced by a FIFO between path stat and open', {
  skip: process.platform === 'win32' ? 'POSIX FIFO creation is unavailable on Windows.' : false
}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixturelang-fifo-race-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'source.fixture');
  const saved = path.join(root, 'saved.fixture');
  const preload = path.join(root, 'swap-before-open.mjs');
  const source = 'fixture tiny seed 0 { table rows rows 1 { id: id = seq(1); } }';
  await writeFile(file, source);
  // Instrument only this subprocess and its own synthetic path. The CLI still
  // performs the real open and descriptor check on the replacement FIFO.
  await writeFile(preload, `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { spawnSync } from 'node:child_process';
    const originalOpen = fs.open;
    fs.open = async function(file, ...args) {
      if (file === ${JSON.stringify(file)}) {
        await fs.rename(file, ${JSON.stringify(saved)});
        const created = spawnSync('mkfifo', [file], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
        if (created.error || created.status !== 0) throw new Error('Could not prepare test FIFO.');
      }
      return originalOpen(file, ...args);
    };
    syncBuiltinESMExports();
  `);
  const output = spawnSync(process.execPath, ['--import', preload, 'scripts/cli.mjs', file, '--json'], {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL'
  });
  assert.equal(output.error, undefined, 'Replaced source must not wait for a FIFO writer.');
  assert.equal(output.signal, null);
  assert.equal(output.status, 1);
  assert.equal(output.stdout, '');
  assert.equal(output.stderr, 'Source must be a regular local file.\n');
  assert.equal(await readFile(saved, 'utf8'), source);
});

test('CLI preserves empty single-column records in both CSV modes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'fixturelang-empty-csv-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, 'empty.fixture');
  await writeFile(file, 'fixture empty seed 0 { table strings rows 3 { value: string = pick(""); } table omitted rows 3 { value: string = pick("x") missing every 1; } table nulls rows 3 { value: string = pick("x") null every 1; } }');
  for (const name of ['strings', 'omitted', 'nulls']) {
    for (const mode of ['raw', 'spreadsheet']) {
      const output = spawnSync(process.execPath, ['scripts/cli.mjs', file, '--csv', name, '--mode', mode], {
        cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 10000
      });
      assert.equal(output.status, 0, output.stderr);
      assert.equal(output.stdout, 'value\r\n""\r\n""\r\n""\r\n');
      if (name === 'strings') assert.equal(output.stderr, '');
      if (name === 'omitted') assert.match(output.stderr, /3 missing and 0 null/);
      if (name === 'nulls') assert.match(output.stderr, /0 missing and 3 null/);
    }
  }
});
