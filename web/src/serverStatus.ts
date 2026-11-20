// One set of words for what a server is doing. Panel states (installing,
// suspended, restoring) and live Wings states (running, offline) both map
// here, so every page says "Offline" for the same thing.
export type ServerStatus =
  | 'running'
  | 'starting'
  | 'stopping'
  | 'offline'
  | 'installing'
  | 'install_failed'
  | 'restoring'
  | 'transferring'
  | 'suspended'
  | 'checking'
  | 'unknown';
export type ServerStatusTone = 'success' | 'warning' | 'danger' | 'neutral';

export const serverStatusVocabulary: Record<ServerStatus, {label: string; tone: ServerStatusTone}> = {
  running: {label: 'Running', tone: 'success'},
  starting: {label: 'Starting', tone: 'warning'},
  stopping: {label: 'Stopping', tone: 'warning'},
  offline: {label: 'Offline', tone: 'neutral'},
  installing: {label: 'Installing', tone: 'warning'},
  install_failed: {label: 'Install failed', tone: 'danger'},
  restoring: {label: 'Restoring backup', tone: 'warning'},
  transferring: {label: 'Transferring', tone: 'warning'},
  suspended: {label: 'Suspended', tone: 'danger'},
  // Nothing has been read yet.
  checking: {label: 'Checking', tone: 'neutral'},
  // A read was attempted and gave no answer.
  unknown: {label: 'Unknown', tone: 'danger'},
};

const names: Record<string, ServerStatus> = {
  running: 'running',
  online: 'running',
  starting: 'starting',
  stopping: 'stopping',
  offline: 'offline',
  stopped: 'offline',
  installing: 'installing',
  install_failed: 'install_failed',
  reinstall_failed: 'install_failed',
  restoring_backup: 'restoring',
  restoring: 'restoring',
  transferring: 'transferring',
  suspended: 'suspended',
  unknown: 'checking',
  checking: 'checking',
  connecting: 'checking',
  unavailable: 'unknown',
};

/** The vocabulary key for a panel or Wings state; anything unrecognised is `unknown`. */
export function serverStatusKey(state: unknown): ServerStatus {
  return typeof state === 'string' && Object.hasOwn(names, state) ? names[state] : 'unknown';
}

export type ServerStatusInput = {
  /** The panel's server status (installing, suspended, restoring_backup...), or null. */
  status?: string | null;
  is_installing?: boolean;
  is_suspended?: boolean;
  is_transferring?: boolean;
  /** The live Wings state, when one has been read. */
  state?: string;
};

/** Panel conditions outrank the live state: a suspended server is Suspended even while its process runs. */
export function resolveServerStatus({
  status,
  is_installing,
  is_suspended,
  is_transferring,
  state,
}: ServerStatusInput): ServerStatus {
  if (is_suspended || status === 'suspended') return 'suspended';
  if (status) return serverStatusKey(status);
  if (is_transferring) return 'transferring';
  if (is_installing) return 'installing';
  return state === undefined ? 'checking' : serverStatusKey(state);
}

export function serverStatus(state: unknown): {key: ServerStatus; label: string; tone: ServerStatusTone} {
  const key = serverStatusKey(state);
  return {key, ...serverStatusVocabulary[key]};
}
export const serverStatusLabel = (state: unknown): string => serverStatus(state).label;
