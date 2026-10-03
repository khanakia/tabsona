// CLI for the Chrome Web Store preflight. Exits non-zero on any problem, so `task package`
// cannot produce an upload that review would reject.
//
// Run with: task preflight  (or automatically, inside `task package`)
//
// Takes the build output directory as an optional argument; defaults to this package's
// `dist/`, which is what the Taskfile uses.

import { resolve } from 'node:path';
import { collectProblems } from './lib-store-preflight.mjs';

const dist = resolve(process.argv[2] ?? resolve(import.meta.dirname, '../dist'));
const { problems, notes, manifest } = collectProblems(dist);

if (problems.length > 0) {
  console.error(`preflight: ${problems.length} problem(s) would fail Chrome Web Store review\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`preflight: ok — ${manifest?.name} ${manifest?.version}`);
for (const n of notes) console.log(`  ${n}`);
