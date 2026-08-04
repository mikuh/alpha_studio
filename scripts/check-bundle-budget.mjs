import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url));
const limits = {
  '.js': 900 * 1024,
  '.css': 500 * 1024,
};
const files = await readdir(assetsDir);
const failures = [];

for (const file of files) {
  const extension = Object.keys(limits).find((candidate) => file.endsWith(candidate));
  if (!extension || file.includes('pdf.worker')) continue;
  const size = (await stat(join(assetsDir, file))).size;
  const limit = file.startsWith('pdf-') ? 2 * 1024 * 1024 : limits[extension];
  if (size > limit) failures.push(`${file}: ${(size / 1024).toFixed(1)} KiB > ${limit / 1024} KiB`);
}

if (failures.length > 0) {
  console.error(`bundle budget exceeded:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('bundle budget passed');
