import {spawnSync} from 'node:child_process';
import {readFileSync, mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, '.local/dev/production-snapshot.json');
const script = readFileSync(new URL('./snapshot_remote.py', import.meta.url), 'utf8');
// The SSH alias is deliberately fixed. Do not accept user-provided remote commands.
const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'home-server-ai', 'sudo -n python3 -'], {
  input: script, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024,
});
if (result.error || result.status !== 0) {
  // Do not print SSH/remote stderr: it may contain operator-specific details.
  console.error('Production inventory capture failed. Check SSH access and the running panel database; no snapshot was replaced.');
  process.exit(1);
}
let snapshot;
try {
  snapshot = JSON.parse(result.stdout);
  if (snapshot.format !== 'voltra.dev.snapshot.v1' || !snapshot.captured_at || !snapshot.tables || !snapshot.counts) throw Error();
} catch {
  console.error('Production returned an invalid snapshot; no snapshot was replaced.');
  process.exit(1);
}
mkdirSync(path.dirname(output), {recursive: true});
const temporary = output + '.tmp-' + process.pid;
writeFileSync(temporary, JSON.stringify(snapshot, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
renameSync(temporary, output);
console.log(JSON.stringify({snapshot: output, captured_at: snapshot.captured_at, source: snapshot.source, counts: snapshot.counts, scope: 'Sanitized inventory reference; no database changes or running game clone.'}, null, 2));
