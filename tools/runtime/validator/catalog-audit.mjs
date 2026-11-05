// Read-only inventory reconciliation. Labels and receipt existence are not acceptance.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2);
const root = args[args.indexOf('--campaign-root') + 1];
if (!args.includes('--campaign-root') || !root) throw Error('--campaign-root required');
const h = await import(pathToFileURL(resolve(root, 'tools/runtime/campaign-native-20261029.mjs')));
const runtime = await h.verifyRuntime();
const queue = JSON.parse(await readFile(resolve(root, 'artifacts/game-parity-20261029/PRACTICAL-QUEUE.json')));
const profiles = JSON.parse(await readFile(resolve(runtime.snapshot, 'internal/panel/game_library/overrides.json')));
const out = resolve('.local/validator-campaign'); await mkdir(out, { recursive: true });
const rows = [];
let index = 0;
async function worker() {
  while (index < queue.rows.length) {
    const row = queue.rows[index++], profile = profiles[row.recipe];
    const result = { recipe: row.recipe, checklistClosed: row.remaining_required_checks.length === 0, remaining: row.remaining_required_checks, recipeLabel: profile?.verification, historicalReceipts: [] };
    for (const match of (profile?.detail ?? '').matchAll(/\b([a-zA-Z0-9_-]+\.json)\b/g)) {
      const file = resolve(root, 'artifacts', basename(match[1]));
      try {
        if (!(await stat(file)).isFile()) continue;
        const bytes = await readFile(file);
        result.historicalReceipts.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), reviewedHere: false });
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
    try {
      const id = h.digest(row.recipe).slice(0, 16);
      const options = (await h.api('/api/client/game-library/templates/' + id)).attributes;
      if (options.id !== id || !Array.isArray(options.variables) || !options.images) throw Error('Missing or mismatched setup metadata');
      result.setup = { status: 'PASS', available: options.available, defaults: options.defaults, images: options.images, variables: options.variables.map(v => ({ key: v.env_variable, editable: v.user_editable })), scope: 'Served canonical setup API only; no browser rendering or installed recipe-specific settings claim' };
    } catch (e) { result.setup = { status: 'FAIL', error: e.message.slice(0, 400) }; }
    rows.push(result);
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
rows.sort((a, b) => a.recipe.localeCompare(b.recipe));
const report = { at: new Date().toISOString(), build: runtime.binary_sha256, queueDate: queue.at, total: rows.length, closed: rows.filter(r => r.checklistClosed).length, setupPass: rows.filter(r => r.setup.status === 'PASS').length, historicalEvidenceCandidates: rows.filter(r => !r.checklistClosed && r.historicalReceipts.length).length, scope: 'Inventory reconciliation, not a promotion of recipe labels or historical receipts to current acceptance', rows };
await writeFile(resolve(out, 'catalog-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, rows: undefined }));
