import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameNodeAvailable, gamePortAddress, gamePortLabel, refreshInstallationForwarding, unknownInstallationForwarding, gamePortSummary} from '../src/client/gamePortsModel.ts';

test('cached or failed forwarding checks cannot retain a current mapped claim', () => {
  const plan={ip:'0.0.0.0',ports:[{role:'game',port:8211,preferred_port:8211}],detail:'Assigned',forwarding:{status:'mapped',detail:'Configured',routes:[{internal_port:8211,public_port:18211,public_host:'game.example',protocol:'udp',status:'mapped',detail:'Configured'}]}};
  const unknown=unknownInstallationForwarding(plan);
  assert.equal(unknown.forwarding.status,'unknown');
  assert.equal(unknown.forwarding.routes[0].status,'unknown');
  assert.equal(unknown.forwarding.routes[0].public_host,'game.example');
  assert.equal(plan.forwarding.status,'mapped');
  assert.match(gamePortSummary(unknown),/Forwarding availability is unknown/);
  assert.doesNotMatch(gamePortSummary(unknown),/forwarding is configured/);
  const recovered=refreshInstallationForwarding(unknown,[{local_port:8211,public_port:18211,public_host:'game.example',protocol:'udp',status:'applied'}]);
  assert.equal(recovered.forwarding.status,'mapped');
  assert.equal(refreshInstallationForwarding(unknown,[]).forwarding.status,'manual');
  assert.equal(refreshInstallationForwarding({...unknown,forwarding:{...unknown.forwarding,routes:[]}},[]).forwarding.status,'manual');
});

test('manual forwarding and allocated game ports survive an unavailable status check', () => {
  const plan={ip:'127.0.0.1',ports:[{role:'game',port:8211,preferred_port:8211}],detail:'Assigned',forwarding:{status:'manual',detail:'Manual setup',routes:[]}};
  assert.equal(unknownInstallationForwarding(plan),plan);
  const without={ip:'127.0.0.1',ports:plan.ports,detail:'Assigned'};
  assert.equal(unknownInstallationForwarding(without),without);
});

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
  assert.match(gamePortSummary(base),/availability is unknown/);
  assert.match(gamePortSummary({...base,forwarding:{status:'manual',detail:''}}),/Internet access needs/);
  assert.match(gamePortSummary({...base,forwarding:{status:'mapped',detail:''}}),/forwarding is configured/);
});

 test('bind uncertainty survives every forwarding status and never infers a version', async () => {
  const {gamePortSummary}=await import('../src/client/gamePortsModel.ts');
  for (const status of ['mapped','pending','manual','partial','unknown']) {
    const summary=gamePortSummary({ip:'0.0.0.0',ports:[{port:27015,preferred_port:27015,role:'QUERY_PORT'}],detail:'Node bind checks unavailable',forwarding:{status,detail:''}});
    assert.match(summary,/availability is unknown/);
    assert.match(summary,/network-v1/);
    assert.doesNotMatch(summary,/needs an update|available ones/);
  }
  assert.match(gamePortSummary({ip:'0.0.0.0',ports:[],detail:'Assigned'}),/Forwarding availability is unknown/);
});
