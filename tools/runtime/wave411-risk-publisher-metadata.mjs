import fs from 'node:fs';
import {spawn} from 'node:child_process';
import * as h from './campaign-native-20261029.mjs';

const out='artifacts/game-parity-20261029/wave411-risk-publisher-metadata';
fs.mkdirSync(out,{recursive:true});
const save=(n,v)=>fs.writeFileSync(`${out}/${n}.json`,JSON.stringify(v,null,2)+'\n');
const owner='risk_metadata_wave411',image='ghcr.io/steamcmd/steamcmd:ubuntu-24@sha256:1aefa09cbcdf75a54c7400f02098340db975536f4972036b166e7265da2b5806';
const state={at:new Date().toISOString(),metadata_only:true,game_content_acquired:false,installation_entitlement_verified:false};
const persist=()=>save('state',state);
state.runtime=await h.verifyRuntime();
if(state.runtime.binary_sha256!=='5cf8eb5875e004d7cfe7d12bfb67727a3544d6708f07489b3d71da5ffb8564a7')throw Error('Unexpected campaign binary');
const queue=JSON.parse(fs.readFileSync(h.runtime+'/queue.json'));
if(queue.installer_slot||h.campaignInstallers().length){
  save('report',{...state,status:'queued_installer_busy',lease_acquired:false,pending:['Fresh official Steam metadata and anonymous payload availability'],consent:'Approved for owned isolated Wine/Mono fixtures; canonical default unchanged'});
  console.log('Queued before claim: actual installer occupied');
  process.exit(0);
}
state.image=JSON.parse(h.docker(['image','inspect',image]))[0].Id;
state.lease=h.claimNativeUtility({owner,task:'risk_appinfo_1180760',memory_mib:1024,disk_mib:1024,ports:0});persist();
try{
  state.slot=h.acquireInstaller(state.lease.lease_id,owner);persist();
  state.container='voltra-risk-metadata-installer-'+state.lease.lease_id;
  const script='set -eu\necho RISK_METADATA_GATE\nn=0\nwhile test ! -f /tmp/risk-metadata-release; do n=$((n+1)); test "$n" -lt 180; sleep 1; done\nexec /usr/bin/timeout --signal=TERM --kill-after=10s 180s /usr/games/steamcmd +@ShutdownOnFailedCommand 1 +@NoPromptForPassword 1 +@sSteamCmdForcePlatformType windows +login anonymous +app_info_update 1 +app_info_print 1180760 +quit\n';
  h.docker(['create','--name',state.container,'--label','voltra.risk-metadata-lease='+state.lease.lease_id,'--pull','never','--read-only','--network','voltra-parity-20261029','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1024m','--memory-swap','1024m','--cpu-period','100000','--cpu-quota','100000','--pids-limit','128','--tmpfs','/tmp:rw,exec,nosuid,size=1g','--env','HOME=/tmp','--user','1000:1000','--workdir','/tmp','--entrypoint','/bin/sh',image,'-c',script]);
  state.created=true;persist();h.docker(['start',state.container]);
  state.proof=h.proveInstaller(JSON.parse(h.docker(['inspect',state.container]))[0],state.lease);persist();
  const log=fs.openSync(out+'/metadata.log','w');
  const observer=spawn('docker',['--context','desktop-linux','logs','--follow',state.container],{windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  const observed=new Promise(resolve=>observer.once('close',code=>resolve(code)));
  h.docker(['exec',state.container,'test','-r','/usr/games/steamcmd']);
  h.docker(['exec',state.container,'touch','/tmp/risk-metadata-release']);
  state.raw_exit=h.docker(['wait',state.container]).trim();
  state.observer_exit=await observed;
  state.terminal=JSON.parse(h.docker(['inspect',state.container]))[0].State;
  const raw=fs.readFileSync(out+'/metadata.log','utf8');
  state.app_section=/"1180760"\s*\r?\n\{/.test(raw);
  state.anonymous_connected=/Connecting anonymously to Steam Public[^\n]*OK/s.test(raw);
  state.log_sha256=h.digest(raw);persist();
}catch(e){state.error=e.message;persist();}
finally{
  if(state.created){
    const c=JSON.parse(h.docker(['inspect',state.container]))[0];
    if(c.Config.Labels?.['voltra.risk-metadata-lease']!==state.lease.lease_id)throw Error('Unexpected utility ownership');
    if(c.State.Running)h.docker(['stop','--time','10',state.container]);
    h.docker(['rm','--volumes',state.container]);
    if(h.docker(['ps','-aq','--filter','name='+state.container]).trim())throw Error('Owned utility remains');
    state.container_absent=true;
  }
  if(state.slot){h.releaseInstaller(state.slot);state.installer_released=true;}
  state.release=h.releaseNative(state.lease.lease_id,owner,!state.error&&state.raw_exit==='0'&&state.app_section?'tested':'blocked',true);persist();
}
save('report',{...state,status:state.error?'metadata_failed':'metadata_observed',boundary:'Official metadata only. Does not prove anonymous payload download, native runtime or game acceptance.',pending:['Verify actual anonymous payload availability before removing setup gate','Native operator loop if payload is available'],consent:'Already approved for owned isolated Wine/Mono fixtures; canonical defaults unchanged'});
console.log(JSON.stringify({raw_exit:state.raw_exit,app_section:state.app_section,error:state.error,lease_released:!!state.release}));
