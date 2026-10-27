import { mkdir, readdir, copyFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './server.mjs';

const destination = path.resolve(PROJECT_ROOT, 'dist');
// Check the exact target before recursively removing only this project's build.
if (path.dirname(destination) !== PROJECT_ROOT || path.basename(destination) !== 'dist') {
  throw new Error('Build destination must stay inside this project.');
}
try {
  if ((await lstat(destination)).isSymbolicLink()) throw new Error('Refusing a linked build directory.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await rm(destination, { recursive: true, force: true });
await mkdir(destination);
let files = 0;
async function copy(relative) {
  const source = path.join(PROJECT_ROOT, relative);
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error(`Linked source is not supported: ${relative}`);
  const target = path.join(destination, relative);
  if (metadata.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) await copy(path.join(relative, entry));
  } else if (metadata.isFile()) {
    await copyFile(source, target);
    files++;
  }
}
for (const relative of ['index.html', 'styles.css', 'src', 'docs', 'examples']) await copy(relative);
try { await copy('favicon.svg'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
console.log(`Built ${files} local files in dist/. Preview with npm run preview.`);
