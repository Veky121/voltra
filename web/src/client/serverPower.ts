import {api} from '../lib';
import {runPowerRequest} from './consoleLifecycle';
import type {PowerSignal} from './consoleLifecycle';

export const consolePowerEvent = 'voltra:console-power';
export type ConsolePowerEvent = {base: string; line: string};

export function requestServerPower(base: string, signal: PowerSignal) {
  return runPowerRequest(signal, () => api(`${base}/power`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({signal}),
  }), line => window.dispatchEvent(new CustomEvent<ConsolePowerEvent>(consolePowerEvent, {detail: {base, line}})));
}
