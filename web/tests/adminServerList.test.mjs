import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  serverListPath,
  serverListRange,
  serverNodeName,
  serverOwnerName,
  serverState,
  shownServerList,
} from '../src/features/admin/servers/serverListModel.ts';

test('the admin server list asks the panel for one page with names included', () => {
  const path = new URL(serverListPath({page: 3, search: '  minecraft '}), 'http://panel.test');
  assert.equal(path.pathname, '/api/application/servers');
  assert.equal(path.searchParams.get('page'), '3');
  assert.equal(path.searchParams.get('per_page'), '25');
  assert.equal(path.searchParams.get('include'), 'user,node');
  assert.equal(path.searchParams.get('filter[search]'), 'minecraft');
  const first = new URL(serverListPath({page: 0, search: ''}), 'http://panel.test');
  assert.equal(first.searchParams.get('page'), '1');
  assert.equal(first.searchParams.has('filter[search]'), false);
});

test('server state uses plain words for the saved state', () => {
  assert.deepEqual(serverState({status: null, suspended: false, container: {installed: 1}}), {
    label: 'Ready',
    tone: 'ready',
  });
  assert.equal(serverState({status: 'suspended', suspended: true}).label, 'Suspended');
  assert.equal(serverState({status: 'installing'}).label, 'Installing');
  assert.deepEqual(serverState({status: 'install_failed'}), {label: 'Install failed', tone: 'problem'});
  assert.equal(serverState({status: 'restoring_backup'}).label, 'Restoring backup');
  assert.equal(serverState({status: null, container: {installed: 0}}).label, 'Not installed');
});

test('node and owner names come from the included records, never an email', () => {
  const server = {
    node: 4,
    user: 9,
    relationships: {
      node: {attributes: {name: ' Frankfurt 1 '}},
      user: {attributes: {nickname: '', username: 'veky', email: 'private@example.test'}},
    },
  };
  assert.equal(serverNodeName(server), 'Frankfurt 1');
  assert.equal(serverOwnerName(server), 'veky');
  assert.equal(
    serverOwnerName({user: 9, relationships: {user: {attributes: {username: 'someone@example.test'}}}}),
    'User'
  );
  // An API key without the users scope gets a null relationship.
  assert.equal(serverOwnerName({user: 9, relationships: {user: {object: 'null', attributes: null}}}), 'User 9');
  assert.equal(serverNodeName({node: 2}), 'Node 2');
});

test('the range line reads from the panel pagination', () => {
  assert.deepEqual(serverListRange({total: 60, count: 25, per_page: 25, current_page: 2, total_pages: 3}), {
    page: 2,
    pages: 3,
    total: 60,
    from: 26,
    to: 50,
  });
  assert.deepEqual(serverListRange({total: 0, count: 0, per_page: 25, current_page: 1, total_pages: 1}), {
    page: 1,
    pages: 1,
    total: 0,
    from: 0,
    to: 0,
  });
  assert.deepEqual(serverListRange(undefined), {page: 1, pages: 1, total: 0, from: 0, to: 0});
});

test('a failed page or search shows no rows from the previous query', () => {
  const previous = {data: ['old page']};
  const next = {data: ['new page']};
  assert.equal(shownServerList(next, previous, false), next);
  assert.equal(shownServerList(null, previous, true), previous, 'kept while the next page loads');
  assert.equal(shownServerList(null, previous, false), null, 'dropped once the request has failed or been refused');
  assert.equal(shownServerList(undefined, null, false), null);
});

test('a failed reinstall shows as a failure, not Ready', () => {
  assert.deepEqual(serverState({status: 'reinstall_failed', container: {installed: 1}}), {
    label: 'Reinstall failed',
    tone: 'problem',
  });
});
