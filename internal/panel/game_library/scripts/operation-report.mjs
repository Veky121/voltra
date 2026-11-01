// Shared script-to-panel operation protocol. Never pass raw exceptions, URLs or secrets.
import {randomUUID} from 'node:crypto';
export const operationPrefix = '@voltra/operation ';
const states = new Set(['queued','running','completed','failed']);
const phases = new Set(['prepare','authorize','download','verify','extract','apply']);
const integer = value => Number.isSafeInteger(value) && value >= 0;
export function createOperationReporter({source = 'game', write = line => console.log(line), now = Date.now, id = randomUUID()} = {}) {
  if (typeof source !== 'string' || typeof id !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(source) || !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw Error('Invalid operation identity');
  let sequence = 0, last = -Infinity, terminal = false;
  return (event, {force = false} = {}) => {
    if (terminal) return false;
    const {state, phase, code, bytes, total, restart_required} = event;
    if (!states.has(state) || !phases.has(phase) || !/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) throw Error('Invalid operation state');
    if (bytes !== undefined && !integer(bytes) || total !== undefined && total !== null && (!integer(total) || total === 0 || bytes > total)) throw Error('Invalid operation progress');
    const at = now();
    if (!force && state === 'running' && at - last < 1000) return false;
    last = at; terminal = state === 'completed' || state === 'failed';
    const data = {v:1, id, sequence:++sequence, at:new Date(at).toISOString(), source, state, phase, code};
    if (bytes !== undefined) data.bytes = bytes;
    if (total !== undefined) data.total = total;
    if (typeof restart_required === 'boolean') data.restart_required = restart_required;
    write(operationPrefix + JSON.stringify(data));
    return true;
  };
}
