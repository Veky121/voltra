import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {runtime,api,docker,digest,verifyRuntime,profileFromRuntime,claimNative,activeLease,acquireInstaller,releaseInstaller,createNativeFixture,waitNativeInstaller,waitInstallOutcome,releaseGate,observePower} from './campaign-native-20261029.mjs';
const recipe='wolfenstein_enemy_territory/etlegacy/egg-e-t-legacy.json',owner='etlegacy_native_banana';
const dir=path.join(runtime,'banana-wave10-etlegacy'),file=path.join(dir,'state.json');
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
const save=()=>{fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n');};
const owned=()=>activeLease(state.lease.lease_id,owner);
async function served(){
 const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);
 if(profile.defaults.memory!==1024||profile.defaults.disk!==4096||profile.egg.variables.length!==8||profile.egg.variables.find(v=>v.env_variable==='ET_VERSION')?.default_value!=='32')throw Error('Review changed default recipe');
 const marker="cat > .voltra/etlegacy_authority.py <<'VOLTRA_ETLEGACY_WAVE10'\n",script=profile.egg.scripts.installation.script;
 const reviewed=fs.readFileSync('tools/runtime/banana-parity-wave10-etlegacy-authority-v2.py','utf8');
 if(digest(reviewed)!=='f300766bec8558534156db51a8106ba6d18700a9daaca59fab0d259548671c57'||script.split(marker).length!==2)throw Error('Reviewed v2 authority is not served');
 const body=script.split(marker)[1].split('VOLTRA_ETLEGACY_WAVE10\n')[0];
 if(body!==reviewed||!profile.egg.startup.endsWith('.voltra/etlegacy_authority.py'))throw Error('Exact served authority bytes/launcher differ');
 return {receipt,profile,helper:{source_sha256:digest(reviewed),embedded_sha256:digest(body)}};
}
const phase=process.argv[2]||'plan';
if(phase==='plan'){const c=await served();console.log(JSON.stringify({recipe,defaults:c.profile.defaults,variables:c.profile.egg.variables.map(v=>v.env_variable),images:c.profile.egg.docker_images,pid:c.receipt.pid}));}
else if(phase==='publisher'){
 const sources=[];for(const [name,url]of [['release','https://www.etlegacy.com/download'],['assets','https://www.splashdamage.com/games/wolfenstein-enemy-territory/'],['server_cfg','https://raw.githubusercontent.com/etlegacy/etlegacy/v2.86.2/misc/etmain/etl_server.cfg'],['mod_cfg','https://raw.githubusercontent.com/etlegacy/etlegacy/v2.86.2/misc/etmain/legacy.cfg']]){
  const r=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Publisher metadata unavailable: '+name);const content=Buffer.from(await r.arrayBuffer());if(content.length>2*1024**2)throw Error('Oversized publisher metadata');fs.mkdirSync(dir,{recursive:true});const target=path.join(dir,'publisher-'+name+'.txt');fs.writeFileSync(target,content);sources.push({url,sha256:digest(content),file:target});
 }
 state.publisher=sources;save();console.log(JSON.stringify(sources));
}else if(phase==='claim'){
 const c=await served();if(state.lease)owned();else{if(JSON.parse(fs.readFileSync(path.join(runtime,'queue.json'))).claims.some(c=>c.owner===owner&&c.status==='active'))throw Error('An existing owned claim needs recovery; do not duplicate');state.lease=claimNative({game:recipe,owner,memory_mib:1024,disk_mib:4096,ports:1});}state.runtime=c.receipt;save();console.log(JSON.stringify({lease:state.lease}));
}else if(phase==='install'){
 if(process.argv[3]!=='coordinator-handoff')throw Error('Explicit coordinator installer GO required');owned();const c=await served();if(state.fixture||state.slot)throw Error('Owned setup attempt exists; inspect/recover it instead of creating a duplicate');
 state.cached_images=[];for(const image of [c.profile.egg.scripts.installation.container,...Object.values(c.profile.egg.docker_images)]){const actual=JSON.parse(docker(['image','inspect',image]))[0];state.cached_images.push({requested:image,image_id:actual.Id,repo_digests:actual.RepoDigests,entrypoint:actual.Config.Entrypoint});}save();
 if(JSON.parse(docker(['image','inspect',c.profile.egg.scripts.installation.container]))[0].Config.Entrypoint?.length)throw Error('Installer ENTRYPOINT would bypass gate');
 state.slot=acquireInstaller(state.lease.lease_id,owner);state.slot_released=false;state.profile=c.profile;state.runtime=c.receipt;save();
 state.fixture=await createNativeFixture({lease:state.lease,slot:state.slot,profile:c.profile,name:'Campaign ETLegacy native',onStep:async partial=>{state.fixture=partial;save();}});save();
 const {container,proof}=await waitNativeInstaller(state.fixture);const cgroup=docker(['exec',container.Id,'sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim();
 if(cgroup!=='1073741824\n0\n100000 100000')throw Error('Actual default1GiB/noSwap/CPU1 proof failed');
 const stamp=Date.now(),log=path.join(dir,`installer-${stamp}.log`),wait=path.join(dir,`installer-${stamp}.exit`),error=path.join(dir,`installer-${stamp}.stderr`);
 const l=fs.openSync(log,'a'),w=fs.openSync(wait,'a'),e=fs.openSync(error,'a');const logger=spawn('docker',['--context','desktop-linux','logs','--follow',container.Id],{detached:true,windowsHide:true,stdio:['ignore',l,l]}),waiter=spawn('docker',['--context','desktop-linux','wait',container.Id],{detached:true,windowsHide:true,stdio:['ignore',w,e]});logger.unref();waiter.unref();[l,w,e].forEach(fs.closeSync);
 state.installer={proof,cgroup,image_id:container.Image,requested_image:container.Config.Image,log,wait,error,attached_before_release:true};save();
 for(let i=0;i<20&&!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE');i++)await new Promise(r=>setTimeout(r,100));if(!fs.readFileSync(log,'utf8').includes('CAMPAIGN_RESOURCE_GATE'))throw Error('Pre-gate log observer missing');
 releaseGate(container,state.lease,state.slot.token);state.installer.released_at=new Date().toISOString();save();console.log(JSON.stringify({uuid:state.fixture.server.uuid,proof,cgroup}));
}else if(phase==='installed'){
 owned();state.install_outcome=await waitInstallOutcome(state.fixture,{timeoutMs:55000});const raw=fs.readFileSync(state.installer.wait,'utf8').trim();if(!/^\d+$/.test(raw))throw Error('Actual installer Dockerwait not yet captured');state.installer.actual_wait=Number(raw);releaseInstaller(state.slot);state.slot_released=true;save();console.log(JSON.stringify({outcome:state.install_outcome,actual_wait:state.installer.actual_wait}));
}else if(phase==='sourceproof'){
 owned();const current=await served();if(!state.install_outcome?.success)throw Error('Actual successful installer required');
 const r=await fetch('http://127.0.0.1:18099/api/client/servers/'+state.fixture.server.uuid+'/files/contents?file=%2F.voltra%2Fetlegacy_authority.py');
 const body=Buffer.from(await r.arrayBuffer());if(!r.ok||digest(body)!==current.helper.embedded_sha256)throw Error('Installed helper bytes differ from exact served embed');
 state.installed_helper_sourceproof={at:new Date().toISOString(),...current.helper,actual_installed_sha256:digest(body),runtime_pid:current.receipt.pid,binary_sha256:current.receipt.binary_sha256};save();console.log(JSON.stringify(state.installed_helper_sourceproof));
}else if(phase==='inspect'){owned();console.log(JSON.stringify({power:await observePower(state.fixture),server_status:(await api('/api/application/servers/'+state.fixture.server.id)).attributes.status}));}
else throw Error('Explicit plan|publisher|claim|install coordinator-handoff|installed|inspect required');
