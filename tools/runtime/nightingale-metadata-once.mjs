import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
const dir='.local/nightingale-metadata',file=dir+'/private.json';
fs.mkdirSync(dir,{recursive:true});if(fs.existsSync(file))throw Error('Existing Nightingale utility attempt; observe only');
const node=JSON.parse(fs.readFileSync('.local/batch-node/private.json'));
if(!/^\/var\/lib\/voltra-batch-[0-9]+$/.test(node.root)||node.volume_root!==node.root+'/volumes')throw Error('Protected node root mismatch');
const response=await fetch('http://127.0.0.1:8088/api/admin/nodes/'+node.node);if(!response.ok)throw Error('Node unavailable');
const registered=(await response.json()).attributes;if(registered.uuid!==node.node_uuid||registered.daemon_base!==node.volume_root||registered.maintenance_mode)throw Error('Registered node mismatch');
const lease=JSON.parse(execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','claim-utility',JSON.stringify({owner:'game_batch_inventory',task:'nightingale-metadata',memory_mib:512,disk_mib:1024,ports:0,limits:{memory_mib:20480,disk_mib:131072,reserved_disk_mib:20480,max_active:7,port_min:28000,port_max:28999}})],{windowsHide:true,encoding:'utf8'}));
const name='voltra-nightingale-metadata-'+lease.lease_id;
const state={lease_id:lease.lease_id,node:node.node,node_uuid:node.node_uuid,container:name,memory_mib:512,disk_mib:1024,tmpfs_mib:512,ports:[],phase:'leased',game_content_acquired:false};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});save();
const image='ghcr.io/steamcmd/steamcmd:ubuntu-24@sha256:1aefa09cbcdf75a54c7400f02098340db975536f4972036b166e7265da2b5806';
const docker=args=>{const out=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',timeout:220000,maxBuffer:12e6});if(out.status!==0)throw Error('Metadata Docker command failed: '+(out.stderr??'').slice(-1000));return out.stdout;};
let failure;
try{
 docker(['image','inspect',image]);
 const host=JSON.parse(docker(['inspect',node.container]))[0];
 if(!host.State.Running||host.Config.Labels?.['voltra.owner']!=='batch-20261023'||!host.Mounts.some(m=>m.Source===node.root&&m.Destination===node.root))throw Error('Owned node container mismatch');
 state.phase='anonymous-app-info-running';save();
 const result=spawnSync('docker',['run','--name',name,'--label','voltra.metadata-owner='+lease.lease_id,'--pull','never','--init','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,exec,nosuid,size=512m','--env','HOME=/tmp','--user','1000:1000','--workdir','/tmp','--entrypoint','/usr/bin/timeout',image,'--signal=TERM','--kill-after=15s','180s','/usr/bin/steamcmd','+@ShutdownOnFailedCommand','1','+@NoPromptForPassword','1','+@sSteamCmdForcePlatformType','linux','+login','anonymous','+app_info_update','1','+app_info_print','3796810','+quit'],{windowsHide:true,encoding:'utf8',timeout:215000,maxBuffer:12e6});
 fs.writeFileSync(dir+'/metadata.log',(result.stdout??'')+(result.stderr??''),{flag:'wx'});
 state.raw_exit=result.status;state.signal=result.signal;state.error=result.error?.message??null;save();
 if(result.status!==0)throw Error('Nightingale metadata utility failed; first raw result retained');
 const parsed=spawnSync('wsl.exe',['-u','root','-e','python3','-B','tools/runtime/nightingale-metadata-review.py'],{windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:2e6});
 fs.writeFileSync(dir+'/parser.log',(parsed.stdout??'')+(parsed.stderr??''));if(parsed.status!==0)throw Error('Metadata parser failed; raw output retained');
 state.phase='metadata-complete';save();
}catch(error){failure=error;state.phase='failed';state.failure=error.message;save();}
finally{
 const inspected=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});
 if(inspected.status===0){const info=JSON.parse(inspected.stdout)[0];if(info.Config.Labels?.['voltra.metadata-owner']!==lease.lease_id)throw Error('Foreign utility container');state.terminal=info.State;if(info.State.Running)docker(['stop','--timeout','10',name]);docker(['rm',name]);}
 else if(!inspected.stderr.includes('No such'))throw Error('Utility absence unproven');
 const absent=spawnSync('docker',['inspect',name],{windowsHide:true,encoding:'utf8'});if(absent.status===0||!absent.stderr.includes('No such'))throw Error('Owned utility removal unproven');
 state.container_absent=true;state.completed_at=new Date().toISOString();
 const released=JSON.parse(execFileSync(process.execPath,['tools/runtime/batch-queue.mjs','release',JSON.stringify({owner:'game_batch_inventory',lease_id:lease.lease_id,outcome:failure?'blocked':'tested',resources_removed:true})],{windowsHide:true,encoding:'utf8'}));
 state.lease_status=released.status;save();fs.writeFileSync(dir+'/cleanup.json',JSON.stringify(state,null,2)+'\n');
}
if(failure)throw failure;
console.log({metadata_only:true,raw_exit:state.raw_exit,container_absent:true,lease_status:state.lease_status,assessment:dir+'/assessment.json'});
