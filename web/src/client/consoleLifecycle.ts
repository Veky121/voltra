export type PowerSignal = 'start' | 'stop' | 'restart' | 'kill';
type LifecycleTone = 'info' | 'warning' | 'success' | 'error';
const colors: Record<LifecycleTone, number> = {info: 94, warning: 93, success: 92, error: 91};

export function lifecycleLine(message: string, tone: LifecycleTone, at = new Date()): string {
  const clock = [at.getHours(), at.getMinutes(), at.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
  // Reset inherited game ANSI styles before and after panel-generated messages.
  return `\x1b[0m\x1b[90m[${clock}] \x1b[96m[Voltra]: \x1b[${colors[tone]}m${message}\x1b[0m`;
}

export async function runPowerRequest<T>(signal: PowerSignal, send: () => Promise<T>, emit: (line: string) => void): Promise<T> {
  const name = {start: 'Start', stop: 'Stop', restart: 'Restart', kill: 'Force stop'}[signal];
  const detail = {
    start: 'Waiting for the node to begin startup.',
    stop: 'Waiting for graceful shutdown. The game may need time to save.',
    restart: 'Waiting for shutdown, then startup.',
    kill: 'The process will be terminated immediately. Unsaved data may be lost.',
  }[signal];
  emit(lifecycleLine(`${name} requested. ${detail}`, signal === 'kill' ? 'error' : signal === 'start' ? 'info' : 'warning'));
  try {
    const result = await send();
    emit(lifecycleLine(`${name} request accepted by the node. Waiting for a state update.`, 'info'));
    return result;
  } catch (error) {
    // Do not copy arbitrary API error bodies or credentials into downloadable logs.
    emit(lifecycleLine(`Could not confirm the ${name.toLowerCase()} request. Check the server state and the panel error before retrying.`, 'error'));
    throw error;
  }
}

export function consoleStateLine(previous: string, next: string, at = new Date()): string | null {
  if (previous === next || !['offline', 'starting', 'running', 'stopping'].includes(next)) return null;
  if (previous === 'unknown') return lifecycleLine(`Current server state: ${next}.`, 'info', at);
  switch (next) {
    case 'starting': return lifecycleLine('Server is starting. Preparing the container and launching the process.', 'info', at);
    case 'running': return lifecycleLine('Server entered the running state.', 'success', at);
    case 'stopping': return lifecycleLine('Server is stopping. Waiting for the process to exit.', 'warning', at);
    case 'offline':
      if (previous === 'starting') return lifecycleLine('Server went offline during startup. Check the startup output above.', 'error', at);
      if (previous === 'stopping') return lifecycleLine('Server stopped. The container is offline.', 'success', at);
      return lifecycleLine('Server is now offline. The process exited or was stopped.', 'warning', at);
    default: return null;
  }
}
