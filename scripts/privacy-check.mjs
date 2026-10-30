import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const skip = new Set([
  'node_modules',
  '.git',
  '.npm-cache',
  'tmp',
  'test-results',
  'playwright-report',
  'coverage',
]);
const errors = [];
async function scan(dir = '.') {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) await scan(path);
    else {
      if (/\.(xlsx|xlsm|xls|csv|pdf)$/i.test(e.name) || /backup.*\.json$/i.test(e.name))
        errors.push(`Forbidden data artifact: ${path}`);
      if (dir.startsWith('public') || dir.startsWith('dist')) {
        if (/\.(json|map)$/i.test(e.name))
          errors.push(`Unexpected public data / source map: ${path}`);
      }
    }
  }
}
await scan();
const html = await readFile('index.html', 'utf8');
if (/https?:\/\//i.test(html)) errors.push('Remote runtime dependency in index.html');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  'Privacy artifact check passed. Only code, documentation and synthetic fixtures may be published. Review git diff before every push.',
);
