import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
const exec = promisify(execFile);
export let campaign, receipt, settings, output;
let transact, queuePath, monitorName, previousCpu, monitorOwned = false;
export async function docker(args, signal, timeout = 30000) {
  try {
    const result = await exec('docker', ['--context', 'desktop-linux', ...args], { windowsHide: true, maxBuffer: 8 * 1024 ** 2, timeout, signal });
    return args[0] === 'logs' ? result.stdout + result.stderr : result.stdout;
  }
  catch (e) { throw Error(`Docker ${args[0]} failed: ${String(e.stderr ?? e.message).slice(0, 400)}`); }
}
export async function open(config, { out }) {
  settings = config; output = out;
  const root = resolve(config.campaignRoot);
  campaign = await import(pathToFileURL(resolve(root, 'tools/runtime/campaign-native-20261029.mjs')).href);
  ({ transact } = await import(pathToFileURL(resolve(root, 'tools/runtime/batch-queue.mjs')).href));
  receipt = await campaign.verifyRuntime();
  if (receipt.binary_sha256 !== config.build) throw Error('Manifest build differs from verified campaign runtime');
  queuePath = resolve(campaign.runtime, 'queue.json');
  transact(queuePath, q => {
    if (q.claims.some(c => c.status === 'active') || q.installer_slot) throw Error('Legacy campaign has active work');
    if (q.activation_pause && q.activation_pause.validatorOutput !== out) throw Error('Another coordinator owns campaign pause');
    q.activation_pause = { validatorOutput: out, pid: process.pid, reason: 'Exclusive validator pool; preserved fixtures remain owned', at: new Date().toISOString() };
  });
  // The campaign has no unrelated servers. Retained fixtures must be accounted
  // for by durable validator reports before any new provisioning.
  const owned = new Set();
  for (const name of await fs.readdir(out)) if (name.endsWith('.json')) {
    const value = JSON.parse(await fs.readFile(resolve(out, name), 'utf8'));
    if (value.fixture?.server?.uuid) owned.add(value.fixture.server.uuid);
  }
  const servers = (await campaign.api('/api/application/servers?per_page=1000')).data.map(x => x.attributes);
  if (servers.some(s => !owned.has(s.uuid))) throw Error('Unaccounted server in isolated campaign pool');
  monitorName = 'voltra-validator-monitor';
  const names = (await docker(['ps', '-a', '--format', '{{.Names}}'])).trim().split('\n');
  if (names.includes(monitorName)) throw Error('Prior monitor exists; inspect prior queue owner before recovery');
  await docker(['run', '-d', '--name', monitorName, '--label', 'voltra.validator=monitor', '--pull', 'never', '--network', 'none', '--read-only', '--memory', '64m', '--memory-swap', '64m', '--cpus', '0.1', '--mount', 'type=bind,source=/var/lib/voltra-parity-20261029,target=/data,readonly', 'alpine:3.22', 'sleep', '86400']);
  monitorOwned = true;
}
export async function sample() {
  const text = await docker(['exec', monitorName, 'sh', '-c', 'cat /proc/meminfo; head -1 /proc/stat; df -Pk /data']);
  const memory = Number(text.match(/^MemAvailable:\s+(\d+)/m)?.[1]) / 1024;
  const counters = text.match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/).map(Number);
  if (!counters) throw Error('Missing VM CPU counters');
  const cpu = { total: counters.slice(0, 8).reduce((s, n) => s + n, 0), idle: counters[3] + counters[4] };
  const busy = previousCpu ? 1 - (cpu.idle - previousCpu.idle) / Math.max(1, cpu.total - previousCpu.total) : 0;
  previousCpu = cpu;
  const diskLine = text.trim().split('\n').at(-1).trim().split(/\s+/);
  const vmDisk = Number(diskLine[3]) / 1024;
  // Windows disk headroom matters because the VM disk is dynamically allocated.
  const hostDisk = JSON.parse((await exec('powershell', ['-NoProfile', '-Command', '(Get-PSDrive C).Free | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 10000 })).stdout) / 1048576;
  return { freeMiB: Math.min(memory, os.freemem() / 1048576), freeDiskMiB: Math.min(vmDisk, hostDisk), cpuBusy: Math.max(0, Math.min(1, busy)), vmAvailableMiB: memory, hostAvailableMiB: os.freemem() / 1048576 };
}
export async function close() {
  if (monitorOwned) {
    const label = (await docker(['inspect', '--format', '{{index .Config.Labels "voltra.validator"}}', monitorName])).trim();
    if (label !== 'monitor') throw Error('Monitor ownership changed');
    await docker(['rm', '-f', monitorName]); monitorName = null;
  }
  // Retain the legacy exclusion while parked fixtures exist. The next run using
  // this output directory can resume it; an unrelated coordinator cannot.
}
