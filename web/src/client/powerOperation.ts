import type {PowerSignal} from './consoleLifecycle';

export type PowerOperation = {
  signal: PowerSignal;
  accepted: boolean;
  requestedAt: number;
  lastSample: number;
  initialUptime: number;
  phase: 'sending' | 'stopping' | 'starting';
  sawStartup: boolean;
  sawShutdown: boolean;
};

export function beginPowerOperation(signal: PowerSignal, sample: number, uptime: number, now = Date.now()): PowerOperation {
  return {signal, accepted: false, requestedAt: now, lastSample: sample, initialUptime: uptime,
    phase: 'sending', sawStartup: false, sawShutdown: false};
}

export function advancePowerOperation(operation: PowerOperation, state: string, uptime: number, sample: number): {operation: PowerOperation | null; outcome?: 'success' | 'error'; message?: string} {
  if (!operation.accepted || sample <= operation.lastSample) return {operation};
  const next = {...operation, lastSample: sample};
  const offline = state === 'offline' || state === 'stopped';
  if (next.signal === 'stop' || next.signal === 'kill') {
    if (offline) return {operation: null, outcome: 'success', message: next.signal === 'kill' ? 'Server force stopped.' : 'Server stopped.'};
    next.phase = 'stopping';
    return {operation: next};
  }
  if (state === 'starting') next.sawStartup = true;
  if (next.signal === 'restart') {
    if (offline || state === 'starting') next.sawShutdown = true;
    // Polling can miss a quick stop/start cycle. A lower process uptime also
    // proves that the previous process exited; an unchanged running state cannot.
    const restarted = next.sawShutdown || (uptime > 0 && uptime < next.initialUptime);
    if (state === 'running' && restarted) return {operation: null, outcome: 'success', message: 'Server restarted.'};
    next.phase = offline || state === 'starting' || next.sawStartup ? 'starting' : 'stopping';
  } else {
    if (state === 'running') return {operation: null, outcome: 'success', message: 'Server started.'};
    next.phase = 'starting';
  }
  if (offline && next.sawStartup) return {operation: null, outcome: 'error', message: 'Server went offline during startup. Check the console output.'};
  return {operation: next};
}

export function powerOperationLabel(operation: PowerOperation): string {
  if (operation.signal === 'kill') return 'Force stopping…';
  if (operation.signal === 'stop') return 'Stopping…';
  if (operation.signal === 'start') return 'Starting…';
  return operation.phase === 'starting' ? 'Starting…' : 'Waiting for exit…';
}
