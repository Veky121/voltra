#!/usr/bin/env node
// Docker Desktop cache helper. Uses only an already-present Python image.
import { spawnSync } from 'node:child_process';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync } from 'node:fs';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  if (!['--sha256', '--url', '--source', '--destination', '--max-bytes'].includes(key) || !process.argv[index + 1] || options[key]) {
    throw new Error('Usage: node cache-artifact.mjs --sha256 DIGEST (--url PUBLIC_HTTPS_URL | --source LOCAL_FILE) [--destination LOCAL_FILE] [--max-bytes LIMIT]');
  }
  options[key] = process.argv[index + 1];
}
if (!/^[a-f0-9]{64}$/.test(options['--sha256'] ?? '') || Boolean(options['--url']) === Boolean(options['--source'])) {
  throw new Error('Supply a SHA-256 and exactly one public URL or local source');
}
const image = spawnSync('docker', ['image', 'inspect', 'python:3.13-slim', '--format', '{{.Id}}'], { windowsHide: true, encoding: 'utf8' });
if (image.status !== 0 || !image.stdout.trim().startsWith('sha256:')) throw new Error('An already-present python:3.13-slim Docker image is required');
const script = fileURLToPath(new URL('../../internal/panel/game_library/scripts/download-cache.py', import.meta.url));
const command = ['run', '--rm', '--pull', 'never', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m',
  '--mount', `type=bind,source=${script},target=/helper/download-cache.py,readonly`,
  '-v', '/var/lib/voltra-batch-20261023/cache:/cache'];
const python = ['python3', '-B', '/helper/download-cache.py', '--cache', '/cache', '--sha256', options['--sha256']];
if (options['--source']) {
  const source = resolve(options['--source']);
  if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) throw new Error('Source must be an ordinary file');
  command.push('--mount', `type=bind,source=${source},target=/input/artifact,readonly`, '--network', 'none');
  python.push('--source', '/input/artifact');
} else {
  const url = new URL(options['--url']);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use a public HTTPS URL without credentials or a query');
  python.push('--url', url.href);
}
if (options['--destination']) {
  const destination = resolve(options['--destination']);
  if (!existsSync(dirname(destination)) || existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error('Destination needs an existing parent and cannot be a symlink');
  command.push('--mount', `type=bind,source=${dirname(destination)},target=/output`);
  python.push('--destination', '/output/' + basename(destination));
}
if (options['--max-bytes']) python.push('--max-bytes', options['--max-bytes']);
command.push(image.stdout.trim(), ...python);
const result = spawnSync('docker', command, { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
