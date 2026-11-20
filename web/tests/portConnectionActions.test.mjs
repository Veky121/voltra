import test from 'node:test';
import assert from 'node:assert/strict';
import {portConnectionActions, groupPortRoutes, playerAddress} from '../src/features/network/portConnectionActions.ts';
const port = {id: 7, is_default: true};
const setup = {allocations: [{id: 7, forward_client_ids: [2]}], clients: [{id: 1}, {id: 2}]};
const domain = {choices: [{id: 11}]};
test('only admin-approved eligible forwarding connections are offered', () => {
  assert.deepEqual(portConnectionActions(port, setup, domain, true, true).clients, [{id: 2}]);
  assert.equal(portConnectionActions(port, setup, domain, false, true).forward, false);
  assert.equal(portConnectionActions(port, undefined, domain, true, true).forward, false);
  assert.equal(portConnectionActions({id: 8}, setup, domain, true, true).forward, false);
});
test('subdomain requires configured choice, matching port and write permission', () => {
  assert.equal(portConnectionActions(port, setup, domain, false, true).subdomain, true);
  assert.equal(portConnectionActions(port, setup, domain, true, false).subdomain, false);
  assert.equal(portConnectionActions(port, setup, {}, true, true).subdomain, false);
  assert.equal(portConnectionActions({id: 8, is_default: false}, setup, domain, true, true).subdomain, false);
  assert.equal(portConnectionActions(port, undefined, undefined, true, true).subdomain, false);
});

test('same address and destination combine protocols without hiding errors', () => {
  const tcp = {
    id: 1,
    protocol: 'tcp',
    public_host: 'example.test',
    public_port: 25592,
    local_ip: '127.0.0.1',
    local_port: 25592,
    status: 'applied',
    desired_present: true,
  };
  const udp = {...tcp, id: 2, protocol: 'udp'};
  const merged = groupPortRoutes([udp, tcp]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].protocol, 'TCP & UDP');
  assert.equal(merged[0].members.length, 2);
  assert.equal(groupPortRoutes([tcp, {...udp, public_port: 1024}]).length, 2);
  const failed = groupPortRoutes([tcp, {...udp, status: 'error', last_error: 'UDP failed'}])[0];
  assert.equal(failed.status, 'error');
  assert.equal(failed.last_error, 'UDP failed');
});

test('the player address skips pending DNS, failed routes and routes being removed', () => {
  const port = {ip: '::1', port: 25565, protocols: ['tcp'], protocol_source: 'game'};
  const gateway = {public_host: 'example.test', public_port: 1024, status: 'applied', protocol: 'tcp'};
  const dns = {hostname: 'play.example.test', dns_matches: false, route: {public_port: 1024}};
  const shared = {label: 'Player address', value: 'example.test:1024', source: 'public', simulated: false};
  assert.deepEqual(playerAddress(port, [gateway], dns), shared);
  assert.deepEqual(playerAddress(port, [gateway], {...dns, dns_matches: true}), {
    label: 'Player address',
    value: 'play.example.test:1024',
    source: 'subdomain',
    simulated: false,
  });
  assert.deepEqual(playerAddress(port, [{...gateway, protocol: 'udp', public_port: 25565}, gateway], dns), shared);
  assert.deepEqual(playerAddress(port, [gateway], {...dns, dns_matches: true, dns_status: 'error'}), shared);
  assert.deepEqual(playerAddress(port, [gateway], {...dns, dns_matches: true, cleanup_pending: true}), shared);
  assert.deepEqual(playerAddress(port, [{...gateway, status: 'simulated'}], {...dns, dns_status: 'simulated'}), {
    label: 'Test address',
    value: 'play.example.test:1024',
    source: 'subdomain',
    simulated: true,
  });
  assert.deepEqual(playerAddress(port, [{...gateway, status: 'simulated'}], {}), {
    label: 'Test address',
    value: 'example.test:1024',
    source: 'public',
    simulated: true,
  });
  assert.deepEqual(
    playerAddress(
      port,
      [
        {...gateway, desired_present: false},
        {...gateway, status: 'error'},
      ],
      dns
    ),
    {
      label: 'Local address',
      value: '[::1]:25565',
      source: 'local',
      simulated: false,
    }
  );
});
