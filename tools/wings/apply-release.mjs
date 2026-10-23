// Apply the complete Voltra patch set to a clean, pinned upstream checkout.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.resolve(process.argv[2] || '');
const upstream = '6987d5e6f0612133e031255a99655e822d30579a';
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (git('rev-parse', 'HEAD') !== upstream) throw Error('Expected pinned Wings v1.13.3 commit');
if (git('status', '--porcelain')) throw Error('Expected clean upstream checkout');
const inputs = ['tools/runtime/wings-failed-install-logs.patch', 'tools/wings/install_wait_test.go.txt'];
// This combined patch includes install-status.patch. Applying both would duplicate it.
const patch = fs.readFileSync(path.join(moduleRoot, inputs[0]), 'utf8').replace(/\r\n/g, '\n');
execFileSync('git', ['-C', root, 'apply', '--check', '-'], { input: patch });
execFileSync('git', ['-C', root, 'apply', '-'], { input: patch });
fs.copyFileSync(path.join(moduleRoot, inputs[1]), path.join(root, 'server/install_wait_test.go'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const provenance = {
  upstream_repository: 'https://github.com/pterodactyl/wings',
  upstream_tag: 'v1.13.3', upstream_commit: upstream,
  license: 'MIT', license_sha256: hash(fs.readFileSync(path.join(root, 'LICENSE'))),
  inputs: inputs.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(moduleRoot, file), 'utf8').replace(/\r\n/g, '\n')) })),
  superseded: ['tools/wings/install-status.patch', 'tools/wings/apply-install-status.mjs'],
};
fs.writeFileSync(path.join(root, 'voltra-provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log('Applied complete pinned Wings patch set. No services changed.');
