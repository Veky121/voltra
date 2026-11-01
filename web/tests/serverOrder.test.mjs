import test from 'node:test';
import assert from 'node:assert/strict';
import {compareServers} from '../src/client/serverOrder.ts';
test('servers group by status before sorting names naturally',()=>{
 const servers=[
  {name:'Alpha offline',liveState:'offline'},
  {name:'Zulu starting',liveState:'starting'},
  {name:'Server 10',liveState:'running'},
  {name:'Server 2',liveState:'running'},
  {name:'Alpha unknown',liveState:'unknown'},
  {name:'beta online',liveState:'running'},
 ];
 assert.deepEqual(servers.sort(compareServers).map(s=>s.name),['beta online','Server 2','Server 10','Zulu starting','Alpha offline','Alpha unknown']);
 assert.equal(compareServers({name:'Same',liveState:'offline'},{name:'same',liveState:'stopped'}),0);
 assert.ok(compareServers({name:'New state',liveState:'unrecognized'},{name:'Offline',liveState:'offline'})>0);
});
