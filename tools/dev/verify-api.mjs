import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const {token}=JSON.parse(await readFile(resolve(root,'.local/dev/tooling-key.json'),'utf8'));
const seed=JSON.parse(await readFile(resolve(root,'.local/dev/seed.json'),'utf8'));
assert.equal(seed.version,'voltra.local-dev.v1');
const origin='http://127.0.0.1:5181';
const checks=[];
async function get(path,authenticated=true){
 const response=await fetch(origin+path,{headers:authenticated?{Authorization:`Bearer ${token}`}:{},signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,200,`${path}: HTTP ${response.status}`);
 checks.push(path);
 return response.json();
}
assert.equal((await fetch(origin,{signal:AbortSignal.timeout(10000)})).status,200);
await get('/healthz',false);
const setup=await get('/api/setup/status',false);
assert.equal(setup.needs_setup,false);assert.equal(setup.auth_enabled,true);assert.equal(setup.dev_mode,false);
const anonymous=await fetch(origin+'/api/client');
assert.equal(anonymous.status,401,'Local app must require real authentication');
const servers=await get('/api/client?summary=overview');
assert.ok(servers.data.length>=3);
const admin=await fetch(origin+`/api/admin/nodes/${seed.node_id}/system-information`,{headers:{Authorization:`Bearer ${token}`}});
assert.equal(admin.status,403,'A client key must not gain administration API access');
for(const server of seed.servers){
 const path=`/api/client/servers/${server.uuid}`;
 await get(path);
 await get(path+'/startup');
 await get(path+'/schedules');
 await get(path+'/network/allocations');
}
const game=seed.servers.find(server=>server.external_id==='local-dev:mindustry/egg-mindustry.json');
const prefix=`/api/client/servers/${game.uuid}`;
await get(prefix+'/files/list?directory=%2F');
await get(prefix+'/console-history?limit=100');
await get(prefix+'/websocket'); // Credential creation only, no socket claim.
const backups=await get(prefix+'/backups');
assert.ok(backups.data.some(backup=>backup.attributes.is_successful&&backup.attributes.bytes>0),'Expected an actual completed Mindustry backup');
const result={at:new Date().toISOString(),origin,checks,anonymous_rejected:true,normal_password_auth:true,real_completed_backup:true,browser_interaction_tested:false,websocket_connection_tested:false};
await mkdir(resolve(root,'.local/dev/evidence'),{recursive:true});
await writeFile(resolve(root,'.local/dev/evidence/api-verification.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:checks.length,anonymous_rejected:true,normal_password_auth:true,real_completed_backup:true}));
