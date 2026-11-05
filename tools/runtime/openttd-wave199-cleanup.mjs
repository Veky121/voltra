import fs from 'node:fs';import * as c from './campaign-native-20261029.mjs';
const d='artifacts/game-parity-20261029/wave199-openttd-live',s=JSON.parse(fs.readFileSync(d+'/state.json')),f=s.fixture;
await c.verifyRuntime();c.activeLease(s.lease.lease_id,s.lease.owner);
if(!s.export||c.digest(fs.readFileSync(s.export.path))!==s.export.sha256||!s.loaded_seed||!s.native_query||!s.installer_released)throw Error('Native evidence/export incomplete');
const a=(await c.api('/api/application/servers/'+f.server.id)).attributes;
if(a.uuid!==f.server.uuid||a.egg!==f.egg.id||a.node!==1||(await c.observePower(f)).current_state!=='offline'||c.containers().filter(x=>x.Name.includes(a.uuid)).some(x=>x.State.Running))throw Error('Stopped ownership required');
await c.api('/api/application/servers/'+f.server.id,'DELETE');
for(const al of f.allocations){const cur=(await c.api('/api/application/nodes/1/allocations')).data.map(x=>x.attributes).find(x=>x.id===al.id);if(!cur||cur.server_id!==null||cur.port!==al.port||cur.ip!=='127.0.0.1')throw Error('Allocation mismatch');await c.api('/api/application/nodes/1/allocations/'+cur.id,'DELETE');}
await c.api('/api/admin/eggs/'+f.egg.id,'DELETE');await c.api('/api/admin/nests/'+f.nest.id,'DELETE');
const checks={containers:!c.containers().some(x=>x.Name.includes(a.uuid))};
for(const [k,p] of [['server','/api/application/servers/'+f.server.id],['egg','/api/admin/eggs/'+f.egg.id],['nest','/api/admin/nests/'+f.nest.id]])checks[k]=(await fetch('http://127.0.0.1:18099'+p)).status===404;
checks.volume=c.docker(['run','--rm','--pull','never','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029,target=/campaign,readonly','alpine:3.23','sh','-c',`test ! -e /campaign/volumes/${a.uuid} && echo absent`]).trim()==='absent';
fs.writeFileSync(d+'/cleanup.json',JSON.stringify(checks,null,2));if(!Object.values(checks).every(Boolean))throw Error('Cleanup incomplete');
s.lease=c.releaseNative(s.lease.lease_id,s.lease.owner,'tested',true);s.status='TESTED';s.actual_owned_state={lease:null,fixture:null,installer:null};delete s.error;
fs.writeFileSync(d+'/state.json',JSON.stringify(s,null,2));
fs.writeFileSync(d+'/handoff.json',JSON.stringify({status:s.status,runtime:{pid:s.runtime.pid,binary_sha256:s.runtime.binary_sha256},native_checks:{start:true,console_seed:s.seed,supported_setting:s.setting,native_query:s.native_query,save_load_seed:s.loaded_seed,lifecycle:s.actions},export:s.export,cleanup:checks,owned:s.actual_owned_state,fix_required:false,browser_ui:'not exercised; supported settings API exposed and consumed'},null,2));console.log(checks);
