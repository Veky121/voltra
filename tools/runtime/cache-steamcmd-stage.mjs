#!/usr/bin/env node
// Only run before installation on a stopped, owned batch-node volume.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ownedStoppedServer } from './cache-owned-server.mjs';

if (![3,4].includes(process.argv.length) || (process.argv[3] && process.argv[3] !== '--updated')) throw Error('Usage: node cache-steamcmd-stage.mjs OWNED_SERVER_RECEIPT [--updated]');
const updated = process.argv[3] === '--updated';
const { receiptPath, receipt, node, image } = await ownedStoppedServer(process.argv[2]);
const acquisition = JSON.parse(fs.readFileSync(updated ? '.local/cache-steamcmd-updated/acquisition.json' : '.local/cache-steamcmd/acquisition.json'));
if (acquisition.source !== 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz' || !/^[a-f0-9]{64}$/.test(acquisition.sha256)) throw Error('Unexpected acquisition source/digest');
if (updated && (acquisition.kind !== 'public-steamcmd-updated' || acquisition.steamcmd_self_updates_enabled !== true)) throw Error('Expected reviewed public updated bootstrap');
const script = fileURLToPath(new URL('./cache-steamcmd.py', import.meta.url));
const extraMounts = updated ? ['--mount', `type=bind,source=${fileURLToPath(new URL('./cache-steamcmd-public.py', import.meta.url))},target=/helper/cache-steamcmd-public.py,readonly`, '--mount', `type=bind,source=${resolve(acquisition.public_manifest)},target=/public-manifest.json,readonly`] : [];
const args = ['run', '--rm', '--pull', 'never', '--network', 'none', '--security-opt', 'no-new-privileges', '--memory', '256m',
  ...extraMounts,
  '--mount', `type=bind,source=${script},target=/helper/cache-steamcmd.py,readonly`,
  '--mount', `type=bind,source=${node.cache_root}/sha256/${acquisition.sha256},target=/bootstrap.tar.gz,readonly`,
  '--mount', `type=bind,source=${node.volume_root}/${receipt.uuid},target=/volume`,
  image, 'python3', '-B', '/helper/cache-steamcmd.py', '--root', '/volume', '--blob', '/bootstrap.tar.gz',
  '--sha256', acquisition.sha256, '--source', acquisition.source, '--acquired-at', acquisition.acquired_at,
  ...(updated ? ['--public-manifest', '/public-manifest.json'] : [])];
const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Bootstrap staging failed: ' + result.stderr);
const report = { ...JSON.parse(result.stdout), uuid: receipt.uuid, node: node.node, staged_at: new Date().toISOString(),
  acceptance_scope: 'Warm shared SteamCMD bootstrap; game download and native acceptance still required' };
const output = resolve(receiptPath, '..', 'steamcmd-cache-stage.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
