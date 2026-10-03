import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const directory = realpathSync(process.argv[2]);
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.ok(manifest.files.length > 0);
const seen = new Set();
for (const file of manifest.files) {
  assert.ok(!seen.has(file.path), 'Duplicate manifest entry');
  seen.add(file.path);
  const fullPath = realpathSync(resolve(directory, file.path));
  assert.ok(fullPath.startsWith(`${directory}${sep}`), 'Path outside snapshot');
  const bytes = readFileSync(fullPath);
  assert.equal(bytes.length, file.bytes, `${file.path}: size mismatch`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `${file.path}: checksum mismatch`);
}
console.log(`Integrity verified: ${manifest.files.length} files. This verifies bytes, not the scientific claims or FAIR compliance.`);
