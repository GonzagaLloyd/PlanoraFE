// Fails CI when a bundle grows past its budget (gzipped bytes).
// The widget runs on other people's websites: every KB is a cost we impose on them.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const CORE = 'packages/core/dist';

const gz = (file) => gzipSync(readFileSync(file)).length;
const chunks = existsSync(join(CORE, 'chunks')) ? readdirSync(join(CORE, 'chunks')).filter((f) => f.endsWith('.js')) : [];
const pick = (prefix) => chunks.filter((f) => f.startsWith(prefix)).map((f) => join(CORE, 'chunks', f));

const budgets = [
  { name: 'loader.js (script tag, loads first)', files: ['packages/loader/dist/loader.js'], limit: 3 * KB },
  { name: 'widget core (loaded on every page)', files: [join(CORE, 'widget.js'), ...pick('core-')], limit: 40 * KB },
  { name: 'screenshot (lazy, on first open)', files: pick('screenshot-'), limit: 15 * KB },
];

let failed = false;
for (const budget of budgets) {
  const missing = budget.files.length === 0 || budget.files.some((f) => !existsSync(f));
  if (missing) {
    console.error(`✗ ${budget.name}: build output not found — run \`npm run build\` first.`);
    failed = true;
    continue;
  }
  const size = budget.files.reduce((sum, f) => sum + gz(f), 0);
  const ok = size <= budget.limit;
  failed ||= !ok;
  console.log(`${ok ? '✓' : '✗'} ${budget.name}: ${(size / KB).toFixed(1)} KB / ${(budget.limit / KB).toFixed(0)} KB gzipped`);
}
process.exit(failed ? 1 : 0);
