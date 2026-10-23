import fs from'node:fs';import{spawnSync,execFileSync}from'node:child_process';import{api}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/enshrouded',s=JSON.parse(fs.readFileSync(dir+'/private.json')),mode=process.argv[2];
if(!['stage','native'].includes(mode))throw Error('stage|native');const memory=mode==='stage'?1024:12288;
const server=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(server.uuid!==s.uuid||server.node!==202||server.status!==null)throw Error('Owned installed server mismatch');
for(const name of [s.uuid,s.uuid+'_installer']){
 const inspect=spawnSync('docker',['inspect',name],{encoding:'utf8'});
 if(inspect.status===0&&JSON.parse(inspect.stdout)[0].State.Running)throw Error('Stop native/installer before resizing');
 if(inspect.status!==0&&!inspect.stderr.includes('No such'))throw Error('Cannot establish stopped state');
}
if((await api('/api/client/servers/'+s.identifier+'/resources')).attributes.current_state!=='offline')throw Error('Native server not offline');
const request={lease_id:s.lease_id,owner:'game_batch_inventory',memory_mib:memory,stopped_confirmed:true,limits:{memory_mib:20480}};
const lease=()=>execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','resize',JSON.stringify(request)],{encoding:'utf8'});
if(mode==='native')lease();
await api('/api/application/servers/'+s.internal_id+'/build','PATCH',{memory});
const after=(await api('/api/application/servers/'+s.internal_id)).attributes;if(after.limits.memory!==memory)throw Error('Panel memory update not confirmed');
if(mode==='stage')lease();
fs.writeFileSync(dir+'/memory-state.json',JSON.stringify({uuid:s.uuid,memory_mib:memory,native_boot_permitted:mode==='native',updated_at:new Date().toISOString()},null,2));
console.log({mode,memory_mib:memory,native_boot_permitted:mode==='native',disk_ports_retained:true});
