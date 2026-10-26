import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameNodeAvailable, gamePortAddress, gamePortLabel, refreshInstallationForwarding} from '../src/client/gamePortsModel.ts';

test('installation notice replaces stale proxy errors with current per-server routes',()=>{
  const plan={ip:'0.0.0.0',ports:[{role:'game',port:8211,preferred_port:8211}],detail:'Assigned',forwarding:{status:'pending',detail:'Old error',routes:[{internal_port:8211,protocol:'udp',status:'pending',detail:'Old error'}]}};
  const route={local_port:8211,public_port:18211,public_host:'game.example',protocol:'udp',status:'applied'};
  const refreshed=refreshInstallationForwarding(plan,[route,{...route,local_port:25565}]);
  assert.equal(refreshed.forwarding.status,'mapped');assert.equal(refreshed.forwarding.routes.length,1);assert.equal(refreshed.forwarding.routes[0].public_port,18211);
  assert.equal(plan.forwarding.status,'pending');
  assert.equal(refreshInstallationForwarding(refreshed,[{...route,status:'error'}]).forwarding.status,'pending');
  assert.equal(refreshInstallationForwarding(refreshed,[]).forwarding.status,'manual');
});

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
