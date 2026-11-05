import os from 'node:os';
import { statfs } from 'node:fs/promises';

let previous;
export async function sample() {
  // Explicit opt-in prevents accidentally scheduling a remote Docker host from
  // the coordinator laptop's free memory. Docker Desktop needs a VM monitor.
  if (process.env.VALIDATOR_EXECUTION_HOST !== 'local-native') throw Error('Configure an execution-host monitor; local-native opt-in is absent');
  if (!process.env.VALIDATOR_DATA_PATH) throw Error('Set VALIDATOR_DATA_PATH to the game storage volume');
  const cpus = os.cpus().reduce((a, cpu) => {
    a.idle += cpu.times.idle; a.total += Object.values(cpu.times).reduce((s, n) => s + n, 0); return a;
  }, { idle: 0, total: 0 });
  const cpuBusy = previous ? 1 - (cpus.idle - previous.idle) / Math.max(1, cpus.total - previous.total) : 1;
  previous = cpus;
  const disk = await statfs(process.env.VALIDATOR_DATA_PATH);
  return { freeMiB: os.freemem() / 1048576, freeDiskMiB: Number(disk.bavail) * Number(disk.bsize) / 1048576, cpuBusy };
}
