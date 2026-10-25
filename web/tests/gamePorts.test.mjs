import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameNodeAvailable, gamePortAddress, gamePortLabel} from '../src/client/gamePortsModel.ts';

test('automatic allocation allows empty pools without enabling unavailable nodes', () => {
  assert.equal(gameNodeAvailable({automatic_ports:true,free_allocations:0}),true);
  assert.equal(gameNodeAvailable({automatic_ports:true,free_allocations:0,setup_available:false}),false);
  assert.equal(gameNodeAvailable({free_allocations:0}),false);
  assert.equal(gameNodeAvailable({free_allocations:1}),true);
});

test('ports show bind wildcards as port numbers and bracket IPv6 addresses', () => {
  assert.equal(gamePortAddress('0.0.0.0',25565),'25565');
  assert.equal(gamePortAddress('::',25565),'25565');
  assert.equal(gamePortAddress('2001:db8::1',25565),'[2001:db8::1]:25565');
  assert.equal(gamePortLabel('game'),'Game');
  assert.equal(gamePortLabel('QUERY_PORT'),'QUERY PORT');
});

test('port summaries distinguish forwarding setup from an applied route', async () => {
  const {gamePortSummary}=await import('../src/client/gamePortsModel.ts');
  const base={ip:'0.0.0.0',ports:[],detail:'Node bind checks unavailable'};
  assert.match(gamePortSummary(base),/node needs an update/);
  assert.match(gamePortSummary({...base,forwarding:{status:'manual',detail:''}}),/Internet access needs/);
  assert.match(gamePortSummary({...base,forwarding:{status:'mapped',detail:''}}),/forwarding is configured/);
});
