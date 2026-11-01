import test from 'node:test';
import assert from 'node:assert/strict';
import {demoResponse,demoServers,demoCapacityNodes} from '../src/dev/demoData.ts';
const request=(path,method='GET',body)=>demoResponse(new URL(path,'http://localhost:5180'),method,body);

test('Minecraft settings and runtime use coherent fixtures without permitting saves',async()=>{
 for(const server of demoServers.filter(s=>s.game==='minecraft')){
  const base=`/api/client/servers/${server.uuid}`;
  assert.equal(server.internal_id,server.id);
  const settings=(await request(`${base}/game-settings`).json()).attributes;
  assert.ok(settings.fields.length>20);
  assert.equal(settings.fields.find(f=>f.key==='gamemode').value,server.uuid==='demo-creative'?'creative':'survival');
  const java=(await request(`${base}/java`).json()).attributes;
  assert.equal(java.effective.xmx_mib+java.effective.reserved_mib,server.limits.memory);
  const admin=(await request(`/api/application/servers/${server.id}`).json()).attributes;
  assert.equal(admin.allocation,server.allocation.id);
  assert.equal(admin.node,server.node_id);
  assert.equal((await request(`/api/client/servers/${server.id}/configuration`).json()).attributes.template.id,admin.egg);
  for(const path of [`${base}/game-settings`,`${base}/java`,`${base}/startup/variable`,`/api/application/servers/${server.id}/build`,`/api/client/servers/${server.id}/configuration`]){
   assert.equal(request(path,'PUT','{}').status,405);
  }
  assert.deepEqual((await request(`${base}/game-settings`).json()).attributes,settings);
  assert.equal(request(`${base}/game-settings?file=/missing.properties`).status,404);
 }
 assert.equal(request('/api/client/servers/demo-palworld/game-settings').status,404);
 assert.equal(request('/api/client/servers/demo-palworld/java').status,404);
});
test('demo fleet reservations match servers and produce the intended headroom',()=>{
 const nodes=demoCapacityNodes();
 assert.equal(nodes.length,2);assert.equal(demoServers.length,5);
 assert.equal(nodes.reduce((sum,n)=>sum+n.memory-n.allocated_resources.memory,0),52*1024);
 assert.equal(nodes.reduce((sum,n)=>sum+n.disk-n.allocated_resources.disk,0),1236*1024);
 for(const node of nodes)assert.ok(demoServers.some(s=>s.node_id===node.id));
});
test('every demo server resolves to its detail and static resources',async()=>{
 for(const server of demoServers){
  const response=await request(`/api/client/servers/${server.identifier}`).json();
  assert.equal(response.attributes.uuid,server.uuid);
  const resources=await request(`/api/client/servers/${server.identifier}/resources`).json();
  assert.ok(['running','offline'].includes(resources.attributes.current_state));
 }
});
test('unknown APIs and real resource changes fail explicitly',async()=>{
 assert.equal(request('/api/unknown').status,404);
 assert.equal(request('/api/client/servers/real-server').status,404);
 for(const method of ['POST','PUT','PATCH','DELETE']){
  const response=request('/api/client/servers/demo-survival/power',method,'{}');
  assert.equal(response.status,405);
  assert.match((await response.json()).errors[0].detail,/read-only/);
 }
 assert.equal(request('/api/client/servers/demo-survival/websocket').status,503);
});
test('navigation preferences change only the ephemeral fixture',()=>{
 const server=demoServers[0],before=server.favorite;
 try{
  assert.equal(request(`/api/client/servers/${server.uuid}/navigation`,'PUT',JSON.stringify({favorite:!before})).status,200);
  assert.equal(server.favorite,!before);
  assert.equal(request('/api/client/servers/real-server/navigation','PUT','{}').status,404);
 }finally{server.favorite=before}
});
