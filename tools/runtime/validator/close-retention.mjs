import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const [root, game] = process.argv.slice(2);
if (!root || !/^[a-z0-9-]+$/.test(game)) throw Error('Usage: close-retention.mjs CAMPAIGN_ROOT GAME');
const base = path.resolve(root, 'artifacts/game-parity-20261029');
const file = path.join(base, 'PRACTICAL-QUEUE.json');
const original = await fs.readFile(file, 'utf8'), queue = JSON.parse(original);
const bytes = await fs.readFile(path.join('.local/validator-campaign', game + '.json'));
const report = JSON.parse(bytes), row = queue.rows.find(r => r.recipe === report.fixture?.recipe);
if (!row || row.remaining_required_checks.length !== 1 || !/^Verify (current )?reinstall retention$/.test(row.remaining_required_checks[0])) throw Error('Requires review: queue has additional or different gates');
for (const name of ['canonical-reinstall', 'reinstall-retained-bytes', 'reinstall-native-reload']) if (!report.checks.some(c => c.name === name && c.status === 'PASS')) throw Error('Missing proof: ' + name);
const reload = report.checks.find(c => c.name === 'reinstall-native-reload')?.evidence;
const signal = reload?.canonicalSignalExit;
const canonicalSIGINT = report.fixture.recipe === 'openra/openra_red_alert/egg-open-r-a.json' &&
  signal?.container === 254 && signal.native === -2 && signal.signal === 'SIGINT' && signal.stopRequested === true &&
  signal.helperHashes?.['native-console.py'] === 'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5' &&
  reload.nativeStop?.StartedAt === report.park?.native?.StartedAt && reload.nativeStop?.ExitCode === 254 && report.park.native.ExitCode === 254;
if (report.status !== 'PASS' || report.park?.native?.Running !== false || (report.park.native.ExitCode !== 0 && !canonicalSIGINT) || report.park.native.OOMKilled) throw Error('Missing verified canonical parking');
const rel = 'validator-20261102-' + game, dir = path.join(base, rel);
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, 'report.json'), bytes);
for (const name of ['retention-before.sha256', 'retention-after.sha256']) await fs.copyFile(path.join('.local/validator-campaign', game, name), path.join(dir, name));
await fs.writeFile(path.join(dir, 'queue-row-before.json'), JSON.stringify(row, null, 2));
row.practical_evidence.reinstall_followup = { receipt: rel + '/report.json', sha256: createHash('sha256').update(bytes).digest('hex'), scope: 'Canonical reinstall exit/callback, retained bytes/mode/ownership, native reload and verified canonical stop. Read named checks for exact exit status and coverage.' };
row.remaining_required_checks = [];
row.next_action = 'Reuse accepted practical operator checks; retain existing player/WAN and browser evidence limits.';
queue.at = new Date().toISOString();
if (await fs.readFile(file, 'utf8') !== original) throw Error('Concurrent queue edit; queue untouched');
await fs.writeFile(file, JSON.stringify(queue, null, 2) + '\n');
console.log(JSON.stringify({ game, closed: queue.rows.filter(r => !r.remaining_required_checks.length).length, total: queue.rows.length }));
