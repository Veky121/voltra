// Read-only guards shared by batch-cache provisioning commands.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export async function ownedStoppedServer(input) {
  const receiptPath = resolve(input);
  const receipt = JSON.parse(fs.readFileSync(receiptPath));
  const node = JSON.parse(fs.readFileSync('.local/batch-node/private.json'));
  if (!/^[a-f0-9-]{36}$/.test(receipt.uuid) || !Number.isSafeInteger(receipt.internal_id) ||
      node.node !== 202 || node.root !== '/var/lib/voltra-batch-20261023' ||
      node.volume_root !== node.root + '/volumes' || node.cache_root !== node.root + '/cache') throw Error('Unexpected owned batch-node receipt');
  const response = await fetch('http://127.0.0.1:8088/api/application/servers/' + receipt.internal_id);
  if (!response.ok) throw Error('Owned server lookup failed');
  const server = (await response.json()).attributes;
  if (server.uuid !== receipt.uuid || server.node !== node.node ||
      ![null, undefined, ''].includes(server.status)) throw Error('Server UUID/node/state is unsafe to provision');
  for (const name of [receipt.uuid, receipt.uuid + '_installer']) {
    const inspect = spawnSync('docker', ['inspect', name], { windowsHide: true, encoding: 'utf8' });
    if (inspect.status === 0) {
      const info = JSON.parse(inspect.stdout)[0];
      if (info.State.Running || info.State.Restarting) throw Error('Owned server/installer is running');
    } else if (!inspect.stderr.includes('No such')) throw Error('Cannot establish owned container state');
  }
  const image = spawnSync('docker', ['image', 'inspect', 'python:3.13-slim', '--format', '{{.Id}}'], { windowsHide: true, encoding: 'utf8' });
  if (image.status || !image.stdout.trim().startsWith('sha256:')) throw Error('Existing Python helper image unavailable');
  return { receiptPath, receipt, node, image: image.stdout.trim() };
}
