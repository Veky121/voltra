import test from 'node:test';
import assert from 'node:assert/strict';
import {loadModule} from './loadModule.mjs';
import * as transferModel from '../src/features/servers/remoteTransferModel.ts';

const {
  mergeTransfers,
  reconcileTransfers,
  transferActive,
  transferRecentlyActive,
  transferPollDelay,
  transferProgress,
  transferRecentlyCompleted,
  transferCompletionWindow,
} = transferModel;

const transfer = {identifier: 'one', name: 'world.zip', directory: '/', state: 'downloading', updated: 100};

test('unknown and legacy size reports do not manufacture a percentage', () => {
  assert.equal(transferProgress({...transfer, progress: 0.7}), null);
  assert.equal(transferProgress({...transfer, size_known: false, total_bytes: 100, received_bytes: 70}), null);
  assert.equal(transferProgress({...transfer, size_known: true, total_bytes: 0, received_bytes: 0}), null);
  assert.equal(transferProgress({...transfer, size_known: true, total_bytes: 100, received_bytes: NaN}), null);
});

test('known transfer byte counts produce bounded progress, awaiting save does not imply completion', () => {
  assert.equal(transferProgress({...transfer, size_known: true, total_bytes: 200, received_bytes: 50}), 25);
  assert.equal(transferProgress({...transfer, size_known: true, total_bytes: 200, received_bytes: 201}), 100);
  assert.equal(
    transferProgress({...transfer, state: 'awaiting_save', size_known: true, total_bytes: 200, received_bytes: 200}),
    null
  );
  assert.equal(transferActive({...transfer, state: 'awaiting_save'}), true);
  assert.equal(transferActive({...transfer, state: 'failed'}), false);
  assert.equal(transferProgress({...transfer, state: 'complete'}), 100);
});

test('late socket or polling events never regress completed work', () => {
  const complete = {...transfer, state: 'complete', updated: 200};
  assert.deepEqual(mergeTransfers({one: complete}, [{...transfer, updated: 250}]), {one: complete});
  assert.deepEqual(mergeTransfers({one: transfer}, [{...transfer, updated: 50, received_bytes: 0}]), {one: transfer});
});

test('shared records combine upload and download producers without overwriting each other', () => {
  const upload = {...transfer, identifier: 'upload-two', kind: 'upload', state: 'uploading'};
  const records = mergeTransfers({one: transfer}, [upload]);
  assert.deepEqual(Object.keys(records), ['one', 'upload-two']);
  assert.equal(records['upload-two'].kind, 'upload');
  assert.deepEqual(mergeTransfers(records, [{...transfer, identifier: '', updated: 900}]), records);
});

test('optimistic queued record does not override server time when client clock is ahead', () => {
  const queued = {...transfer, state: 'queued', updated: 0};
  assert.equal(mergeTransfers({one: queued}, [transfer]).one.state, 'downloading');
});

test('authoritative snapshots remove canceled uploads and expired outcomes without inventing completion', () => {
  const upload = {...transfer, identifier: 'upload-two', kind: 'upload', state: 'uploading'};
  const started = {one: transfer, 'upload-two': upload};
  assert.deepEqual(reconcileTransfers(started, [], 'upload', started), {one: transfer});
  const completed = {...transfer, state: 'complete'};
  assert.deepEqual(reconcileTransfers({one: completed}, [], 'download', {one: completed}), {});
});

test('an older snapshot cannot remove jobs started or updated while its request was in flight', () => {
  const started = {one: transfer};
  const update = {...transfer, received_bytes: 12, updated: 101};
  const queued = {...transfer, identifier: 'new', state: 'queued', updated: 0};
  const current = {one: update, new: queued};
  assert.deepEqual(reconcileTransfers(current, [], 'download', started), current);
});

test('paused uploads remain resumable without active animation or frequent idle polling', () => {
  const now = 100000,
    upload = {...transfer, kind: 'upload', state: 'uploading', updated: now - 31000};
  assert.equal(transferActive(upload), true);
  assert.equal(transferRecentlyActive(upload, now), false);
  assert.equal(transferPollDelay([upload], true, now), 30000);
  assert.equal(transferPollDelay([{...upload, updated: now}], true, now), 5000);
  assert.equal(transferPollDelay([], false, now), 30000);
  assert.equal(transferPollDelay([transfer], true, now), 30000);
  assert.equal(transferPollDelay([transfer], false, now), 5000);
  assert.equal(
    mergeTransfers({[upload.identifier]: upload}, [{...upload, updated: now, received_bytes: 20}])[upload.identifier]
      .received_bytes,
    20
  );
});

test('only a recent confirmed transfer completion is shown as done', () => {
  const receipt = {state: 'complete', updated: 10000};
  assert.equal(transferRecentlyCompleted(receipt, 10000), true);
  assert.equal(transferRecentlyCompleted(receipt, 9999), false);
  assert.equal(transferRecentlyCompleted(receipt, 10000 + transferCompletionWindow), false);
  assert.equal(transferRecentlyCompleted({...receipt, state: 'saving'}, 10000), false);
});

test('file transfer reads pause for server restrictions, resume on recovery, and report actual failures', async () => {
  const calls = [];
  const slots = [];
  let index = 0;
  let effects = [];
  const react = {
    createContext: () => ({}),
    useRef: current => (slots[index++] ??= {current}),
    useState: initial => {
      const slot = index++;
      const cell = (slots[slot] ??= {value: initial});
      return [cell.value, value => (cell.value = value)];
    },
    useEffect: (effect, dependencies) => {
      const cell = (slots[index++] ??= {});
      if (dependencies.some((value, i) => value !== cell.dependencies?.[i])) {
        cell.dependencies = dependencies;
        effects.push(() => {
          cell.cleanup?.();
          cell.cleanup = effect();
        });
      }
    },
  };
  const {useRemoteTransferQueue} = loadModule(
    new URL('../src/features/servers/useRemoteTransfers.ts', import.meta.url),
    {
      react,
      './remoteTransferModel': transferModel,
      '../../lib': {
        api: (path, {signal}) => new Promise((resolve, reject) => calls.push({path, signal, resolve, reject})),
      },
      '../shared/common': {can: (permissions, permission) => permissions.includes(permission)},
      '../../hooks/focusRevalidation': {onFocusRevalidate: () => () => {}},
    },
    {window: new EventTarget()}
  );
  const permissions = ['file.read'];
  const ready = {status: null, is_suspended: false, is_transferring: false, is_node_under_maintenance: false};
  const render = (server = ready) => {
    index = 0;
    const queue = useRemoteTransferQueue(
      '/server',
      permissions,
      () => {},
      transferModel.transferFilesAvailable(server)
    );
    effects.splice(0).forEach(effect => effect());
    return queue;
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    for (const restricted of [{status: 'installing'}, {is_transferring: true}, {is_node_under_maintenance: true}]) {
      const blocked = render({...ready, ...restricted});
      await blocked.reload();
      assert.equal(calls.length, 0);
      assert.equal(blocked.error, '');
    }
    render();
    assert.deepEqual(
      calls.map(call => call.path),
      ['/server/files/pulls', '/server/files/transfer-progress']
    );
    const conflict = Object.assign(new Error('Installation started'), {code: 'ServerStateConflict', status: 409});
    calls.splice(0).forEach(call => call.reject(conflict));
    await settle();
    assert.equal(render().error, '');

    void render().reload();
    const interrupted = calls.splice(0);
    render({...ready, status: 'installing'});
    assert.ok(interrupted.every(call => call.signal.aborted));
    interrupted.forEach(call => call.resolve({transfers: []}));
    render();
    assert.equal(calls.length, 2);
    calls[0].reject(new Error('Node unavailable'));
    calls[1].resolve({transfers: []});
    await settle();
    assert.equal(render().error, 'Node unavailable');
  } finally {
    slots.forEach(slot => slot.cleanup?.());
  }
});

test('a failed transfer keeps its last measured percentage', () => {
  assert.equal(
    transferProgress({...transfer, state: 'failed', size_known: true, total_bytes: 200, received_bytes: 126}),
    63
  );
  assert.equal(transferProgress({...transfer, state: 'failed', size_known: false}), null);
});
