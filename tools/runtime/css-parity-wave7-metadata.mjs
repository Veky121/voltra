import fs from 'node:fs';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';
import {runtime,verifyRuntime,claimNativeUtility,activeLease,docker,acquireInstaller,proveInstaller,releaseInstaller,releaseNative,digest} from './campaign-native-20261029.mjs';
const retry=process.argv.includes('--retry-bootstrap');
const dir=path.join(runtime,'css-metadata-wave7'+(retry?'-retry1':''));fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'state.json'),s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const owner='css_metadata',image='ghcr.io/steamcmd/steamcmd:ubuntu-24@sha256:1aefa09cbcdf75a54c7400f02098340db975536f4972036b166e7265da2b5806',save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n'),phase=process.argv[2]||'claim';
if(phase==='claim'){
 s.runtime=await verifyRuntime();if(s.lease)activeLease(s.lease.lease_id,owner);else {
  let retry_review;
  if(retry){
   const prior=JSON.parse(fs.readFileSync(path.join(runtime,'css-metadata-wave7/state.json')));if(!prior.lease_released||!prior.container_absent)throw Error('Previous utility cleanup required');s.retry_of=prior.lease.lease_id;
   const ids=[prior.proof.id,...(prior.preflight_repairs||[]).map(x=>x.container)];
   for(const id of ids)if(docker(['ps','-aq','--filter','id='+id]).trim())throw Error('Previous owned metadata container remains');
   if(docker(['ps','-aq','--filter','name='+prior.container]).trim())throw Error('Previous owned metadata name remains');
   const cleanup_receipt='artifacts/game-parity-20261029/css-wave7-metadata-cleanup.json';
   fs.writeFileSync(cleanup_receipt,JSON.stringify({at:new Date().toISOString(),game:prior.lease.game,lease_id:prior.lease.lease_id,owner,container_name:prior.container,container_ids:ids,all_containers_absent:true,cache_boundary:'Only private /tmp tmpfs; container removal destroyed this cache. No host/cache-volume mount was created.',persistent_game_resources_created:false,actual_exit:prior.actual_exit,oom_killed:prior.terminal.OOMKilled,slot_released:true,lease_released:true,resources_removed:true},null,2)+'\n');
   retry_review={lease_id:prior.lease.lease_id,game:prior.lease.game,resources_removed:true,reviewer:'battalion_wave4',cleanup_receipt,cleanup_sha256:digest(fs.readFileSync(cleanup_receipt))};
  }
  s.lease=claimNativeUtility({owner,task:'css_appinfo_232330',memory_mib:512,disk_mib:1024,ports:0,...(retry_review?{retry_review}:{})});
 }save();console.log(JSON.stringify(s.lease));
}else if(phase==='run'){
 activeLease(s.lease.lease_id,owner);await verifyRuntime();
 if(s.container&&!s.released_at){
  const old=JSON.parse(docker(['inspect',s.container]))[0];if(old.Config.Labels?.['voltra.css-metadata-lease']!==s.lease.lease_id)throw Error('Foreign preflight container');
  const logs=docker(['logs',s.container]);if(logs.trim()!=='CSS_METADATA_GATE')throw Error('A query may have started; observe instead');
  if(old.State.Running)docker(['stop','--time','1',s.container]);const terminal=JSON.parse(docker(['inspect',s.container]))[0].State;
  s.preflight_repairs??=[];s.preflight_repairs.push({reason:'CLI --cpus used NanoCpus; strict shared proof requires explicit CFS fields. No query released.',container:old.Id,memory:old.HostConfig.Memory,nanocpus:old.HostConfig.NanoCpus,terminal,logs});save();docker(['rm','--volumes',s.container]);s.container=null;s.created=false;save();
 }
 if(s.container)throw Error('Observe existing metadata query');
 if(!s.slot)s.slot=acquireInstaller(s.lease.lease_id,owner);else if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).installer_slot?.token!==s.slot.token)throw Error('Lost owned metadata slot');
 s.container='voltra-css-metadata-installer-'+s.lease.lease_id;save();
 docker(['image','inspect',image]);
 const script="set -eu\necho CSS_METADATA_GATE\nn=0\nwhile test ! -f /tmp/css-metadata-release; do n=$((n+1)); test \"$n\" -lt 200; sleep 1; done\nexec /usr/bin/timeout --signal=TERM --kill-after=10s 180s /usr/games/steamcmd +@ShutdownOnFailedCommand 1 +@NoPromptForPassword 1 +@sSteamCmdForcePlatformType linux +login anonymous +app_info_update 1 +app_info_print 232330 +app_info_print 240 +quit\n";
 docker(['create','--name',s.container,'--label','voltra.css-metadata-lease='+s.lease.lease_id,'--pull','never','--read-only','--network','voltra-parity-20261029','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--memory-swap','512m','--cpu-period','100000','--cpu-quota','100000','--pids-limit','128','--tmpfs','/tmp:rw,exec,nosuid,size=512m','--env','HOME=/tmp','--user','1000:1000','--workdir','/tmp','--entrypoint','/bin/sh',image,'-c',script]);s.created=true;save();docker(['start',s.container]);
 const container=JSON.parse(docker(['inspect',s.container]))[0];s.proof={...proveInstaller(container,s.lease),cgroups:docker(['exec',s.container,'cat','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.swap.max','/sys/fs/cgroup/cpu.max'])};save();
 // This pinned Debian package wrapper builds its complete linux32 runtime
 // under HOME. Calling the lower-level steamcmd.sh directly omits that step.
 docker(['exec',s.container,'test','-r','/usr/games/steamcmd']);docker(['exec',s.container,'test','-r','/usr/lib/games/steam/steamcmd']);s.steamcmd_source='/usr/games/steamcmd';save();
 const log=path.join(dir,'metadata.log'),wait=path.join(dir,'metadata.exit'),lf=fs.openSync(log,'a'),wf=fs.openSync(wait,'a');
 const logger=spawn('docker',['--context','desktop-linux','logs','--follow',s.container],{windowsHide:true,detached:true,stdio:['ignore',lf,lf]}),watch=spawn('docker',['--context','desktop-linux','wait',s.container],{windowsHide:true,detached:true,stdio:['ignore',wf,wf]});logger.unref();watch.unref();fs.closeSync(lf);fs.closeSync(wf);s.capture={log,wait,attached_before_release:true};save();
 for(let n=0;n<20&&!fs.readFileSync(log,'utf8').includes('CSS_METADATA_GATE');n++)await new Promise(r=>setTimeout(r,100));if(!fs.readFileSync(log,'utf8').includes('CSS_METADATA_GATE'))throw Error('Metadata log capture missing');
 proveInstaller(JSON.parse(docker(['inspect',s.container]))[0],s.lease);docker(['exec',s.container,'touch','/tmp/css-metadata-release']);s.released_at=new Date().toISOString();save();console.log(JSON.stringify({metadata_only:true,proof:s.proof,source:s.steamcmd_source}));
}else if(phase==='finish'||phase==='abort'){
 activeLease(s.lease.lease_id,owner);let c=JSON.parse(docker(['inspect',s.container]))[0];if(c.Config.Labels?.['voltra.css-metadata-lease']!==s.lease.lease_id)throw Error('Foreign metadata container');if(c.State.Running&&phase==='abort'){docker(['stop','--time','10',s.container]);c=JSON.parse(docker(['inspect',s.container]))[0];s.aborted=true;}if(c.State.Running)throw Error('Metadata utility still running');
 s.terminal=c.State;s.actual_exit=c.State.ExitCode;s.no_app_update=true;save();
 docker(['rm','--volumes',s.container]);if(docker(['ps','-aq','--filter','name='+s.container]).trim())throw Error('Owned metadata container remains');
 s.container_absent=true;releaseInstaller(s.slot);s.slot_released=true;save();
 const log=s.capture?.log?fs.readFileSync(s.capture.log,'utf8'):'';s.exact_app_section=/"232330"\s*\r?\n\{/.test(log);s.anonymous_connected=/Connecting anonymously to Steam Public[^\n]*OK/s.test(log);
 releaseNative(s.lease.lease_id,owner,!s.aborted&&s.actual_exit===0&&s.exact_app_section?'tested':'blocked',true);s.lease_released=true;save();
 fs.writeFileSync('artifacts/game-parity-20261029/css-wave7-metadata'+(retry?'-retry1':'')+'-utility.json',JSON.stringify({at:new Date().toISOString(),lease:s.lease,retry_of:s.retry_of,proof:s.proof,actual_exit:s.actual_exit,oom_killed:s.terminal.OOMKilled,status:s.terminal.Status,error:s.terminal.Error,aborted:!!s.aborted,exact_app_section:s.exact_app_section,anonymous_connected:s.anonymous_connected,no_app_update:true,game_content_acquired:false,installation_entitlement_verified:false,failure_boundary:s.actual_exit===0?'App metadata only; acquisition entitlement still unverified':'Bootstrap/metadata utility failure; not an app entitlement result',rootfs_readonly:true,host_mounts:0,container_absent:true,slot_released:true,lease_released:true,log:s.capture?.log,preflight_repairs:s.preflight_repairs},null,2)+'\n');console.log(JSON.stringify({exit:s.actual_exit,oom:s.terminal.OOMKilled,exact_app:s.exact_app_section,cleaned:true}));
}else throw Error('Use claim|run|finish');
