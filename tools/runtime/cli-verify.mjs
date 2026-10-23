import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const base='http://127.0.0.1:8088';
const fixture=JSON.parse(await readFile('.local/runtime-fixtures.json','utf8'));
const env={...process.env};
for(const line of (await readFile('.local/runtime.env','utf8')).replace(/^\uFEFF/,'').split(/\r?\n/)){const match=line.match(/^([A-Z_]+)=(.*)$/);if(match)env[match[1]]=match[2]}
const results=[];
const report={tested_at:new Date().toISOString(),scope:'CLI RunCommand against a dedicated real Wings/Docker container',node_id:fixture.node,results};
let server,allocation,allocationCreated=false;
const attrs=value=>value?.attributes??value;
const rows=value=>value.data.map(attrs);
async function api(method,path,body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.status===204?null:r.json()}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label,timeout=120000){const end=Date.now()+timeout;let last;while(Date.now()<end){try{if(await fn())return}catch(e){last=e.message}await delay(500)}throw Error(`Timeout ${label}: ${last??''}`)}
async function check(name,fn){const start=Date.now();try{const evidence=await fn();results.push({name,passed:true,duration_ms:Date.now()-start,...(evidence?{evidence}:{})});console.log('PASS '+name)}catch(e){results.push({name,passed:false,duration_ms:Date.now()-start,error:e.message});console.log('FAIL '+name+': '+e.message);throw e}finally{report.server=server?{id:server.id,uuid:server.uuid,identifier:server.identifier}:null;await mkdir('artifacts',{recursive:true});await writeFile('artifacts/runtime-cli.json',JSON.stringify(report,null,2))}}
const client=suffix=>`/api/client/servers/${server.uuid}${suffix}`;
const state=()=>api('GET',client('/resources')).then(attrs);
const dockerState=()=>JSON.parse(execFileSync('docker',['inspect',server.uuid,'--format','{{json .State}}'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
function cli(action,force=true){const args=['run','./cmd/panel','p:server:bulk-power',action,'--servers='+server.id];if(force)args.push('--force');const result=JSON.parse(execFileSync('go',args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}));if(result.selected!==1||result.servers.length!==1||result.servers[0].id!==server.id)throw Error('CLI selection escaped its dedicated server');if(force&&(result.dry_run||result.servers[0].success!==true))throw Error('CLI did not report accepted dedicated action');return result}

try{
 await check('create_dedicated_server_and_real_install',async()=>{
  const allocations=rows(await api('GET',`/api/application/nodes/${fixture.node}/allocations?per_page=100`));
  let port=25599;while(allocations.some(a=>a.port===port&&a.assigned)){port++;if(port>25620)throw Error('No dedicated CLI port available')}
  allocation=allocations.find(a=>a.port===port&&!a.assigned);
  if(!allocation){await api('POST',`/api/application/nodes/${fixture.node}/allocations`,{ip:'0.0.0.0',ports:[String(port)]});allocation=rows(await api('GET',`/api/application/nodes/${fixture.node}/allocations?per_page=100`)).find(a=>a.port===port&&!a.assigned);allocationCreated=true}
  if(!allocation)throw Error('Dedicated allocation was not created');
  server=attrs(await api('POST','/api/application/servers',{name:'CLI real Wings verification',user:1,node_id:fixture.node,egg:fixture.egg,allocation:{default:allocation.id},docker_image:'pteroclone-smoke:local',startup:fixture.startup,environment:{},limits:{memory:128,swap:0,disk:512,io:500,cpu:100},feature_limits:{databases:0,allocations:1,backups:0},start_on_completion:false}));
  await writeFile('.local/cli-server.json',JSON.stringify(server,null,2));
  await until(async()=>{const current=attrs(await api('GET',`/api/application/servers/${server.id}`));return current.status===null&&current.container.installed},'real installer callback');
  return {allocation_port:port,server_id:server.id,uuid:server.uuid};
 });
 await check('cli_dry_run_does_not_start_container',async()=>{const result=cli('start',false);if(!result.dry_run)throw Error('CLI preview not marked dry-run');if((await state()).current_state==='running')throw Error('CLI preview started the container');return {selected:result.selected,state:(await state()).current_state}});
 await check('cli_start_real_container',async()=>{cli('start');await until(async()=>(await state()).current_state==='running'&&dockerState().Running,'CLI start');return {state:'running',docker_started_at:dockerState().StartedAt}});
 await check('cli_restart_changes_real_container_start_time',async()=>{const previous=dockerState().StartedAt;cli('restart');await until(async()=>{const current=dockerState();return current.Running&&current.StartedAt!==previous&&(await state()).current_state==='running'},'CLI restart');return {before:previous,after:dockerState().StartedAt}});
 await check('cli_stop_real_container',async()=>{cli('stop');await until(async()=>(await state()).current_state==='offline'&&!dockerState().Running,'CLI stop');return {state:'offline',exit_code:dockerState().ExitCode}});
 await check('cli_kill_real_container',async()=>{cli('start');await until(async()=>(await state()).current_state==='running'&&dockerState().Running,'start before kill');cli('kill');await until(async()=>(await state()).current_state==='offline'&&!dockerState().Running,'CLI kill');return {state:'offline',exit_code:dockerState().ExitCode}});
}finally{
 if(server){await check('cleanup_only_dedicated_cli_server',async()=>{const current=attrs(await api('GET',`/api/application/servers/${server.id}`));if(current.uuid!==server.uuid||current.name!=='CLI real Wings verification')throw Error('Refusing cleanup of a server outside CLI ownership');await api('DELETE',`/api/application/servers/${server.id}`);if(allocationCreated)await api('DELETE',`/api/application/nodes/${fixture.node}/allocations/${allocation.id}`);return {deleted_server_id:server.id,deleted_uuid:server.uuid}})}
}
