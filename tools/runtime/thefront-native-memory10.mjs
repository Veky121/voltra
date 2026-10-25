import fs from 'node:fs';import {execFileSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';import {api} from './openttd-compat-node.mjs';
const dir='.local/thefront-native',{receipt:s}=await ownedStoppedServer(dir+'/private.json'),before=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(s.owner!=='unreal_survival'||before.egg!==s.egg_id||before.external_id!=='thefront-native-'+s.request_id||before.limits.memory!==8192||before.container.startup_command!==JSON.parse(fs.readFileSync(dir+'/source-profile-current.json')).egg.startup)throw Error('Not stopped canonical8GiB owned fixture');
if(JSON.parse(fs.readFileSync(dir+'/crash-policy-false.json')).crash_detection_enabled!==false)throw Error('Require read-only crash retry false proof');
const resize=memory=>JSON.parse(execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','resize',JSON.stringify({lease_id:s.lease_id,owner:s.owner,memory_mib:memory,stopped_confirmed:true,limits:{memory_mib:20480}})],{windowsHide:true,encoding:'utf8'}));
const lease=resize(10240);fs.writeFileSync(dir+'/memory10-admission.json',JSON.stringify({uuid:s.uuid,lease,memory_mib:10240,global_limit_mib:20480,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
try{await api('/api/application/servers/'+s.internal_id+'/build','PATCH',{memory:10240});const actual=(await api('/api/application/servers/'+s.internal_id)).attributes;if(actual.limits.memory!==10240)throw Error('Panel memory not confirmed');}
catch(error){
 const current=(await api('/api/application/servers/'+s.internal_id)).attributes;
 if(current.limits.memory!==8192){await api('/api/application/servers/'+s.internal_id+'/build','PATCH',{memory:8192});if((await api('/api/application/servers/'+s.internal_id)).attributes.limits.memory!==8192)throw Error('Rollback unresolved;10240reservation retained,no start');}
 resize(8192);throw error;
}
s.lease_memory_mib=10240;fs.writeFileSync(dir+'/private.json',JSON.stringify(s,null,2)+'\n',{mode:0o600});
await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{SRV_SAVETIME:'150',SRV_PW:'',SRV_TAGS:'',SRV_ADMIN:'',AUTO_UPDATE:'0'}});
s.intentional_password_clear=true;s.test_save_interval='150';fs.writeFileSync(dir+'/private.json',JSON.stringify(s,null,2)+'\n',{mode:0o600});console.log({uuid:s.uuid,server:s.internal_id,node:s.node,memory_mib:10240,disk_mib:32768,ports:s.ports,normal_pool_limit_mib:20480,canonical_startup:true,password_clear:true,save_interval:150});
