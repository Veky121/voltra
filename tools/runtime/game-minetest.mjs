import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const base='http://127.0.0.1:8088';
const fixtures=JSON.parse(await readFile('.local/runtime-fixtures.json','utf8'));
const source='../pterodactyl-vite/upstream/game-eggs/minetest/egg-minetest.json';
const original=await readFile(source,'utf8');
const eggData=JSON.parse(original);
const results=[];
let server;
try{server=JSON.parse(await readFile('.local/game-minetest-server.json','utf8'))}catch{}
const report={tested_at:new Date().toISOString(),game:'Minetest / Luanti',egg_source:source,egg_sha256:createHash('sha256').update(original).digest('hex'),egg_modified:false,node_id:fixtures.node,results};
const attrs=x=>x?.attributes??x;
const rows=x=>x.data.map(attrs);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(method,path,body,raw=false){
  let response,last;
  for(let attempt=0;attempt<5;attempt++){
    try{response=await fetch(base+path,{method,headers:{'Content-Type':raw?'text/plain':'application/json'},body:body===undefined?undefined:raw?body:JSON.stringify(body)});break}catch(error){last=error;await sleep(300)}
  }
  if(!response)throw last;
  if(!response.ok)throw Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.status===204?null:raw?response.text():response.json();
}
async function until(fn,description,timeout=180000){const deadline=Date.now()+timeout;let last;while(Date.now()<deadline){try{const value=await fn();if(value)return value}catch(error){last=error.message}await sleep(750)}throw Error(`Timeout ${description}: ${last??''}`)}
async function check(name,fn,fatal=true){const started=Date.now();try{const evidence=await fn();results.push({name,passed:true,duration_ms:Date.now()-started,...(evidence?{evidence}: {})});console.log('PASS '+name)}catch(error){results.push({name,passed:false,duration_ms:Date.now()-started,error:error.message,...(!fatal?{category:'upstream_download_failure'}:{})});console.log('FAIL '+name+': '+error.message);if(fatal)throw error}finally{report.server=server?{id:server.id,uuid:server.uuid,identifier:server.identifier}:null;await mkdir('artifacts',{recursive:true});await writeFile('artifacts/runtime-game.json',JSON.stringify(report,null,2))}}
const client=path=>`/api/client/servers/${server.uuid}${path}`;
const get=()=>api('GET',`/api/application/servers/${server.id}`).then(attrs);
const state=()=>api('GET',client('/resources')).then(attrs);
const contents=path=>api('GET',client('/files/contents?file='+encodeURIComponent(path)),undefined,true);
const write=(path,text)=>api('POST',client('/files/write?file='+encodeURIComponent(path)),text,true);

await check('import_unmodified_upstream_egg',async()=>{
  let eggs=rows(await api('GET',`/api/admin/nests/${fixtures.nest}/eggs`));let egg=eggs.find(e=>e.name===eggData.name);
  if(!egg)egg=attrs(await api('POST',`/api/admin/nests/${fixtures.nest}/eggs/import`,eggData));
  report.egg_id=egg.id;
  const exported=await api('GET',`/api/admin/eggs/${egg.id}/export`);
  if(exported.startup!==eggData.startup||exported.scripts.installation.script!==eggData.scripts.installation.script)throw Error('Imported egg changed startup or installer');
  await writeFile('.local/game-minetest-egg.json',JSON.stringify({id:egg.id,source,sha256:report.egg_sha256},null,2));
  return {egg_id:egg.id,startup_preserved:true,installer_preserved:true};
});
await check('create_real_game_server',async()=>{
  if(!server){
    let allocations=rows(await api('GET',`/api/application/nodes/${fixtures.node}/allocations?per_page=100`));
    let allocation=allocations.find(a=>a.port===25596&&!a.assigned);
    if(!allocation){if(!allocations.some(a=>a.port===25596))await api('POST',`/api/application/nodes/${fixtures.node}/allocations`,{ip:'0.0.0.0',ports:['25596']});allocations=rows(await api('GET',`/api/application/nodes/${fixtures.node}/allocations?per_page=100`));allocation=allocations.find(a=>a.port===25596&&!a.assigned)}
    if(!allocation)throw Error('Dedicated game allocation 25596 unavailable');
    const environment=Object.fromEntries(eggData.variables.map(v=>[v.env_variable,v.default_value]));
    environment.SERVER_ANNOUNCE='false';environment.SERVER_ADMIN_NAME='parity_admin';environment.SERVER_NAME='Go parity isolated Minetest';environment.WORLD_NAME='parity_world';
    server=attrs(await api('POST','/api/application/servers',{name:'Minetest upstream egg verification',user:1,node_id:fixtures.node,egg:report.egg_id,allocation:{default:allocation.id},docker_image:Object.values(eggData.docker_images)[0],startup:eggData.startup,environment,limits:{memory:768,swap:0,disk:2048,io:500,cpu:100},feature_limits:{databases:1,allocations:1,backups:2},start_on_completion:false}));
    await writeFile('.local/game-minetest-server.json',JSON.stringify(server,null,2));
  }
  return {port:25596,image:Object.values(eggData.docker_images)[0]};
});
await check('upstream_installer_runs_and_downloads_game',async()=>{
  await until(async()=>{server=await get();if(server.status==='install_failed')throw Error('Wings installation failed');return server.status===null&&server.container.installed},'game install',240000);
  const conf=await contents('/.minetest/minetest.conf');
  const files=rows(await api('GET',client('/files/list?directory='+encodeURIComponent('/.minetest/games'))));
  if(!conf.includes('Server settings generated by pterodactyl'))throw Error('Installer did not create server config');
  try{const recovery=JSON.parse(await readFile('.local/game-minetest-recovery.json','utf8'));if(recovery.original_upstream_download_failed)throw Error('Original upstream installer download failed: ContentDB package HTML is protected by Anubis; the egg scraper silently produced no game. Official GitHub archive was installed separately.')}catch(error){if(error.message.startsWith('Original upstream'))throw error}
  if(!files.some(file=>file.is_file===false))throw Error('Upstream installer did not download a game directory');
  return {game_directories:files.map(file=>file.name),installed:server.container.installed};
},false);
await check('install_official_game_archive_when_upstream_download_is_blocked',async()=>{
  const files=rows(await api('GET',client('/files/list?directory='+encodeURIComponent('/.minetest/games'))));
  if(files.some(file=>file.name==='minetest'&&!file.is_file)){try{report.recovery=JSON.parse(await readFile('.local/game-minetest-recovery.json','utf8'))}catch{};return {already_installed:true,...report.recovery}};
  const archiveURL='https://codeload.github.com/luanti-org/minetest_game/zip/refs/heads/master';
  // Wings deliberately requires Content-Length for URL pulls. GitHub serves this
  // archive chunked, so stream the official archive through native signed upload.
  const download=await fetch(archiveURL);if(!download.ok)throw Error('Official game archive download '+download.status);
  const archive=await download.arrayBuffer();await writeFile('.local/game-minetest-official.zip',Buffer.from(archive));
  const signed=attrs(await api('GET',client('/files/upload')));const form=new FormData();form.append('files',new Blob([archive]),'official-minetest-game.zip');
  const upload=await fetch(new URL(signed.url,base)+'&directory='+encodeURIComponent('/.minetest/games'),{method:'POST',body:form});if(!upload.ok)throw Error('Signed game archive upload '+upload.status+' '+await upload.text());
  await api('POST',client('/files/decompress'),{root:'/.minetest/games',file:'official-minetest-game.zip'});
  await api('PUT',client('/files/rename'),{root:'/.minetest/games',files:[{from:'minetest_game-master',to:'minetest'}]});
  const recovery={original_upstream_download_failed:true,reason:'ContentDB Anubis page breaks the upstream HTML scraper. Installer hides unzip failures.',manual_game_source:archiveURL,upload_method:'Native panel signed upload and decompress',archive_sha256:createHash('sha256').update(Buffer.from(archive)).digest('hex'),egg_modified:false};
  await writeFile('.local/game-minetest-recovery.json',JSON.stringify(recovery,null,2));report.recovery=recovery;
  return recovery;
});
await check('start_actual_luanti_game_engine',async()=>{
  await api('POST',client('/power'),{signal:'start'});
  await until(async()=>{const st=await state();if(!['running','starting'].includes(st.current_state))return false;return (await contents('/server.log')).includes('Server for gameid')},'Luanti game engine running',120000);
  const world=await contents('/.minetest/worlds/parity_world/world.mt');
  if(!world.includes('gameid'))throw Error('Actual engine world metadata missing');
  report.world_metadata=world;
  if((await state()).current_state==='starting')report.upstream_startup_detection='Egg --terminal hides startup log from stdout. Luanti is listening, but Wings stays starting.';
  return {state:(await state()).current_state,world_metadata:world.trim()};
});
await check('configure_world_persistence_probe',async()=>{
  // The stock egg names an admin account that does not exist until first login.
  // Stop this initial game through the panel; the probe creates a local test admin
  // so subsequent panel stop/restart can use the egg's unchanged /shutdown command.
  await api('POST',client('/power'),{signal:'kill'});await until(async()=>(await state()).current_state==='offline','initial game process stop');
  const worldRoot='/.minetest/worlds/parity_world';
  for(const [root,name] of [[worldRoot,'worldmods'],[worldRoot+'/worldmods','parity_probe']]){
    const files=rows(await api('GET',client('/files/list?directory='+encodeURIComponent(root))));if(!files.some(file=>file.name===name))await api('POST',client('/files/create-folder'),{root,name});
  }
  await write(worldRoot+'/worldmods/parity_probe/mod.conf','name = parity_probe\ndescription = Persistence acceptance probe\ndepends = default\n');
  await write(worldRoot+'/worldmods/parity_probe/init.lua',`local storage=minetest.get_mod_storage()
local boots=storage:get_int("boot_count")+1
storage:set_int("boot_count",boots)
minetest.register_on_mods_loaded(function()
  minetest.after(2,function()
    local admin=minetest.settings:get("name")
    if admin and admin~="" and not minetest.get_auth_handler().get_auth(admin) then
      minetest.get_auth_handler().create_auth(admin,minetest.get_password_hash(admin,"local-persistence-test-only"))
    end
    minetest.emerge_area({x=0,y=64,z=0},{x=1,y=65,z=1},function(_,_,remaining)
      if remaining~=0 then return end
      local pos={x=0,y=64,z=0}
      local previous=minetest.get_node(pos).name
      minetest.set_node(pos,{name="default:diamondblock"})
      local proof={boot_count=boots,previous_node=previous,written_node=minetest.get_node(pos).name}
      minetest.safe_file_write(minetest.get_worldpath().."/parity-proof.json",minetest.write_json(proof))
      minetest.log("action","PTEROCLONE_WORLD_PROBE "..minetest.write_json(proof))
    end)
  end)
end)
`);
  let world=await contents(worldRoot+'/world.mt');if(!world.includes('load_mod_parity_probe'))world+='\nload_mod_parity_probe = true\n';await write(worldRoot+'/world.mt',world);
  return {probe:'Persistent mod storage plus a saved diamond block in map.sqlite'};
});
let first;
await check('generate_and_save_real_world_data',async()=>{
  let previousProof=0;try{previousProof=JSON.parse(await contents('/.minetest/worlds/parity_world/parity-proof.json')).boot_count}catch{}
  await api('POST',client('/power'),{signal:'start'});
  first=await until(async()=>{if(!['running','starting'].includes((await state()).current_state))return false;try{const proof=JSON.parse(await contents('/.minetest/worlds/parity_world/parity-proof.json'));return proof.boot_count>previousProof?proof:false}catch{return false}},'world generation and mod save',120000);
  if(first.written_node!=='default:diamondblock')throw Error('Probe did not change actual world node');
  const files=rows(await api('GET',client('/files/list?directory='+encodeURIComponent('/.minetest/worlds/parity_world'))));const map=files.find(file=>file.name==='map.sqlite');if(!map||map.size<1)throw Error('Real map database missing');
  return {...first,map_database_bytes:map.size};
});
await check('restart_preserves_world_and_mod_storage',async()=>{
  await api('POST',client('/power'),{signal:'restart'});
  const second=await until(async()=>{if(!['running','starting'].includes((await state()).current_state))return false;try{const proof=JSON.parse(await contents('/.minetest/worlds/parity_world/parity-proof.json'));return proof.boot_count>first.boot_count?proof:false}catch{return false}},'restarted engine and saved-world proof',120000);
  if(second.previous_node!=='default:diamondblock')throw Error('Previously written world block did not survive restart');
  if(second.boot_count!==first.boot_count+1)throw Error('Persistent mod storage boot counter did not increment exactly once');
  return second;
});
await check('graceful_stop_flushes_game_world',async()=>{
  await api('POST',client('/power'),{signal:'stop'});await until(async()=>(await state()).current_state==='offline','graceful Luanti shutdown');
  const log=await contents('/server.log');await writeFile('.local/game-minetest-server.log',log);if(!log.includes('PTEROCLONE_WORLD_PROBE'))throw Error('Game did not log persistence probe');
  return {state:(await state()).current_state,saved_world_available:true};
});
console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,server:server.uuid,artifact:'artifacts/runtime-game.json'}));
