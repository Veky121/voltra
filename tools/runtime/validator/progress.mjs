import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.argv[2];
if (!root) throw Error('Usage: progress.mjs CAMPAIGN_ROOT');
const out = path.resolve('.local/validator-campaign');
const queue = JSON.parse(await fs.readFile(path.join(root, 'artifacts/game-parity-20261029/PRACTICAL-QUEUE.json')));
const read = async name => { try { return JSON.parse(await fs.readFile(path.join(out, name))); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const owner = (await read('owner-assets-actions.json'))?.cases ?? [];
const platform = (await read('platform-actions.json'))?.cases ?? [];
const credentials = (await read('credential-preflight.json'))?.cases ?? [];
const availability = await read('credential-availability.json');
const deferred = new Map([...owner, ...platform].map(x => [x.recipe, x]));
const reports = new Map();
for (const name of await fs.readdir(out)) if (name.endsWith('.json')) {
  const r = await read(name);
  if (r?.game && r.fixture?.recipe && r.checks) reports.set(r.fixture.recipe, { game: r.game, status: r.status, scope: r.scope, report: path.join(out, name), checks: r.checks.map(c => ({ name: c.name, status: c.status })), action: r.action });
}
const rows = queue.rows.map(r => ({ recipe: r.recipe, closed: r.remaining_required_checks.length === 0, remaining: r.remaining_required_checks, validator: reports.get(r.recipe), deferred: deferred.get(r.recipe) }));
const closed = rows.filter(r => r.closed).length;
const report = { at: new Date().toISOString(), total: rows.length, closed, remaining: rows.length - closed, scope: 'Closed operator checklists; validator PASS scopes and user prerequisites are separate, not additional closed games', rows };
await fs.writeFile(path.join(out, 'current-progress.json'), JSON.stringify(report, null, 2));
await fs.writeFile(path.join(out, 'consolidated-actions.json'), JSON.stringify({ at: report.at, runtime: await read('actions.json'), ownerAssets: owner, platforms: platform, credentialPreflight: credentials, credentialAvailability: availability }, null, 2));
console.log(JSON.stringify({ total: rows.length, closed, remaining: report.remaining }));
