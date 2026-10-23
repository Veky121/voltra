import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

// This fixture emits upstream diagnostic lines from a real Wings-managed
// container. It verifies panel behavior, not Minecraft/Java/Steam/Hytale.
const base='http://127.0.0.1:8088';
const file='.local/egg-features-fixture.json';
const attrs=v=>v?.attributes??v;
const rows=v=>(v?.data||[]).map(attrs);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function api(method,path,body){const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${await r.text()}`);return r.status===204?null:r.json()}
async function until(fn,label){for(let i=0;i<90;i++){const v=await fn();if(v)return v;await pause(500)}throw Error(`Timed out: ${label}`)}
const features=['eula','java_version','gsl_token','pid_limit','steam_disk_space','hytale_oauth'];
const diagnostic={eula:'You need to agree to the EULA in order to run the server',java_version:'java.lang.UnsupportedClassVersionError: fixture diagnostic',gsl_token:'(GSL token expired)',pid_limit:'pthread_create failed: fixture diagnostic',steam_disk_space:'SteamCMD needs 250MB of free disk space to update',hytale_oauth:'https://oauth.accounts.hytale.com/oauth2/device/verify?user_code=FIXTURE-NOT-A-REAL-CODE'};
const startup=`case "$FEATURE_CASE" in eula) if grep -q '^eula=true$' eula.txt 2>/dev/null; then echo EGG_FEATURE_READY; else echo '${diagnostic.eula}'; sleep 2; exit 0; fi;; java_version) if [ "$FEATURE_JAVA_SUPPORTED" = 1 ]; then echo EGG_FEATURE_READY; else echo '${diagnostic.java_version}'; sleep 2; exit 0; fi;; gsl_token) if [ "$STEAM_ACC" = fixture-local-token ]; then echo EGG_FEATURE_READY; else echo '${diagnostic.gsl_token}'; sleep 2; exit 0; fi;; pid_limit) echo '${diagnostic.pid_limit}'; sleep 2; exit 0;; steam_disk_space) echo '${diagnostic.steam_disk_space}'; sleep 2; exit 0;; hytale_oauth) echo '${diagnostic.hytale_oauth}'; sleep 2; exit 0;; esac; while IFS= read -r line; do case "$line" in stop) exit 0;; *) echo "fixture-received:$line";; esac; done`;
const command=process.argv[2]||'status';
let f;try{f=JSON.parse(await readFile(file,'utf8'))}catch{}
const serverPath=suffix=>`/api/client/servers/${f.server.uuid}${suffix}`;
const resources=async()=>attrs(await api('GET',serverPath('/resources')));
async function stop(){if((await resources()).current_state!=='offline'){await api('POST',serverPath('/power'),{signal:'stop'});await until(async()=>(await resources()).current_state==='offline','fixture offline')}}
if(command==='setup'){
 if(f&&!f.cleaned_at)throw Error('Fixture already exists. Use status/case/cleanup; do not duplicate it.');
 if(f?.cleaned_at)await writeFile(`.local/egg-features-fixture-previous-${Date.now()}.json`,JSON.stringify(f,null,2));
 await mkdir('.local',{recursive:true});
 const shared=JSON.parse(await readFile('.local/runtime-fixtures.json','utf8'));
 execFileSync('docker',['tag','pteroclone-smoke:local','pteroclone-egg-features:unsupported'],{stdio:'inherit'});
 await mkdir('.local/egg-features-image',{recursive:true});
 await writeFile('.local/egg-features-image/Dockerfile','FROM pteroclone-smoke:local\nENV FEATURE_JAVA_SUPPORTED=1\n');
 execFileSync('docker',['build','-t','pteroclone-egg-features:supported','.local/egg-features-image'],{stdio:'inherit'});
 const nest=attrs(await api('POST','/api/admin/nests',{name:'Egg feature browser fixtures',author:'fixture@local.invalid',description:'Owned disposable real-container diagnostic fixtures.'}));
 f={nest:nest.id,node:shared.node,features,diagnostic,startup};await writeFile(file,JSON.stringify(f,null,2));
 const document={meta:{version:'PTDL_v2',update_url:null},name:'Native egg feature diagnostic fixture',author:'fixture@local.invalid',description:'Emits diagnostic fixture lines in real Wings; no commercial game or identity service.',features,docker_images:{'Fixture unsupported runtime':'pteroclone-egg-features:unsupported','Fixture supported runtime':'pteroclone-egg-features:supported'},file_denylist:[],startup,config:{files:'{}',startup:'{"done":"EGG_FEATURE_READY"}',logs:'{}',stop:'stop'},scripts:{installation:{script:'#!/bin/sh\nset -eu\necho fixture-installed > /mnt/server/egg-features-installed.txt\n',container:'alpine:3.23',entrypoint:'sh'}},variables:[{name:'Diagnostic case',description:'Select the real container diagnostic fixture.',env_variable:'FEATURE_CASE',default_value:'pid_limit',user_viewable:true,user_editable:true,rules:'required|string'},{name:'Fixture GSL token',description:'Local fixture token; never sent to Steam.',env_variable:'STEAM_ACC',default_value:'',user_viewable:true,user_editable:true,rules:'nullable|string'}]};
 const egg=attrs(await api('POST',`/api/admin/nests/${f.nest}/eggs/import`,document));f.egg=egg.id;await writeFile(file,JSON.stringify(f,null,2));
 const allocations=rows(await api('GET',`/api/application/nodes/${f.node}/allocations?per_page=100`));
 if(allocations.some(a=>a.port===25610))throw Error('Fixture port25610 already exists; refusing to reuse unknown allocation.');
 await api('POST',`/api/application/nodes/${f.node}/allocations`,{ip:'0.0.0.0',ports:['25610']});
 f.allocation=rows(await api('GET',`/api/application/nodes/${f.node}/allocations?per_page=100`)).find(a=>a.port===25610).id;await writeFile(file,JSON.stringify(f,null,2));
 f.server=attrs(await api('POST','/api/application/servers',{name:'Egg feature browser fixture',user:1,node_id:f.node,egg:f.egg,allocation:{default:f.allocation},docker_image:'pteroclone-egg-features:unsupported',startup,environment:{FEATURE_CASE:'pid_limit',STEAM_ACC:''},limits:{memory:128,swap:0,disk:128,io:500,cpu:100},feature_limits:{databases:0,allocations:1,backups:0},start_on_completion:false}));await writeFile(file,JSON.stringify(f,null,2));
 await until(async()=>{const s=attrs(await api('GET',`/api/application/servers/${f.server.id}`));return !s.status&&s.container.installed},'fixture installed');
 console.log(JSON.stringify({server:f.server.identifier,uuid:f.server.uuid,egg:f.egg,nest:f.nest,port:25610}));
}else if(command==='case'){
 if(!f?.server)throw Error('Run setup first.');const feature=process.argv[3];if(!features.includes(feature))throw Error('Unknown feature');await stop();
 if(feature==='eula')await api('POST',serverPath('/files/delete'),{root:'/',files:['eula.txt']}).catch(e=>{if(!e.message.includes('404'))throw e});
 await api('PUT',serverPath('/settings/docker-image'),{docker_image:'pteroclone-egg-features:unsupported'});
 await api('PUT',serverPath('/startup/variable'),{key:'FEATURE_CASE',value:feature});
 await api('PUT',serverPath('/startup/variable'),{key:'STEAM_ACC',value:''});
 console.log(JSON.stringify({ready:feature,server:f.server.identifier,expected:diagnostic[feature],startViaBrowser:true}));
}else if(command==='status'){
 if(!f?.server)throw Error('No fixture.');console.log(JSON.stringify({server:f.server.identifier,resources:await resources(),startup:await api('GET',serverPath('/startup'))}));
}else if(command==='cleanup'){
 if(!f)throw Error('No fixture recorded; refusing untracked cleanup.');
 if(f.server){await stop();await api('DELETE',`/api/application/servers/${f.server.id}`)}
 if(f.allocation)await api('DELETE',`/api/application/nodes/${f.node}/allocations/${f.allocation}`);
 if(f.egg)await api('DELETE',`/api/admin/eggs/${f.egg}`);
 if(f.nest)await api('DELETE',`/api/admin/nests/${f.nest}`);
 execFileSync('docker',['image','rm','pteroclone-egg-features:unsupported','pteroclone-egg-features:supported'],{stdio:'inherit'});
 f.cleaned_at=new Date().toISOString();f.local_image_tags_removed=true;await writeFile(file,JSON.stringify(f,null,2));console.log('Owned fixture server, allocation, egg, nest and local image tags deleted. Sanitized fixture receipt and build definition retained for reproduction.');
}else throw Error('Expected setup, case <feature>, status or cleanup.');
