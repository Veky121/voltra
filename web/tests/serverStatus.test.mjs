import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveServerStatus,
  serverStatus,
  serverStatusKey,
  serverStatusLabel,
  serverStatusVocabulary,
} from '../src/serverStatus.ts';

test('panel and Wings states share one set of words', () => {
  const cases = {
    running: 'Running',
    online: 'Running',
    starting: 'Starting',
    stopping: 'Stopping',
    offline: 'Offline',
    stopped: 'Offline',
    installing: 'Installing',
    install_failed: 'Install failed',
    reinstall_failed: 'Install failed',
    restoring_backup: 'Restoring backup',
    transferring: 'Transferring',
    suspended: 'Suspended',
    unknown: 'Checking',
    connecting: 'Checking',
    unavailable: 'Unknown',
  };
  for (const [state, label] of Object.entries(cases)) assert.equal(serverStatusLabel(state), label, state);
});

test('anything unrecognised is Unknown rather than a raw state name', () => {
  for (const state of ['', 'paused_weirdly', 'toString', '__proto__', undefined, null, 3])
    assert.equal(serverStatusKey(state), 'unknown', String(state));
  assert.deepEqual(serverStatus('restoring_backup'), {key: 'restoring', label: 'Restoring backup', tone: 'warning'});
});

test('every status has a label and a tone', () => {
  for (const [key, entry] of Object.entries(serverStatusVocabulary)) {
    assert.ok(entry.label, key);
    assert.ok(['success', 'warning', 'danger', 'neutral'].includes(entry.tone), key);
  }
  assert.equal(serverStatus('running').tone, 'success');
  assert.equal(serverStatus('offline').tone, 'neutral');
  assert.equal(serverStatus('install_failed').tone, 'danger');
});

test('panel conditions outrank the live state', () => {
  assert.equal(resolveServerStatus({status: 'suspended', state: 'running'}), 'suspended');
  assert.equal(resolveServerStatus({is_suspended: true, state: 'running'}), 'suspended');
  assert.equal(resolveServerStatus({status: 'restoring_backup', state: 'offline'}), 'restoring');
  assert.equal(resolveServerStatus({status: null, is_installing: true, state: 'offline'}), 'installing');
  assert.equal(resolveServerStatus({is_transferring: true, state: 'running'}), 'transferring');
  assert.equal(resolveServerStatus({status: null, state: 'running'}), 'running');
  assert.equal(resolveServerStatus({}), 'checking');
});
