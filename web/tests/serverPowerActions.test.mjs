import test from 'node:test';
import assert from 'node:assert/strict';
import {powerActions} from '../src/features/servers/serverPowerActions.ts';

const all = () => true;
const base = {pending: null, serverStatus: null, installing: false, maintenance: false, connected: true, can: all};
const view = input => {
  const result = powerActions({...base, ...input});
  return {
    buttons: result.primary.map(b => `${b.signal}${b.busy ? ':busy' : ''}${b.disabled && !b.busy ? ':disabled' : ''}`),
    forceStop: result.forceStop === null ? 'hidden' : result.forceStop.disabled ? 'disabled' : 'enabled',
    reason: result.reason,
  };
};

test('offline shows Start only and no force stop', () => {
  for (const state of ['offline', 'stopped'])
    assert.deepEqual(view({state}), {buttons: ['start'], forceStop: 'hidden', reason: ''});
});

test('running shows Restart and Stop, with Force stop in the menu', () => {
  assert.deepEqual(view({state: 'running'}), {buttons: ['restart', 'stop'], forceStop: 'enabled', reason: ''});
});

test('starting and stopping show only the transition in progress', () => {
  assert.deepEqual(view({state: 'starting'}), {buttons: ['start:busy'], forceStop: 'enabled', reason: ''});
  assert.deepEqual(view({state: 'stopping'}), {buttons: ['stop:busy'], forceStop: 'enabled', reason: ''});
});

test('installing, restoring, transfers and unknown state offer nothing', () => {
  assert.deepEqual(view({state: 'running', serverStatus: 'installing'}).buttons, []);
  assert.equal(view({state: 'running', serverStatus: 'restoring_backup'}).forceStop, 'hidden');
  assert.deepEqual(view({state: 'offline', installing: true}).buttons, []);
  assert.deepEqual(view({state: 'unknown'}), {buttons: [], forceStop: 'hidden', reason: ''});
  assert.deepEqual(view({state: 'running', connected: false}), {buttons: [], forceStop: 'hidden', reason: ''});
});

test('a pending request shows its own busy control and waits for acceptance before force stop', () => {
  assert.deepEqual(view({state: 'running', pending: {signal: 'restart', accepted: false}}), {
    buttons: ['restart:busy'],
    forceStop: 'disabled',
    reason: '',
  });
  assert.deepEqual(view({state: 'running', pending: {signal: 'stop', accepted: true}}), {
    buttons: ['stop:busy'],
    forceStop: 'enabled',
    reason: '',
  });
  // Startup may already be running even though the last sample said offline.
  assert.deepEqual(view({state: 'offline', pending: {signal: 'start', accepted: true}}), {
    buttons: ['start:busy'],
    forceStop: 'enabled',
    reason: '',
  });
  assert.deepEqual(view({state: 'running', pending: {signal: 'kill', accepted: true}}), {
    buttons: ['kill:busy'],
    forceStop: 'hidden',
    reason: '',
  });
});

test('maintenance keeps the applicable controls visible but disabled with a reason', () => {
  assert.deepEqual(view({state: 'running', maintenance: true}), {
    buttons: ['restart:disabled', 'stop:disabled'],
    forceStop: 'disabled',
    reason: 'The node is under maintenance.',
  });
});

test('actions the user may not use are hidden', () => {
  const only = permission => p => p === permission;
  assert.deepEqual(view({state: 'running', can: only('control.restart')}), {
    buttons: ['restart'],
    forceStop: 'hidden',
    reason: '',
  });
  assert.deepEqual(view({state: 'running', can: only('control.stop')}), {
    buttons: ['stop'],
    forceStop: 'enabled',
    reason: '',
  });
  assert.deepEqual(view({state: 'offline', can: only('control.stop')}).buttons, []);
});

test('narrow dashboards put the console before the charts', async () => {
  const {dashboardSections} = await import('../src/features/servers/dashboardLayout.ts');
  assert.deepEqual(dashboardSections(true), ['console', 'insights', 'resources']);
  assert.deepEqual(dashboardSections(false), ['insights', 'resources', 'console']);
});
