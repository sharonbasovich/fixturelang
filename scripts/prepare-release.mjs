// Dependency-free public source and runnable web packaging. No network access.
import { readFile, writeFile, readdir, mkdir, lstat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT } from './server.mjs';

const ROOT_FILES = ['.gitignore', 'package.json', 'README.md', 'LICENSE', 'index.html', 'styles.css', '.github/workflows/ci.yml'];
const SCRIPT_FILES = ['build', 'check', 'cli', 'server', 'browser-qa', 'prepare-release'].map(name => `scripts/${name}.mjs`);
const DOC_FILES = ['language-reference', 'implementation', 'limitations', 'demo-outline', 'QA', 'credits'].map(name => `docs/${name}.md`);
const DIRECTORY_RULES = [['src', /^[A-Za-z0-9_-]+\.js$/u], ['tests', /^[A-Za-z0-9_.-]+\.test\.js$/u], ['examples', /^[A-Za-z0-9_-]+\.fixture$/u]];
const MANIFEST = 'RELEASE-MANIFEST.json';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const normalPath = relative => relative.split(path.sep).join('/');

async function assertNoLinks(relative) {
  let target = PROJECT_ROOT;
  for (const segment of relative.split(/[\\/]/u)) {
    if (!segment || segment === '.' || segment === '..') throw new Error(`Invalid release path: ${relative}`);
    target = path.join(target, segment);
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) throw new Error(`Linked release paths are forbidden: ${relative}`);
  }
  return target;
}

function auditText(relative, source) {
  const checks = [
    [/(?:[A-Za-z]:[\\/]Users[\\/]|\/Users\/|\/home\/[A-Za-z0-9._-]+\/)/u, 'machine-specific home path'],
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/u, 'GitHub token-like content'],
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/u, 'GitHub token-like content'],
    [/\bsk-[A-Za-z0-9_-]{20,}\b/u, 'API key-like content'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u, 'private key content']
  ];
  for (const [expression, label] of checks) if (expression.test(source)) throw new Error(`${relative}: public audit rejected ${label}.`);
  if (relative.endsWith('.md') || relative.endsWith('.html')) {
    if (/(?:\]\([^)]*|(?:href|src)\s*=\s*["'])[^\n"')]*(?:docs\/REVIEW\.md|evidence\/|DESIGN\.md|private\/)/u.test(source)) {
      throw new Error(`${relative}: link or reference to an excluded internal artifact.`);
    }
  }
}

export async function collectPublicFiles() {
  const paths = [...ROOT_FILES, ...SCRIPT_FILES, ...DOC_FILES];
  for (const [directory, expression] of DIRECTORY_RULES) {
    const entries = await readdir(await assertNoLinks(directory), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`Linked public source is forbidden: ${directory}/${entry.name}`);
      if (entry.isFile() && expression.test(entry.name)) paths.push(`${directory}/${entry.name}`);
    }
  }
  const files = [];
  let total = 0;
  for (const relative of paths.sort(compare)) {
    const target = await assertNoLinks(relative);
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) throw new Error(`Invalid or oversized release file: ${relative}`);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(target)).replace(/\r\n/gu, '\n');
    auditText(relative, source);
    const data = Buffer.from(source, 'utf8');
    total += data.length;
    if (total > MAX_PACKAGE_BYTES) throw new Error('Public source exceeds the 16 MiB release budget.');
    files.push({ name: relative, data });
  }
  const pkg = JSON.parse(files.find(file => file.name === 'package.json').data.toString('utf8'));
  if (pkg.name !== 'fixturelang' || !/^\d+\.\d+\.\d+$/u.test(pkg.version)) throw new Error('Release requires a plain semantic fixturelang version.');
  if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error('Public runtime must remain dependency-free.');
  return { files, version: pkg.version };
}

function manifestFor(files, version, kind) {
  return json({
    project: 'FixtureLang', version, kind,
    notes: 'UTF-8 text normalized to LF. Paths are relative. This manifest excludes itself.',
    files: [...files].sort((a, b) => compare(a.name, b.name)).map(file => ({ path: file.name, bytes: file.data.length, sha256: sha256(file.data) }))
  });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// ZIP32, stored entries, UTF-8 filenames, fixed 1980-01-01 timestamps and modes.
// Sorted paths and canonical text make repeated builds byte-identical.
export function createZip(files, prefix) {
  if (!/^[A-Za-z0-9_.-]+$/u.test(prefix)) throw new Error('ZIP prefix must be a single portable directory name.');
  const local = [];
  const central = [];
  let offset = 0;
  const sorted = [...files].sort((a, b) => compare(a.name, b.name));
  if (sorted.length > 65535) throw new Error('ZIP entry count exceeds ZIP32 limits.');
  for (const file of sorted) {
    if (!/^[A-Za-z0-9_./-]+$/u.test(file.name) || file.name.startsWith('/') || file.name.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error(`Unsafe ZIP entry: ${file.name}`);
    }
    const name = Buffer.from(`${prefix}/${file.name}`, 'utf8');
    if (name.length > 65535 || file.data.length > MAX_PACKAGE_BYTES) throw new Error('ZIP entry exceeds release limits.');
    const crc = crc32(file.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(0x0314, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(33, 14);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(file.data.length, 20);
    directory.writeUInt32LE(file.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    local.push(header, name, file.data);
    central.push(directory, name);
    offset += header.length + name.length + file.data.length;
    if (offset > MAX_PACKAGE_BYTES * 2) throw new Error('ZIP output exceeds release budget.');
  }
  const directoryBytes = Buffer.concat(central);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(sorted.length, 8);
  footer.writeUInt16LE(sorted.length, 10);
  footer.writeUInt32LE(directoryBytes.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, footer]);
}

async function ensureDeliveryRoot() {
  await mkdir(path.join(PROJECT_ROOT, 'delivery'), { recursive: true });
  await assertNoLinks('delivery');
  await mkdir(path.join(PROJECT_ROOT, 'delivery', 'public'), { recursive: true });
  await assertNoLinks('delivery/public');
}

async function writeStage(name, files) {
  const relative = `delivery/public/${name}`;
  const destination = path.resolve(PROJECT_ROOT, ...relative.split('/'));
  if (normalPath(path.relative(PROJECT_ROOT, destination)) !== relative || !['fixturelang', 'fixturelang-web'].includes(name)) {
    throw new Error('Release staging must remain inside the named delivery directory.');
  }
  try { await assertNoLinks(relative); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // The resolved exact staging directory and all existing parents were checked above.
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination);
  for (const file of files) {
    const target = path.join(destination, ...file.name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.data);
  }
  return destination;
}

async function readBuiltFiles(root, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error('Built release may not contain links.');
    if (entry.isDirectory()) files.push(...await readBuiltFiles(root, name));
    else if (entry.isFile()) files.push({ name, data: await readFile(path.join(root, ...name.split('/'))) });
  }
  return files;
}

async function writeArtifact(name, data) {
  if (!/^[A-Za-z0-9_.-]+$/u.test(name)) throw new Error('Artifact name must be portable and relative.');
  const target = path.join(PROJECT_ROOT, 'delivery', name);
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`Refusing a linked or non-file artifact: ${name}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await writeFile(target, data);
}

export async function prepareRelease({ auditOnly = false } = {}) {
  const { files, version } = await collectPublicFiles();
  if (auditOnly) {
    console.log(`Public allowlist audit passed: ${files.length} files; no output written.`);
    return;
  }
  await ensureDeliveryRoot();
  const source = [...files, { name: MANIFEST, data: manifestFor(files, version, 'source') }];
  const sourceRoot = await writeStage('fixturelang', source);
  const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: sourceRoot, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`Sanitized public build failed: ${build.stderr || build.error?.message || 'unknown error'}`);
  const web = await readBuiltFiles(path.join(sourceRoot, 'dist'));
  const stagedBuild = path.resolve(sourceRoot, 'dist');
  if (normalPath(path.relative(PROJECT_ROOT, stagedBuild)) !== 'delivery/public/fixturelang/dist') {
    throw new Error('Temporary public build must remain inside the source staging directory.');
  }
  await assertNoLinks('delivery/public/fixturelang/dist');
  // Only this verified generated build is removed; source staging then matches its ZIP.
  await rm(stagedBuild, { recursive: true, force: true });
  const webQA = web.find(file => file.name === 'docs/QA.md');
  if (webQA) {
    const source = webQA.data.toString('utf8')
      .replace('# Testing and verification\n', '# Testing and verification\n\n> This runnable web bundle omits development tests and scripts. The commands below describe the full source archive, `fixturelang-' + version + '.zip`, which includes those files.\n')
      .replace('[scripts/check.mjs](../scripts/check.mjs)', '`scripts/check.mjs` in the full source archive')
      .replace('[browser harness](../scripts/browser-qa.mjs)', 'browser harness (`scripts/browser-qa.mjs` in the full source archive)')
      .replace('[test suite](../tests)', 'test suite in the full source archive');
    webQA.data = Buffer.from(source, 'utf8');
  }
  web.push(
    { name: 'scripts/server.mjs', data: files.find(file => file.name === 'scripts/server.mjs').data },
    { name: 'LICENSE', data: files.find(file => file.name === 'LICENSE').data },
    { name: 'package.json', data: json({ name: 'fixturelang-web', version, private: true, type: 'module', engines: { node: '>=20' }, scripts: { start: 'node scripts/server.mjs' } }) },
    { name: 'README.md', data: Buffer.from(`# FixtureLang ${version}: runnable playground\n\nRequires Node.js 20 or newer. No dependency installation is needed.\n\nRun \`npm start\`, then open the loopback URL printed by the server. Keep it running while using the playground. All fixture generation and downloads stay local.\n\nThis bundle contains the built playground, language reference, examples, license, and credits. The separate fixturelang-${version}.zip archive includes the full source, CLI, tests, and build tooling.\n\nCSV export requires an explicit raw or spreadsheet-mode choice. Raw fixture strings are intentionally preserved; spreadsheet mode changes formula-like strings. JSON preserves missing properties and explicit nulls.\n`, 'utf8') }
  );
  web.push({ name: MANIFEST, data: manifestFor(web, version, 'runnable-web') });
  await writeStage('fixturelang-web', web);
  const artifacts = [
    { name: `fixturelang-${version}.zip`, data: createZip(source, `fixturelang-${version}`) },
    { name: `fixturelang-${version}-web.zip`, data: createZip(web, `fixturelang-${version}-web`) }
  ];
  for (const artifact of artifacts) await writeArtifact(artifact.name, artifact.data);
  const manifest = { project: 'FixtureLang', version, artifacts: artifacts.map(artifact => ({ file: artifact.name, bytes: artifact.data.length, sha256: sha256(artifact.data) })) };
  await writeArtifact('release-manifest.json', json(manifest));
  await writeArtifact('SHA256SUMS', artifacts.map(artifact => `${sha256(artifact.data)}  ${artifact.name}\n`).join(''));
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(argument => argument !== '--audit') || args.length > 1) {
    console.error('Usage: node scripts/prepare-release.mjs [--audit]');
    process.exitCode = 1;
  } else {
    prepareRelease({ auditOnly: args.includes('--audit') }).catch(error => {
      console.error(`Release preparation: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
