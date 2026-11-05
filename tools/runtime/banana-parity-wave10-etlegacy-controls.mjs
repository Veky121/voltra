import fs from 'node:fs';
import path from 'node:path';
import {runtime,api,digest,verifyRuntime,profileFromRuntime,activeLease,observePower} from './campaign-native-20261029.mjs';
const file=path.join(runtime,'banana-wave10-etlegacy/state.json'),s=JSON.parse(fs.readFileSync(file)),phase=process.argv[2];
if(!['enable','restore'].includes(phase))throw Error('Explicit optional-control phase required');
const receipt=await verifyRuntime(),profile=profileFromRuntime('wolfenstein_enemy_territory/etlegacy/egg-e-t-legacy.json',receipt);
activeLease(s.lease.lease_id,'etlegacy_native_banana');if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).activation_pause)throw Error('Activation paused');if((await observePower(s.fixture)).current_state!=='offline')throw Error('Stop before Runtime control edits');
const server=(await api('/api/application/servers/'+s.fixture.server.id)).attributes;
if(server.uuid!==s.fixture.server.uuid||server.container.startup_command!==profile.egg.startup||server.limits.memory!==1024||server.limits.disk!==4096)throw Error('Original bounded canonical server required');
const current=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,server.container.environment[v.env_variable]]));
if(phase==='enable'){if(s.optional_controls)throw Error('Existing Runtime control test retained');s.optional_controls={at:new Date().toISOString(),original_environment:current,original_environment_sha256:digest(JSON.stringify(current)),changes:{MAP:'goldrush',OMNIBOT:'1'}};fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');}
if(!s.optional_controls)throw Error('Original Runtime values missing');
const wanted=phase==='enable'?{...s.optional_controls.original_environment,...s.optional_controls.changes}:s.optional_controls.original_environment;
await api('/api/application/servers/'+s.fixture.server.id+'/startup','PATCH',{startup:profile.egg.startup,environment:wanted,skip_scripts:false});
const after=(await api('/api/application/servers/'+s.fixture.server.id)).attributes,actual=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,after.container.environment[v.env_variable]]));
if(digest(JSON.stringify(actual))!==digest(JSON.stringify(wanted)))throw Error('Runtime controls did not roundtrip exactly');
s.optional_controls[phase]={at:new Date().toISOString(),environment_sha256:digest(JSON.stringify(actual)),all_eight_records_preserved:true};fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');console.log(JSON.stringify({phase,changed:phase==='enable'?s.optional_controls.changes:'original eight values restored',sha256:digest(JSON.stringify(actual))}));
