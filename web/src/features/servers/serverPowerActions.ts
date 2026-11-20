import type {PowerSignal} from '../console/consoleLifecycle';

export type PowerButton = {signal: PowerSignal; label: string; busy: boolean; disabled: boolean};
export type PowerActions = {
  /** Buttons shown beside the title, in display order. */
  primary: PowerButton[];
  /** Force stop lives in the overflow menu; null hides it. */
  forceStop: {disabled: boolean} | null;
  /** Why visible actions are disabled; empty when they can be used. */
  reason: string;
};
export type PowerActionInput = {
  state: string;
  /** Pending operation from this page, if any. */
  pending: {signal: PowerSignal; accepted: boolean} | null;
  /** Server-level operation (installing, restoring a backup, transfer...). */
  serverStatus?: string | null;
  installing?: boolean;
  maintenance?: boolean;
  /** No telemetry sample yet, or the last one failed. */
  connected: boolean;
  can: (permission: string) => boolean;
};

const labels: Record<PowerSignal, string> = {start: 'Start', restart: 'Restart', stop: 'Stop', kill: 'Force stop'};
const permission: Record<PowerSignal, string> = {
  start: 'control.start',
  restart: 'control.restart',
  stop: 'control.stop',
  kill: 'control.stop',
};
const none: PowerActions = {primary: [], forceStop: null, reason: ''};

/**
 * Power actions that apply to the server's current state. Offline shows Start,
 * running shows Restart and Stop, and a server that is starting or stopping
 * shows only the transition in progress. Force stop is offered whenever a
 * process may exist. Nothing is offered while the state is unknown or a
 * server-level operation (installation, restore, transfer) owns the server.
 */
export function powerActions(input: PowerActionInput): PowerActions {
  if (input.serverStatus || input.installing || !input.connected) return none;
  const offline = input.state === 'offline' || input.state === 'stopped';
  const pending = input.pending;
  let signals: PowerSignal[];
  let busy: PowerSignal | null = null;
  if (pending) {
    // The requested action stays visible as the busy control until the node
    // reports the outcome; other actions wait.
    signals = [pending.signal];
    busy = pending.signal;
  } else if (offline) signals = ['start'];
  else if (input.state === 'running') signals = ['restart', 'stop'];
  else if (input.state === 'starting') {
    signals = ['start'];
    busy = 'start';
  } else if (input.state === 'stopping') {
    signals = ['stop'];
    busy = 'stop';
  } else return none;

  const maintenance = !!input.maintenance;
  const reason = maintenance ? 'The node is under maintenance.' : '';
  const primary = signals
    .filter(signal => input.can(permission[signal]))
    .map(signal => ({
      signal,
      label: labels[signal],
      busy: signal === busy,
      // A busy control only reports progress; a second click would resend.
      disabled: maintenance || signal === busy,
    }));
  // A process may exist unless the node reported it offline and nothing is pending.
  const killable = !(offline && !pending) && pending?.signal !== 'kill';
  // Wait for the node to accept a request before another can be sent.
  const forceStop =
    killable && input.can(permission.kill) ? {disabled: maintenance || (!!pending && !pending.accepted)} : null;
  return {primary, forceStop, reason};
}
