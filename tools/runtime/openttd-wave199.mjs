import fs from 'node:fs';
import * as c from './campaign-native-20261029.mjs';
const dir='artifacts/game-parity-20261029/wave199-openttd-live';fs.mkdirSync(dir,{recursive:true});
const file=dir+'/state.json',s=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const save=()=>fs.writeFileSync(file,JSON.stringify(s,null,2));
const game='openttd/egg-open-t-t-d-server.json',owner='openttd_wave199';
const phase=process.argv[2],pause=ms=>new Promise(r=>setTimeout(r,ms));
s.runtime=await c.verifyRuntime();save();
const profile=c.profileFromRuntime(game,s.runtime),ep=()=>'/api/client/servers/'+s.fixture.server.uuid;
async function until(fn,ms=55000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await pause(500);}throw Error('Bounded native readiness timeout');}
async function power(signal){await c.api(ep()+'/power','POST',{signal});await until(async()=>(await c.observePower(s.fixture)).current_state===(signal==='stop'?'offline':'running'));s.actions??=[];s.actions.push({signal,at:new Date().toISOString(),state:await c.observePower(s.fixture)});save();}
async function command(command){await c.api(ep()+'/command','POST',{command});await pause(600);const log=c.docker(['logs',s.fixture.server.uuid]);fs.writeFileSync(dir+'/console-'+Date.now()+'.log',log);return log;}
try{
if(phase==='admit'){
 const old=JSON.parse(fs.readFileSync(c.runtime+'/banana-wave4-openttd/state.json')),uuid=old.fixture.server.uuid;
 const checks={containers:!c.containers().some(x=>x.Name.includes(uuid))};
 for(const [k,p] of [['server','/api/application/servers/'+old.fixture.server.id],['egg','/api/admin/eggs/'+old.fixture.egg.id],['nest','/api/admin/nests/'+old.fixture.nest.id]])checks[k]=(await fetch('http://127.0.0.1:18099'+p)).status===404;
 checks.volume=c.docker(['run','--rm','--pull','never','--network','none','--memory','128m','--memory-swap','128m','--cpus','1','--mount','type=bind,source=/var/lib/voltra-parity-20261029,target=/campaign,readonly','alpine:3.23','sh','-c',`test ! -e /campaign/volumes/${uuid} && test ! -e /campaign/tmp/${uuid} && test ! -e /campaign/machine-id/${uuid} && echo absent`]).trim()==='absent';
 if(!Object.values(checks).every(Boolean))throw Error('Fresh cleanup review failed');
 const receipt=dir+'/prior-cleanup-review.json';fs.writeFileSync(receipt,JSON.stringify({at:new Date().toISOString(),uuid,checks}));
 s.lease=c.claimNative({owner,game,memory_mib:512,disk_mib:2048,ports:1,retry_review:{lease_id:old.lease.lease_id,game,resources_removed:true,reviewer:owner,cleanup_receipt:receipt,cleanup_sha256:c.digest(fs.readFileSync(receipt))}});save();
}
if(phase==='install'){
 c.activeLease(s.lease.lease_id,owner);s.slot=c.acquireInstaller(s.lease.lease_id,owner);save();
 s.fixture=await c.createNativeFixture({lease:s.lease,slot:s.slot,profile,name:'Campaign OpenTTD wave199',onStep:async x=>{s.fixture=x;save();}});
 const i=await c.waitNativeInstaller(s.fixture);s.installer={proof:i.proof};fs.writeFileSync(dir+'/imported-egg-original.json',JSON.stringify(s.fixture.egg,null,2));save();c.releaseGate(i.container,s.lease,s.slot.token);
}
if(phase==='installed'){s.install=await c.waitInstallOutcome(s.fixture,{timeoutMs:55000});save();if(!s.install.success)throw Error('Actual installation failed');c.releaseInstaller(s.slot);s.installer_released=true;save();}
if(phase==='start'){await power('start');s.proof=c.proveRuntime(c.containers().find(x=>x.Name==='/'+s.fixture.server.uuid),s.lease);save();}
if(phase==='settings'){
 await power('stop');const route=ep()+'/game-settings?file=%2Fopenttd.cfg',v=(await c.api(route)).attributes;
 const f=v.fields.find(x=>x.key==='network/max_clients');if(!f||f.readonly)throw Error('Supported native setting absent');
 fs.writeFileSync(dir+'/settings-before.json',JSON.stringify(v,null,2));const raw=await fetch('http://127.0.0.1:18099'+ep()+'/files/contents?file=%2Fopenttd.cfg');fs.writeFileSync(dir+'/openttd-before.cfg',Buffer.from(await raw.arrayBuffer()));
 s.setting={key:f.key,before:f.value,target:Number(f.value)===16?17:16};await c.api(route,'PUT',{revision:v.revision,settings:{[f.key]:String(s.setting.target)}});save();await power('start');
}
if(phase==='save'){
 const log=await command('getseed');s.seed=[...log.matchAll(/Generation Seed: (\d+)/g)].at(-1)?.[1];if(!s.seed)throw Error('Native console seed absent');
 await command('save /home/container/voltra-wave199');await until(async()=>{const a=(await c.api(ep()+'/files/list?directory=%2F')).data.map(x=>x.attributes);return a.some(x=>x.name==='voltra-wave199.sav'&&x.size>1000);});
 const q=c.docker(['exec',s.fixture.server.uuid,'sh','-c','sha256sum voltra-wave199.sav; ls -l voltra-wave199.sav']);s.engine_save=q;save();await power('stop');await power('start');
 await command('load /home/container/voltra-wave199.sav');const loaded=await command('getseed');const seed=[...loaded.matchAll(/Generation Seed: (\d+)/g)].at(-1)?.[1];if(seed!==s.seed)throw Error('Engine loaded seed mismatch');s.loaded_seed=seed;save();await power('restart');
}
if(phase==='query'){
 const {execFileSync}=await import('node:child_process');const q=JSON.parse(execFileSync(process.execPath,['tools/game-query/query.mjs','openttd','127.0.0.1',String(s.lease.ports[0])],{encoding:'utf8',windowsHide:true,timeout:15000}));if(q.maxplayers!==s.setting.target)throw Error('Engine did not consume configured max clients');s.native_query=q;save();
}
if(phase==='stop-export'){
 await power('stop');const container=c.containers().find(x=>x.Name==='/'+s.fixture.server.uuid);if(container.State.Running||container.State.ExitCode!==0)throw Error('Graceful exit not proven');
 c.docker(['cp',container.Id+':/home/container/.',dir+'/payload-save-cache']);fs.writeFileSync(dir+'/final-console.log',c.docker(['logs',container.Id]));s.export={at:new Date().toISOString(),path:dir+'/payload-save-cache',exit:container.State};save();
}
console.log(JSON.stringify({phase,lease:s.lease?.lease_id,server:s.fixture?.server?.uuid,install:s.install,setting:s.setting,loaded_seed:s.loaded_seed}));
}catch(e){s.error={phase,at:new Date().toISOString(),message:e.message};save();throw e;}
