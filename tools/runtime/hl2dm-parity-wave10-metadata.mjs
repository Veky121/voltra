import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runtime,verifyRuntime,claimNativeUtility,activeLease,docker,acquireInstaller,proveInstaller,releaseInstaller,releaseNative} from './campaign-native-20261029.mjs';
const owner='hl2dm_metadata',task='hl2dm_appinfo_232370';
const image='ghcr.io/steamcmd/steamcmd:ubuntu-24@sha256:1aefa09cbcdf75a54c7400f02098340db975536f4972036b166e7265da2b5806';
const dir=path.join(runtime,'hl2dm-metadata-wave10'),file=path.join(dir,'state.json'),phase=process.argv[2]||'claim';
fs.mkdirSync(dir,{recursive:true});
const s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2)+'\n');
if(phase==='claim'){
 s.runtime=await verifyRuntime();
 if(s.lease){if(s.lease_released)throw Error('Reviewed retry required for a completed utility');activeLease(s.lease.lease_id,owner);}
 else s.lease=claimNativeUtility({owner,task,memory_mib:1024,disk_mib:1024,ports:0});
 save();console.log(JSON.stringify(s.lease));
}else if(phase==='run'){
 activeLease(s.lease.lease_id,owner);s.query_runtime=await verifyRuntime();save();
 if(s.container)throw Error('Observe existing owned utility; do not recreate');
 docker(['image','inspect',image]);s.slot=acquireInstaller(s.lease.lease_id,owner);save();
 s.container='voltra-hl2dm-metadata-installer-'+s.lease.lease_id;save();
 const script='set -eu\necho HL2DM_METADATA_GATE\nn=0\nwhile test ! -f /tmp/hl2dm-metadata-release; do n=$((n+1)); test "$n" -lt 200; sleep 1; done\nexec /usr/bin/timeout --signal=TERM --kill-after=10s 180s /usr/games/steamcmd +@ShutdownOnFailedCommand 1 +@NoPromptForPassword 1 +@sSteamCmdForcePlatformType linux +login anonymous +app_info_update 1 +app_info_print 232370 +app_info_print 320 +quit\n';
 docker(['create','--name',s.container,'--label','voltra.hl2dm-metadata-lease='+s.lease.lease_id,'--pull','never','--read-only','--network','voltra-parity-20261029','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1024m','--memory-swap','1024m','--cpu-period','100000','--cpu-quota','100000','--pids-limit','128','--tmpfs','/tmp:rw,exec,nosuid,size=512m','--env','HOME=/tmp','--user','1000:1000','--workdir','/tmp','--entrypoint','/bin/sh',image,'-c',script]);
 s.created=true;save();docker(['start',s.container]);
 const c=JSON.parse(docker(['inspect',s.container]))[0];
 s.proof={...proveInstaller(c,s.lease),cgroups:docker(['exec',s.container,'cat','/sys/fs/cgroup/memory.max','/sys/fs/cgroup/memory.swap.max','/sys/fs/cgroup/cpu.max']),rootfs_readonly:c.HostConfig.ReadonlyRootfs,host_mounts:c.Mounts.filter(m=>m.Type==='bind'||m.Type==='volume').length,pids:c.HostConfig.PidsLimit,image:c.Image};save();
 docker(['exec',s.container,'test','-r','/usr/games/steamcmd']);docker(['exec',s.container,'test','-r','/usr/lib/games/steam/steamcmd']);
 const log=path.join(dir,'metadata.log'),wait=path.join(dir,'metadata.exit'),lf=fs.openSync(log,'a'),wf=fs.openSync(wait,'a');
 for(const [verb,fd]of [['logs',lf],['wait',wf]]){const child=spawn('docker',['--context','desktop-linux',verb,...(verb==='logs'?['--follow']:[]),s.container],{windowsHide:true,detached:true,stdio:['ignore',fd,fd]});child.unref();}
 fs.closeSync(lf);fs.closeSync(wf);s.capture={log,wait,attached_before_release:true};save();
 for(let i=0;i<20&&!fs.readFileSync(log,'utf8').includes('HL2DM_METADATA_GATE');i++)await new Promise(r=>setTimeout(r,100));
 if(!fs.readFileSync(log,'utf8').includes('HL2DM_METADATA_GATE'))throw Error('Metadata observer missing');
 proveInstaller(JSON.parse(docker(['inspect',s.container]))[0],s.lease);docker(['exec',s.container,'touch','/tmp/hl2dm-metadata-release']);s.released_at=new Date().toISOString();save();
 console.log(JSON.stringify({apps:[232370,320],metadata_only:true,no_app_update:true,proof:s.proof}));
}else if(phase==='finish'||phase==='abort'){
 activeLease(s.lease.lease_id,owner);let c=JSON.parse(docker(['inspect',s.container]))[0];
 if(c.Config.Labels?.['voltra.hl2dm-metadata-lease']!==s.lease.lease_id)throw Error('Foreign metadata utility');
 if(c.State.Running&&phase==='abort'){docker(['stop','--time','10',s.container]);c=JSON.parse(docker(['inspect',s.container]))[0];s.aborted=true;}
 if(c.State.Running)throw Error('Metadata utility still running; observe without another query');
 s.terminal=c.State;s.actual_exit=c.State.ExitCode;s.raw_wait=fs.readFileSync(s.capture.wait,'utf8').trim();save();
 const raw=fs.readFileSync(s.capture.log,'utf8');s.app_sections=Object.fromEntries(['232370','320'].map(id=>[id,new RegExp('"'+id+'"\\s*\\r?\\n\\{').test(raw)]));
 s.anonymous_connected=/Connecting anonymously to Steam Public[^\n]*OK/s.test(raw);
 docker(['rm','--volumes',s.container]);if(docker(['ps','-aq','--filter','name='+s.container]).trim())throw Error('Owned utility remains');
 s.container_absent=true;releaseInstaller(s.slot);s.slot_released=true;save();
 s.lease_outcome=releaseNative(s.lease.lease_id,owner,!s.aborted&&s.actual_exit===0&&s.app_sections['232370']?'tested':'blocked',true);s.lease_released=true;save();
 const report={at:new Date().toISOString(),claim_runtime:s.runtime,query_runtime:s.query_runtime,lease:s.lease,proof:s.proof,actual_exit:s.actual_exit,raw_wait:s.raw_wait,oom_killed:s.terminal.OOMKilled,app_sections:s.app_sections,anonymous_connected:s.anonymous_connected,no_app_update:true,game_content_acquired:false,installation_entitlement_verified:false,container_absent:true,slot_released:true,lease_released:true,log:s.capture.log};
 fs.writeFileSync('artifacts/game-parity-20261029/hl2dm-wave10-metadata-utility.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({exit:s.actual_exit,apps:s.app_sections,anonymous:s.anonymous_connected,cleaned:true}));
}else throw Error('Use claim|run|finish|abort');
