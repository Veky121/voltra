import {createHash,randomUUID} from 'node:crypto';
import {campaign as h,receipt,docker} from './campaign-session.mjs';
import {materializeDefaults} from './canonical-request.mjs';
export const recipe='minecraft/crossplay/purpur-geysermc-floodgate/egg-purpur-geyser-floodgate.json';
export const build='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const publisherJars={'server.jar':'a22d86bb993491a2d4fe77eca77c247541f1720ce19f68c7af0881c443b9878e','plugins/geyser-spigot.jar':'6537e1fb6ef1e115172653ca42c0f9c2e38d07ca2415142bb5e0fb9aeecd1e07','plugins/floodgate-spigot.jar':'21570aff9ce17d6983928e8552777760e1ede5050026b04c686b0ae112e6fd7e'};
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const emittedPins={".voltra/minecraft_special_runtime.py":"3ae29a53dc99620603b9a984eb2976cd9cdfa297ddf3c85befdb0208b6daf117",".voltra/native_config.py":"8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2",".voltra/limbo_install.py":"6b4de8a593c3ad0689aaf0fe375d2c7f750e80834f9d1f457f0e5cdf8cde629b",".voltra/native_release.py":"31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",".voltra/native_zip_release.py":"ec5537319192fb653721fa0266a768381a4bce3608151df44bc67e1f8371ce95",".voltra/minecraft_special_install.py":"09d4fcb4ca4f44281f14aa04d0ecd34916557c2b6bd7d7a48c0386ca4e661e79",".voltra/minecraft-special-releases.json":"353a3bb5befc977350e46c1f5377e80d82dae93b90b60260ca7f18a6333ff1d3"};
export const installerSHA256="3bde950cda7b5136e08407f2a18b156b05e4851c089b5136d692bc25d9959338";
export const crossplayIdentity=(id,currentBuild)=>id==='crossplay-canonical'&&currentBuild===build;
export function materializeCrossplayDefaults(vars,request){
 const chosen=request.environment,ports=['BEDROCK_PORT','WEBRTC_PORT'];
 const adjusted=vars.map(v=>ports.includes(v.env_variable)?{...v,default_value:chosen?.[v.env_variable]}:v);
 if(request.automatic_ports!==false||!Number.isSafeInteger(request.allocation_id)||request.allocation_additional?.length!==2||new Set([request.allocation_id,...request.allocation_additional]).size!==3||!ports.every(k=>/^[0-9]+$/.test(chosen?.[k]??'')&&Number(chosen[k])>1024&&Number(chosen[k])<=65535)||chosen.BEDROCK_PORT===chosen.WEBRTC_PORT)throw Error('Exact explicit Crossplay port choices required');
 return materializeDefaults(adjusted,request);
}
export async function crossplayExplicitRequest(ctx,profile,nodeId){
 const choices=ctx.game.crossplayAllocations;
 if(!crossplayIdentity(ctx.game.id,ctx.build)||nodeId!==1||choices?.length!==3||new Set(choices.map(a=>a.id)).size!==3||new Set(choices.map(a=>a.port)).size!==3)throw Error('Prepared isolated three-allocation Crossplay request required');
 const response=await h.api('/api/application/nodes/'+nodeId+'/allocations?per_page=1000');if(response.meta?.pagination?.total_pages>1)throw Error('Allocation inventory incomplete');
 const current=response.data.map(a=>a.attributes??a);
 for(const wanted of choices){const found=current.filter(a=>a.id===wanted.id);if(found.length!==1||found[0].port!==wanted.port||found[0].ip!=='127.0.0.1'||found[0].server_id!=null||wanted.port<29100||wanted.port>29199)throw Error('Prepared Crossplay allocation is no longer free/matching');}
 const environment=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,String(v.default_value)]));environment.BEDROCK_PORT=String(choices[1].port);environment.WEBRTC_PORT=String(choices[2].port);
 return {request_id:randomUUID(),name:'validator-crossplay-canonical',memory:4096,disk:8192,image:profile.egg.docker_images['Java 25 default'],node_id:nodeId,automatic_ports:false,allocation_id:choices[0].id,allocation_additional:choices.slice(1).map(a=>a.id),environment};
}

export function verifyCrossplayAllocation(ctx,allocations,environment){
 const primary=allocations.filter(a=>a.is_default===true),ports=[primary[0]?.port,Number(environment.BEDROCK_PORT),Number(environment.WEBRTC_PORT)];
 if(allocations.length!==3||primary.length!==1||new Set(ports).size!==3||!ports.every(p=>Number.isInteger(p)&&p>1024&&p<=65535&&allocations.some(a=>a.port===p))||environment.GEYSER_TRANSPORT!=='both')throw Error('Crossplay three resolved native roles differ');
 return ports;
}
export function verifyCrossplayPrior(report,raw){
 if(hash(raw)!=='b835856691c9c398848041d12c35247d15e80bf3f4c871d3b7d0642611f91c15'||report.recipe!==recipe||report.final_stop?.state?.ExitCode!==0||report.final_stop.state.OOMKilled||!report.query_restored?.java_status?.nonce_echo||!report.query_restored?.raknet?.nonce_echo||!report.native_world_marker?.read_by_native_command_after_reinstall)throw Error('Exact historical Crossplay research receipt required');
 return {historicalNative:true,currentNativePending:true,sourceEquivalent:false,scope:'Historical protocol research only; current changed helpers need fresh execution'};
}
export async function installedSource(ctx,c){
 const f=ctx.fixture;if(ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||ctx.game.testStartup||receipt.binary_sha256!==build)throw Error('Exact candidate22 Crossplay canonical fixture required');
 const p=h.profileFromRuntime(recipe,receipt),s=(await h.api('/api/application/servers/'+f.server.id)).attributes;
 if(s.uuid!==f.server.uuid||s.egg!==f.egg.id||Number(s.node)===202||p.egg.config.stop!=='stop'||hash(p.egg.scripts.installation.script)!==installerSHA256)throw Error('Crossplay canonical source/stop authority differs');
 // Wings normalizes CRLF once before executing the installer. Preserve every
 // other byte and the heredoc's single final LF; never trim installed contents.
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.replaceAll('\r\n','\n').matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
 const out={};for(const [path,pin]of Object.entries(emittedPins)){if(emitted[path]!==pin||hash(await c.read('/'+path))!==pin)throw Error('Crossplay exact emitted helper differs: '+path);out[path]=pin;}
 return out;
}
export function verifyCrossplayExposure(body){
 if(body.file!=='/server.properties'||!body.revision||!Array.isArray(body.fields))throw Error('Crossplay native properties exposure missing');
 for(const [key,type]of Object.entries({'max-players':'number','motd':'text'})){const matches=body.fields.filter(x=>x.key===key);if(matches.length!==1||matches[0].readonly===true||matches[0].type!==type)throw Error('Crossplay supported typed field absent: '+key);}
 return {file:body.file,typedJavaCapacityAndMotd:true,bedrockPassthroughConsumptionNotClaimed:true};
}

export async function verifyCrossplayInstalled(ctx,c){
 const sources=await installedSource(ctx,c),f=ctx.fixture;
 const ids=(await docker(['ps','-aq','--filter','name=^/'+f.server.uuid+'$'],ctx.signal)).trim().split(/\s+/).filter(Boolean);
 if(ids.length>1)throw Error('Crossplay container identity ambiguous');
 const d=ids.length?JSON.parse(await docker(['inspect',ids[0]],ctx.signal))[0]:null;
 const source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d&&(d.Name!=='/'+f.server.uuid||d.State.Running||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/'))))throw Error('Crossplay stopped owned publication required');
 if((await h.api('/api/client/servers/'+f.server.uuid+'/resources')).attributes.current_state!=='offline')throw Error('Crossplay API must be offline');
 const helper='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
 const program=String.raw`import pathlib,sys,json,hashlib,stat
r=pathlib.Path('/source');pins=json.loads(sys.argv[1]);out={}
for name,pin in pins.items():
 p=r/name
 for q in [p,*p.parents]:
  if q==r.parent:break
  if q.is_symlink():raise ValueError('Symlink publisher payload')
 before=p.stat()
 if not stat.S_ISREG(before.st_mode) or before.st_size>134217728:raise ValueError('Invalid JAR')
 with p.open('rb')as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
 after=p.stat()
 assert digest==pin and (before.st_size,before.st_ino,before.st_mtime_ns)==(after.st_size,after.st_ino,after.st_mtime_ns),'Publisher payload differs'
 out[name]=dict(sha256=digest,bytes=after.st_size)
print(json.dumps(out,sort_keys=True))`;
 const jars=JSON.parse(await docker(['run','--rm','--pull','never','--user','0:0','--network','none','--read-only','--memory','256m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,source='+source+',target=/source,readonly',helper,'python3','-B','-c',program,JSON.stringify(publisherJars)],ctx.signal,30000));
 const afterIds=(await docker(['ps','-aq','--filter','name=^/'+f.server.uuid+'$'],ctx.signal)).trim().split(/\s+/).filter(Boolean);if(JSON.stringify(ids)!==JSON.stringify(afterIds))throw Error('Crossplay container inventory changed');
 if(d){const [after]=JSON.parse(await docker(['inspect',d.Id],ctx.signal));if(after.State.Running||after.State.StartedAt!==d.State.StartedAt||after.State.FinishedAt!==d.State.FinishedAt)throw Error('Crossplay publication boundary changed');}
 return {sources,jars,currentNativePending:true,cacheNotInstalledProof:true};
}
