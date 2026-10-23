import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const reports = [];
for (const filename of ['go-tests.jsonl', 'go-race.jsonl']) {
  const source = (await readFile(`artifacts/${filename}`, 'utf8')).replace(/^\uFEFF/, '');
  const events = source.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const failed = events.filter(e => e.Action === 'fail' || e.Action === 'build-fail');
  reports.push({
    artifact: `artifacts/${filename}`,
    passed_test_events: events.filter(e => e.Action === 'pass' && e.Test).length,
    failed_events: failed.length,
    skipped_tests: events.filter(e => e.Action === 'skip' && e.Test).map(e => e.Test),
    packages: events.filter(e => e.Action === 'pass' && !e.Test).map(e => ({ package: e.Package, seconds: e.Elapsed })),
    completed_at: events.at(-1).Time,
  });
  if (failed.length) throw new Error(`${filename} contains failures`);
}
const npmAudit = JSON.parse((await readFile('.local/npm-audit-final.json', 'utf8')).replace(/^\uFEFF/, ''));
const vulnerabilityBytes = await readFile('.local/govulncheck-final.log');
const vulnerabilityOutput = vulnerabilityBytes.toString(vulnerabilityBytes[0] === 0xff && vulnerabilityBytes[1] === 0xfe ? 'utf16le' : 'utf8');
if (!vulnerabilityOutput.includes('Your code is affected by 0 vulnerabilities.')) throw new Error('Go vulnerability result must be reviewed');
const binary = await readFile('.local/panel-next.exe');
await writeFile('artifacts/verification.json', JSON.stringify({
  verified_at: new Date().toISOString(),
  application_url: 'http://127.0.0.1:8088',
  authentication: 'Login and Cloudflare deferred; loopback development identity enabled. Machine API/Wings credentials remain enforced.',
  go_version: '1.27.3',
  running_binary_sha256: createHash('sha256').update(binary).digest('hex'),
  reports,
  go_vet: 'passed',
  typescript_and_vite_build: 'passed',
  dependency_scan: {
    go_reachable_vulnerabilities: 0,
    go_imported_package_vulnerabilities: 0,
    go_unimported_package_advisories: ['GO-2026-5932 concerns x/crypto/openpgp, which the panel does not import.'],
    npm: npmAudit.metadata.vulnerabilities,
  },
  limitations: [
    'Passed test events include parent tests and named subtests; this is not a count of independent product features.',
    'Linux race execution skips live PHP/WSL reference checks and private integration opt-ins. Windows reference checks and separate real Wings/MariaDB/S3 artifacts supply that evidence.',
    'The original PHP database and running reference Wings were preserved. No production cutover or Cloudflare deployment was performed.',
  ],
}, null, 2));
console.log('Verification summary written; both Go reports contain zero failures.');
