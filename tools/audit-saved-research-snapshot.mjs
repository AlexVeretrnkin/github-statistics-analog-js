// Offline audit of an existing snapshot; never connects to a database or changes inputs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateSeries } from './research-snapshot-validation.mjs';

const directory = resolve(process.argv[2]);
const python = process.env.RESEARCH_AUDIT_PYTHON ?? 'python3';
const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
const load = name => JSON.parse(execFileSync(python, ['-c',
  'import csv,json,sys; f=open(sys.argv[1],encoding="utf-8",newline=""); print(json.dumps(list(csv.DictReader(f))))',
  resolve(directory, `${name}.csv`)], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }));
const report = { snapshot: directory, completedMonthBefore: manifest.completedMonthBefore, checks: [], status: 'passed' };
for (const [name, key, value, expected] of [
  ['npm_downloads', 'package', 'downloads', ['@angular/core', 'react', 'vue']],
  ['github_stars', 'repository', 'new_stars', ['angular/angular', 'facebook/react', 'vuejs/core']],
]) {
  try {
    report.checks.push({ dataset: name, status: 'passed', ...validateSeries(load(`${name}_daily`), load(`${name}_monthly`), key, value, expected, manifest.completedMonthBefore) });
  } catch (error) {
    report.checks.push({ dataset: name, status: 'failed', error: error.message });
    report.status = 'failed';
    process.exitCode = 1;
  }
}
console.log(JSON.stringify(report, null, 2));
