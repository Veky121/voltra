// Read-only observer for an owned acceptance receipt. It never retries an
// installation or restarts a service when a request or observation times out.
// Usage: node tools/runtime/game-acceptance-status.mjs .local/game/private.json [--wait]
import fs from 'node:fs/promises';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';

const receiptPath = path.resolve(process.argv[2] || '');
const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
if (!/^[a-f0-9]{8}(?:-[a-f0-9-]{27})?$/.test(receipt.identifier || '')) throw Error('Receipt does not identify an acceptance server.');
const base = `http://127.0.0.1:8088/api/client/servers/${receipt.identifier}`;
async function read(suffix) {
  const response = await fetch(base + suffix, {signal: AbortSignal.timeout(10000)});
  if (!response.ok) throw Error(`Observation returned HTTP ${response.status} for ${suffix || 'server'}.`);
  return (await response.json()).attributes;
}
const deadline = Date.now() + (process.argv.includes('--wait') ? 30000 : 0);
let previous = '';
for (;;) {
  const [server, steam] = await Promise.all([read(''), read('/steam')]);
  const job = steam.current_job ?? steam.jobs?.[0];
  const status = {
    observed_at: new Date().toISOString(),
    game: steam.game ?? receipt.game,
    identifier: receipt.identifier,
    uuid: server.uuid,
    server_status: server.status,
    installed_build: steam.installed_build,
    needs_repair: steam.needs_repair,
    job: job ? {id: job.id, operation: job.operation, status: job.status, stage: job.stage, detail: job.detail, error: job.error, completed_at: job.completed_at} : null,
  };
  // Whitelist observations; never copy passwords or tokens from the receipt.
  await fs.writeFile(`${receiptPath}.status.json`, JSON.stringify(status, null, 2));
  const fingerprint = JSON.stringify({server: status.server_status, build: status.installed_build, job: status.job});
  if (fingerprint !== previous) {console.log(JSON.stringify(status)); previous = fingerprint;}
  const active = job && !job.completed_at && ['queued', 'running'].includes(job.status);
  if (!active || Date.now() >= deadline) break;
  await setTimeout(2000);
}
