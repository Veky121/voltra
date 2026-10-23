#!/usr/bin/env node
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ownedStoppedServer } from './cache-owned-server.mjs';

const digests = process.argv.slice(3);
if (!process.argv[2] || !digests.length || digests.length > 32 || digests.some(digest => !/^[a-f0-9]{64}$/.test(digest))) throw Error('Usage: node cache-volume-seed.mjs OWNED_SERVER_RECEIPT SHA256 [SHA256...]');
const { receiptPath, receipt, node, image } = await ownedStoppedServer(process.argv[2]);
const script = fileURLToPath(new URL('./cache-volume-seed.py', import.meta.url));
const helper = fileURLToPath(new URL('../../internal/panel/game_library/scripts/download-cache.py', import.meta.url));
const args = ['run', '--rm', '--pull', 'never', '--network', 'none', '--security-opt', 'no-new-privileges', '--memory', '256m',
  '--mount', `type=bind,source=${script},target=/helper/cache-volume-seed.py,readonly`,
  '--mount', `type=bind,source=${helper},target=/helper/download-cache.py,readonly`,
  '--mount', `type=bind,source=${node.cache_root}/sha256,target=/blobs,readonly`,
  '--mount', `type=bind,source=${node.volume_root}/${receipt.uuid},target=/volume`,
  image, 'python3', '-B', '/helper/cache-volume-seed.py', '--root', '/volume', '--blobs', '/blobs', ...digests.flatMap(digest => ['--sha256', digest])];
const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) throw Error('Public cache volume seeding failed: ' + result.stderr);
const report = { ...JSON.parse(result.stdout), uuid: receipt.uuid, node: node.node, seeded_at: new Date().toISOString() };
fs.writeFileSync(join(dirname(receiptPath), 'cache-public-seed-' + digests[0] + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
