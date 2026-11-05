// Fixed anonymous Steam app530870 metadata only; never app_update/content/credentials.
import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {runtime,api,docker,digest,verifyRuntime,policy,hostCapacity,assertBudget,acquireInstaller,releaseInstaller,containers,activeLease} from './campaign-native-20261029.mjs';
import {transact,claimUtility,release} from './batch-queue.mjs';
export const request={owner:'empyrion_metadata',task:'empyrion-primary-metadata',memory_mib:1024,disk_mib:2048,ports:0};
const base='.local/game-parity-20261029/empyrion-metadata',queue=path.join(runtime,'queue.json');
const image='ghcr.io/steamcmd/steamcmd:ubuntu-24@sha256:1aefa09cbcdf75a54c7400f02098340db975536f4972036b166e7265da2b5806';
export const steamArgs=['+@ShutdownOnFailedCommand','1','+@NoPromptForPassword','1','+@sSteamCmdForcePlatformType','windows','+login','anonymous','+licenses_for_app','530870','+app_info_update','1','+app_info_print','530870','+quit'];
export function parseAppInfo(text,appid=530870){
 if(![530870,1007,228980].includes(appid))throw Error('Unreviewed metadata app');
 const match=new RegExp('(?:(?:^|\\n)\\s*)"'+appid+'"\\s*\\{').exec(text);if(!match)throw Error('Exact primary app metadata missing');
 const tokens=text.slice(match.index).match(/"(?:\\.|[^"\\])*"|[{}]/g);let index=0;
 const take=()=>{const t=tokens[index++];if(t===undefined)throw Error('Truncated Steam metadata');return t;};
 const value=t=>JSON.parse(t);
 function object(){if(take()!=='{')throw Error('Steam object required');const out={};while(tokens[index]!=='}'){const key=value(take());if(Object.hasOwn(out,key))throw Error('Ambiguous duplicate Steam key');out[key]=tokens[index]==='{'?object():value(take());}take();return out;}
 if(value(take())!==String(appid))throw Error('Wrong app root');return object();
}
export function assess(app){
 const selected=[],unresolved=[];
 for(const [depot,row]of Object.entries(app.depots??{})){
  if(!/^\d+$/.test(depot)||!row||typeof row!=='object')continue;
  const os=row.config?.oslist??'';if(os&&!os.split(',').map(x=>x.trim()).includes('windows'))continue;
  if(row.depotfromapp){unresolved.push({depot,from_app:row.depotfromapp});continue;}
  const manifest=row.manifests?.public;if(!manifest){unresolved.push({depot,reason:'public manifest absent'});continue;}
  const size=/^\d+$/.test(manifest.size??'')?BigInt(manifest.size):null;
  selected.push({depot,manifest:manifest.gid??null,bytes:size?.toString()??null,platform:os||'common'});
 }
 const known=selected.length>0&&selected.every(x=>x.bytes!==null&&/^\d+$/.test(x.manifest??''))&&unresolved.length===0,total=selected.reduce((n,x)=>n+BigInt(x.bytes??'0'),0n),GiB=1024n**3n;
 return {app:530870,name:app.common?.name??null,type:app.common?.type??null,public_build:app.depots?.branches?.public?.buildid??null,windows_depots:selected,unresolved_depots:unresolved,capacity_known:known,total_unpacked_bytes:known?total.toString():null,estimated_initial_bytes:known?(total+4n*GiB).toString():null,estimated_preservation_reinstall_bytes:known?(2n*total+4n*GiB).toString():null,fits_proposed24GiB_initial:known?total+4n*GiB<=24n*GiB:null,fits_proposed24GiB_reinstall:known?2n*total+4n*GiB<=24n*GiB:null,anonymous_metadata_visible:true,anonymous_depot_entitlement:'NOT PROVEN by metadata; actual access proof is required before large acquisition',game_content_acquired:false,app_update_used:false};
}
export function activeLicenses(raw){
 const start=/(?:(?:^|\n)\s*)"530870"\s*\{/.exec(raw),text=start?raw.slice(0,start.index):raw;
 const blocks=[...text.matchAll(/License packageID\s+(\d+)\s*:([\s\S]*?)(?=License packageID\s+\d+\s*:|$)/g)],packages=[];
 for(const block of blocks){
  const body=block[2],apps=/\bApps\s*:\s*([\d,\s]+)/i.exec(body),depots=/\bDepots\s*:\s*([\d,\s]+)/i.exec(body);
  const list=value=>(value??'').match(/\d+/g)??[];
  if(/\bState\s*:\s*Active\b/i.test(body)&&list(apps?.[1]).includes('530870'))packages.push({package_id:block[1],app:'530870',active:true,depots:list(depots?.[1])});
 }
 return {command:'licenses_for_app530870',read_only:true,activation_requested:false,active_app_license_observed:packages.length>0,packages,unknown_if_empty:true,interpretation:packages.length?'Primary Steam session reports active package ownership for app530870; exact depot access remains separately checked':'No positive active-app record parsed; this is NOT an inferred paid-license gate or depot refusal',reference:'https://partner.steamgames.com/doc/store/testing'};
}
export function assessShared(app,sharedApps){
 const primary=assess(app),resolved=[],unresolved=[];
 for(const link of primary.unresolved_depots){
  if(!link.from_app||![1007,228980].includes(Number(link.from_app))){unresolved.push(link);continue;}
  const source=sharedApps[link.from_app]?.depots?.[link.depot],manifest=source?.manifests?.public;
  if(!source||source.depotfromapp||!/^\d+$/.test(manifest?.gid??'')||!/^\d+$/.test(manifest?.size??'')){unresolved.push(link);continue;}
  resolved.push({app:link.from_app,depot:link.depot,manifest:manifest.gid,bytes:manifest.size});
 }
 const all=[...primary.windows_depots,...resolved],known=all.length>0&&unresolved.length===0&&all.every(x=>x.bytes!==null&&/^\d+$/.test(x.manifest??'')),total=all.reduce((n,x)=>n+BigInt(x.bytes??'0'),0n),GiB=1024n**3n;
 return {...primary,resolved_shared_depots:resolved,unresolved_depots:unresolved,capacity_known:known,total_unpacked_bytes:known?total.toString():null,estimated_initial_bytes:known?(total+4n*GiB).toString():null,estimated_preservation_reinstall_bytes:known?(2n*total+4n*GiB).toString():null,fits_proposed24GiB_initial:known?total+4n*GiB<=24n*GiB:null,fits_proposed24GiB_reinstall:known?2n*total+4n*GiB<=24n*GiB:null,fits_proposed48GiB_reinstall:known?2n*total+4n*GiB<=48n*GiB:null};
}
const primaryRequest=request,primaryArgs=steamArgs,primaryBase=base;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function main(command,shared=false){
 const request=shared?{...primaryRequest,task:'empyrion-shared-depots-metadata'}:primaryRequest;
 const steamArgs=shared?[...primaryArgs.slice(0,-1),'+app_info_print','1007','+app_info_print','228980','+quit']:primaryArgs;
 const base=shared?'.local/game-parity-20261029/empyrion-shared-metadata':primaryBase;
 if(command==='plan')return {request,image,steamArgs,hard_limits:{memory_mib:1024,swap_mib:0,cpu:1,wall_seconds:120,ports:[]},coordinator_turn_required:true,resource_claimed:false,game_payload_acquired:false};
 if(command==='claim-coordinator-approved'){
  await verifyRuntime();const cap=hostCapacity();const lease=transact(queue,s=>{if(s.activation_pause)throw Error('Activation pause');assertBudget(s,request,cap);const row=claimUtility(s,request,policy);row.cpu_percent=100;return row;});
  const folder=path.join(base,lease.lease_id);fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify({lease,at:new Date().toISOString(),image,steamArgs,app_update:false,phase:'claimed-waiting-coordinator',cleanup_intent:'Remove only labeled utility container, release serialized slot after actual terminal and utility lease after absence proof; no host volumes/ports'},null,2)+'\n',{mode:0o600});
  fs.writeFileSync(path.join(base,'active.json'),JSON.stringify({lease_id:lease.lease_id,owner:request.owner,folder},null,2)+'\n',{mode:0o600});
  return {lease_id:lease.lease_id,memory_mib:1024,disk_mib:2048,ports:[],query_started:false,container_created:false,receipt:path.join(folder,'state.json')};
 }
 if(command!=='run-coordinator-go')throw Error('Use plan, approved claim or coordinator-granted metadata-only run');
 await verifyRuntime();const pointer=JSON.parse(fs.readFileSync(path.join(base,'active.json'))),lease=activeLease(pointer.lease_id,request.owner);
 const current=JSON.parse(fs.readFileSync(queue));if(current.activation_pause)throw Error('Activation pause');
 const folder=path.join(base,lease.lease_id),state=JSON.parse(fs.readFileSync(path.join(folder,'state.json')));
 if(state.query_started_at||state.lease.lease_id!==lease.lease_id||state.phase!=='claimed-waiting-coordinator')throw Error('Exactly one approved metadata query required');
 const save=()=>fs.writeFileSync(path.join(folder,'state.json'),JSON.stringify(state,null,2)+'\n',{mode:0o600});state.query_started_at=new Date().toISOString();state.steamArgs=steamArgs;state.tool_sha256=digest(fs.readFileSync(fileURLToPath(import.meta.url)));state.container_intent='voltra-empyrion-metadata-'+lease.lease_id;save();let failure,slot,container;
 try{
  slot=acquireInstaller(lease.lease_id,request.owner);state.slot=slot;save();docker(['image','inspect',image]);
  const name='voltra-empyrion-metadata-'+lease.lease_id;
  const gate='set -eu; echo EMPYRION_METADATA_RESOURCE_GATE; n=0; while test ! -f /tmp/empyrion-metadata-go; do n=$((n+1)); test "$n" -lt 120; sleep 1; done; exec /usr/bin/timeout --signal=TERM --kill-after=10s 120s /usr/bin/steamcmd '+steamArgs.join(' ');
  container=docker(['create','--name',name,'--label','voltra.metadata-owner='+lease.lease_id,'--pull','never','--init','--read-only','--network','voltra-parity-20261029','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','1024m','--memory-swap','1024m','--cpu-period','100000','--cpu-quota','100000','--pids-limit','128','--tmpfs','/tmp:rw,exec,nosuid,size=1024m','--env','HOME=/tmp','--user','1000:1000','--workdir','/tmp','--entrypoint','/bin/bash',image,'-c',gate]).trim();state.container={id:container,name};save();
  docker(['start',container]);await sleep(300);
  const c=containers().find(x=>x.Id===container);if(!c?.State.Running||c.HostConfig.Memory!==1024*1024**2||c.HostConfig.MemorySwap!==1024*1024**2||c.HostConfig.CpuPeriod!==100000||c.HostConfig.CpuQuota!==100000||Object.keys(c.HostConfig.PortBindings??{}).length)throw Error('Actual utility limits/ports differ');
  const readonly=JSON.parse(docker(['inspect','--format','{{json .HostConfig.ReadonlyRootfs}}',container]));if(!readonly||c.Mounts.some(m=>m.Type==='bind'))throw Error('Readonly/no-host-mount boundary differs');
  const cgroups=docker(['exec',container,'/bin/sh','-c','cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.swap.max /sys/fs/cgroup/cpu.max']).trim().split(/\s+/);if(cgroups.join(' ')!=='1073741824 0 100000 100000')throw Error('Actual metadata cgroups differ');state.cgroups={memory_max:cgroups[0],swap_max:cgroups[1],cpu_quota:cgroups[2],cpu_period:cgroups[3],read_only:true,host_bind_mounts:0};save();
  const logs=fs.openSync(path.join(folder,'metadata.log'),'wx',0o600),logClient=spawn('docker',['--context','desktop-linux','logs','--follow',container],{windowsHide:true,stdio:['ignore',logs,logs]});
  const logged=new Promise(resolve=>logClient.once('exit',resolve));
  const waiting=spawn('docker',['--context','desktop-linux','wait',container],{windowsHide:true,stdio:['ignore','pipe','pipe']});let waitOutput='';waiting.stdout.on('data',b=>{waitOutput+=b;});const finished=new Promise(resolve=>waiting.once('exit',code=>resolve({client_exit:code,output:waitOutput.trim()})));
  await sleep(600);
  if(logClient.exitCode!==null||waiting.exitCode!==null||!fs.readFileSync(path.join(folder,'metadata.log'),'utf8').includes('EMPYRION_METADATA_RESOURCE_GATE'))throw Error('Actual live metadata wait/log attachment missing');
  state.proof={id:container,memory_mib:1024,swap_mib:0,cpu:1,ports:[],wait_client_pid:waiting.pid,log_client_pid:logClient.pid};save();
  docker(['exec',container,'/bin/sh','-c','touch /tmp/empyrion-metadata-go']);state.gate_released_at=new Date().toISOString();save();
  let timer,result;
  try{result=await Promise.race([finished,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Bounded metadata wait exceeded')),140000);})]);}finally{clearTimeout(timer);}
  state.wait=result;save();await logged;fs.closeSync(logs);
  const raw=fs.readFileSync(path.join(folder,'metadata.log'),'utf8');state.raw_sha256=digest(raw);state.raw_bytes=Buffer.byteLength(raw);save();
  if(result.client_exit!==0||result.output!=='0')throw Error('Primary metadata utility returned nonzero; retain raw result');
  const app=parseAppInfo(raw),assessment={...(shared?assessShared(app,{'1007':parseAppInfo(raw,1007),'228980':parseAppInfo(raw,228980)}):assess(app)),active_license_query:activeLicenses(raw)};fs.writeFileSync(path.join(folder,'assessment.json'),JSON.stringify(assessment,null,2)+'\n');state.assessment=assessment;save();
 }catch(error){failure=error;state.failure=error.message;save();}
 finally{
  const own=containers().find(x=>x.Id===container||x.Name==='/'+state.container_intent);
  if(own){const labels=JSON.parse(docker(['inspect','--format','{{json .Config.Labels}}',own.Id]));if(labels?.['voltra.metadata-owner']!==lease.lease_id)throw Error('Metadata cleanup ownership label differs');if(own.State.Running)docker(['stop','--time','5',own.Id]);docker(['rm',own.Id]);}
  if(containers().some(x=>x.Id===container||x.Name==='/'+state.container_intent))throw Error('Owned metadata container removal unproven');state.container_removed=true;save();
  if(slot)releaseInstaller(slot);
  transact(queue,s=>release(s,lease.lease_id,request.owner,failure?'blocked':'tested',true));state.lease_released=true;state.completed_at=new Date().toISOString();save();
 }
 if(failure)throw failure;return {assessment:state.assessment,receipt:path.join(folder,'state.json'),utility_removed:true,lease_released:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){const raw=process.argv[2]??'plan',shared=raw.startsWith('shared-');console.log(JSON.stringify(await main(shared?raw.slice(7):raw,shared),null,2));}
