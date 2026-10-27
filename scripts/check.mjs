import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PROJECT_ROOT } from './server.mjs';

let checked = 0;
let failures = 0;
async function inspect(relative) {
  for (const entry of await readdir(path.join(PROJECT_ROOT, relative), { withFileTypes: true })) {
    const filename = path.join(relative, entry.name);
    if (entry.isDirectory()) { await inspect(filename); continue; }
    if (!/\.m?js$/u.test(filename)) continue;
    const result = spawnSync(process.execPath, ['--check', path.join(PROJECT_ROOT, filename)], { encoding: 'utf8' });
    checked++;
    if (result.status !== 0) {
      console.error(`${filename}: syntax check failed\n${result.stderr}`);
      failures++;
    }
    if (relative === 'src' || relative.startsWith(`src${path.sep}`)) {
      const source = await readFile(path.join(PROJECT_ROOT, filename), 'utf8');
      // Narrow architectural lint: source execution and HTML parsing are forbidden.
      const forbidden = [
        [/\beval\s*\(/u, 'eval'], [/\bnew\s+Function\b/u, 'dynamic Function'],
        [/\bFunction\s*\(/u, 'dynamic Function'], [/\.innerHTML\s*=/u, 'innerHTML assignment'],
        [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/u, 'network API'],
        [/\bimport\s*\(/u, 'dynamic import']
      ];
      for (const [expression, label] of forbidden) {
        if (expression.test(source)) {
          console.error(`${filename}: forbidden ${label} in browser/runtime source`);
          failures++;
        }
      }
      if (/\bfrom\s*['"](?:https?:|\/\/)/u.test(source)) {
        console.error(`${filename}: external module import`);
        failures++;
      }
    }
  }
}
for (const directory of ['src', 'scripts', 'tests']) await inspect(directory);
const html = await readFile(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
if (/<script\b(?![^>]*\bsrc=)[^>]*>/iu.test(html) || /\son\w+\s*=/iu.test(html)) {
  console.error('index.html: inline scripts or handlers are not permitted.');
  failures++;
}
if (/<(?:script|link|img)\b[^>]*(?:src|href)\s*=\s*['"](?:https?:|\/\/)/iu.test(html)) {
  console.error('index.html: remote asset dependency is not permitted.');
  failures++;
}
if (failures) process.exitCode = 1;
else console.log(`Checked ${checked} JavaScript files: Node syntax and local architecture lint passed. No TypeScript or ESLint is configured.`);
