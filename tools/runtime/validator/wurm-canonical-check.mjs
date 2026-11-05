/** Frozen22 Wurm source gates. Imports have no runtime side effects. */
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {campaign as h,receipt} from './campaign-session.mjs';
export const recipe='wurm_unlimited/egg-wurm-unlimited.json';
export const build='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const snapshot=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-22/build-input-1793678490224');
export const profileSHA256='15b269d2c4276bc59f0c165733cf21ec441c836b6ce2683ee143c90c7ccbacfb',scriptSHA256='b053061c632ee57926f698d722a6c6f5b50cbd835716edcbf4b17ae2db55d92a',historicalSHA256='5aa5a71ecb3022ed4d129b8cd30cb2bcbbb4218490c6cf1b943c052f06cad20e';
export const startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/wurm_owner.py';
export const image='ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8';
export const pins=Object.freeze({'.voltra/steam_template.py':'dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd','.voltra/bundle_debian_python.py':'16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0','.voltra/native_config.py':'8c125bb526b38896eeba57143ec2fc70bfb94f1c9783e4c6d652d8f57e3b52a2','.voltra/native_console.py':'e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5','.voltra/valheim_vrising_install.py':'2bfcbc3096571de8c5acb5d74e19f189a1544311269f9f192c9acec64d35e55f','.voltra/stationeers_wurm_starbound_install.py':'67eac9babb2a1471ae39749cdfa8d010a168ec4c302f79676c4932761e2789ba','.voltra/stationeers_wurm_starbound_runtime.py':'03471cf78268aa397d3114ca2c0ca578186e65944cffe5300f5aab5c89d4de7d','.voltra/stationeers_console_compat.py':'d021d5ead5923bf3d5082ede88dac3962da2ef55b0b5941ab17e9fd02901af3b','.voltra/wurm_owner.py':'510ada77be361ff12835d3a3b80524e97ec777572dbcf433356579fd81129dbb'});
export const sha=x=>createHash('sha256').update(x).digest('hex');
export const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export const wurmIdentity=(id,current)=>id==='wurm-canonical'&&current===build;
export function verifyWurmFrozen(p){
 if(sha(JSON.stringify(sorted(p)))!==profileSHA256||sha(p.egg.scripts.installation.script)!==scriptSHA256||p.egg.startup!==startup||p.egg.config.stop!=='^SIGINT')throw Error('Wurm frozen22 profile/script/startup differs');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.replaceAll('\r\n','\n').matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],sha(m[3]+'\n')]));
 if(JSON.stringify(sorted(emitted))!==JSON.stringify(sorted(pins)))throw Error('Wurm emitted helpers differ');verifyWurmAuthoritySources(Object.fromEntries([...p.egg.scripts.installation.script.replaceAll("\r\n","\n").matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],m[3]+"\n"])));return {profileSHA256,scriptSHA256,helpers:pins};
}
export function verifyWurmHistorical(raw){
 if(sha(raw)!==historicalSHA256)throw Error('Wurm historical receipt differs');const r=JSON.parse(raw);
 if(r.recipe!==recipe||r.build.appid!==402370||r.build.buildid!==3721785||Object.values(r.cleanup).some(x=>x!==true)||!r.read_only_failure||!r.limitations.some(x=>x.includes('NPC')))throw Error('Wurm historical scope differs');
 return {historicalOnly:true,fixtureDeleted:true,nativeCurrentPending:true,historicalSourceEquivalent:false,observedBuild:3721785,limitations:r.limitations,readOnlyFailure:r.read_only_failure,playerWANGameplay:false};
}
export function verifyWurmPrior(ctx,report,raw,pin,frozen){
 if(!wurmIdentity(ctx.game.id,ctx.build)||resolve(pin.path)!==resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/wurm-native-acceptance.json')||pin.sha256!==historicalSHA256||frozen?.profileSHA256!==profileSHA256||frozen?.scriptSHA256!==scriptSHA256||frozen?.nativeCurrentPending!==true||frozen?.historicalSourceEquivalent!==false)throw Error('Exact Wurm historical/current-pending acknowledgement required');
 verifyWurmFrozen(h.profileFromRuntime(recipe,receipt));return verifyWurmHistorical(raw);
}
export function wurmCanonicalRequest(p,{nodeId,primary,query}){
 verifyWurmFrozen(p);if(!Number.isSafeInteger(nodeId)||nodeId<1||nodeId===202||![primary,query].every(a=>Number.isSafeInteger(a?.id)&&a.id>0&&Number(a.node_id)===nodeId&&!a.server_id&&Number.isInteger(a.port)&&a.port>1024&&a.port<65536)||primary.id===query.id||primary.port===query.port||primary.ip!==query.ip)throw Error('Two distinct available isolated allocations required');
 const environment=Object.fromEntries(p.egg.variables.map(v=>[v.env_variable,String(v.default_value)]));environment.QUERY_PORT=String(query.port);
 return {request_id:randomUUID(),name:'validator-wurm-canonical',node_id:nodeId,memory:4096,disk:8192,image,automatic_ports:false,allocation_id:primary.id,allocation_additional:[query.id],environment};
}
export async function installedSource(ctx,c){
 const f=ctx.fixture,p=h.profileFromRuntime(recipe,receipt);verifyWurmFrozen(p);
 const a=(await h.api('/api/application/servers/'+f.server.id)).attributes;
 const canonical=wurmIdentity(ctx.game.id,ctx.build)&&f.template===sha(recipe).slice(0,16)&&f.intent?.template===f.template&&f.intent.scriptHash===scriptSHA256&&f.intent.build===build;
 if(ctx.build!==build||receipt.binary_sha256!==build||resolve(receipt.snapshot)!==snapshot||(!canonical&&ctx.game.recipe!==recipe)||f.recipe!==recipe||a.uuid!==f.server.uuid||a.name!=='validator-'+ctx.game.id||a.egg!==f.egg.id||Number(a.node)===202||a.container.image!==image||a.container.startup_command!==startup||a.container.environment.VOLTRA_NATIVE_FAMILY!=='wurm'||a.container.environment.SRCDS_APPID!=='402370'||a.container.environment.SRCDS_BETAID!=='')throw Error('Exact owned public frozen22 Wurm source required');
 // Fetch.text strips a UTF-8 BOM. Hash original response bytes for helper identity.
 for(const [path,pin]of Object.entries(pins)){
  const response=await fetch('http://127.0.0.1:18099/api/client/servers/'+f.server.uuid+'/files/contents?file='+encodeURIComponent('/'+path),{redirect:'error',signal:AbortSignal.any([...(ctx.signal?[ctx.signal]:[]),AbortSignal.timeout(15000)])});
  if(!response.ok||sha(Buffer.from(await response.arrayBuffer()))!==pin)throw Error('Installed Wurm helper differs: '+path);
 }
 const primary=f.allocation?.port??f.ports?.[0],query=Number(a.container.environment.QUERY_PORT);
 if(f.ports?.length!==2||new Set(f.ports).size!==2||!f.ports.includes(primary)||!f.ports.includes(query)||primary===query)throw Error('Wurm allocation identity differs');
 return {helpers:pins,primary,query,world:a.container.environment.SERVER_WORLD,nativeCurrentPending:true,historicalSourceEquivalent:false};
}
export function wurmSecretUI(v,f,actual){return ['ADMINPWD','SERVERPWD'].includes(v.env_variable)&&f?.secret===true&&f.server_value===''&&f.default_value===''&&f.secret_configured===(actual!=='')&&f.configured===(actual!=='');}
// Production hashes normalize CRLF and trailing LF; installed pins above hash exact raw bytes.
export const authorityPins=Object.freeze({'.voltra/native_config.py':pins['.voltra/native_config.py'],'.voltra/stationeers_wurm_starbound_install.py':pins['.voltra/stationeers_wurm_starbound_install.py'],'.voltra/wurm_owner.py':'1471851f0ff31a2b015f19df12ad44e6ab1208a88968075e1326e45d56acb580','.voltra/native_console.py':'7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4','.voltra/steam_template.py':'7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897','.voltra/valheim_vrising_install.py':'df2005c8fc7abdb2f5162811c211541c537caa3d4acede4b024dfa582ee596ba'});
export async function canonicalExposure(ctx,c){
 const source=await installedSource(ctx,c),actual=(await h.api('/api/application/servers/'+ctx.fixture.server.id)).attributes.container.environment,fields=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/startup')).data.map(x=>x.attributes??x),p=h.profileFromRuntime(recipe,receipt);
 for(const v of p.egg.variables){const rows=fields.filter(f=>f.env_variable===v.env_variable);if(rows.length!==1||rows[0].is_editable!==v.user_editable||(['ADMINPWD','SERVERPWD'].includes(v.env_variable)?!wurmSecretUI(v,rows[0],actual[v.env_variable]):String(rows[0].server_value)!==String(v.env_variable==='QUERY_PORT'?source.query:v.default_value)))throw Error('Wurm Startup exposure differs: '+v.env_variable);}
 const files=(await c.api('GET','/api/client/servers/'+ctx.fixture.server.uuid+'/files/list?directory=%2F')).data;if(!Array.isArray(files))throw Error('Wurm real Files inventory missing');
 const observed=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/game-settings?file=%2FLaunchConfig.ini')).attributes;
 const proof=verifyWurmExposure(observed,await c.read('/LaunchConfig.ini'));
 await ctx.artifact('wurm-launcher-authority-observed.json',{...proof,rawInstalledPins:pins,normalizedAuthorityPins:authorityPins,fileInventoryObserved:true});
 return {...proof,startupControls:true,fileInventory:true,nativeConsumptionClaim:false};
}
export async function runWurmCanonicalBoot(ctx){const checks=await import('./wurm-checks.mjs');return checks.runWurmCanonicalBoot(ctx);}

export const normalizeAuthority=x=>String(x).replaceAll('\r\n','\n').replace(/\n+$/,'')+'\n';
export function verifyWurmAuthoritySources(files){
 for(const [path,pin]of Object.entries({...authorityPins,'.voltra/native_config.py':pins['.voltra/native_config.py'],'.voltra/stationeers_wurm_starbound_install.py':pins['.voltra/stationeers_wurm_starbound_install.py']}))if(typeof files[path]!=='string'||sha(files[path])!==pins[path]||sha(normalizeAuthority(files[path]))!==pin)throw Error('Wurm raw/normalized source differs: '+path);
 return {rawInstalledPins:pins,normalizedAuthorityPins:authorityPins,productionNormalizationMatches:true};
}
export function verifyWurmExposure(body,raw){
 const hits=[...raw.matchAll(/^([^\r\n]*)/gm)].map(x=>x[1]).filter(x=>!/^\s*[#;]/.test(x)&&x.includes('=')).filter(x=>x.split('=')[0].trim().toLowerCase()==='cleanlogsonstart');
 if(hits.length!==1||!/^\s*CleanLogsOnStart\s*=\s*(true|false)\s*$/.test(hits[0]))throw Error('Ambiguous Wurm launcher scalar');
 const value=hits[0].split('=')[1].trim(),f=body?.fields;
 if(body?.file!=='/LaunchConfig.ini'||body.requires_stop!==true||!/^[a-f0-9]{64}$/.test(body.revision??'')||f?.length!==1||f[0].key!=='CleanLogsOnStart'||f[0].type!=='boolean'||f[0].value!==(value==='true')||f[0].readonly!==false||f[0].secret!==false)throw Error('Wurm exact typed launcher exposure differs');
 return {file:body.file,revision:body.revision,typedLauncherExposure:true,CleanLogsOnStart:value};
}
export function materializeWurmDefaults(variables,request){
 const environment=Object.fromEntries(variables.map(v=>[v.env_variable,String(v.default_value)]));
 if(!request.environment||JSON.stringify(Object.keys(environment).sort())!==JSON.stringify(Object.keys(request.environment).sort()))throw Error('Wurm request variable set differs');
 for(const [key,value]of Object.entries(environment)){
  const actual=request.environment[key];
  if(key==='QUERY_PORT'){if(!/^[0-9]+$/.test(actual)||Number(actual)<=1024||Number(actual)>65535||request.automatic_ports!==false||!Number.isSafeInteger(request.allocation_id)||request.allocation_additional?.length!==1||request.allocation_additional[0]===request.allocation_id)throw Error('Wurm explicit query allocation required');environment[key]=actual;}
  else if(actual!==value&&!(['ADMINPWD','SERVERPWD'].includes(key)&&value===''&&actual==='[REDACTED]'))throw Error('Wurm canonical default changed: '+key);
 }
 return {...request,environment};
}

// Explicit root-only preparation. This command does not start or install a server.
export async function prepareNativeResources(reportPath){
 const fs=await import('node:fs/promises'),{pathToFileURL}=await import('node:url');
 const path=resolve(reportPath),raw=await fs.readFile(path,'utf8'),report=JSON.parse(raw),f=report.fixture;
 if(report.build!==build||!f?.server||f.recipe!==recipe||!['validator-wurm','validator-wurm-canonical'].includes(f.name)||f.server.name!==f.name||f.canonicalBootstrap?.complete)throw Error('Exact Wurm preserved pre-native report required');
 const root='C:/Users/Veky/.t3/projects/pteroclone/ptero-go',driver=await import(pathToFileURL(resolve(root,'tools/runtime/campaign-native-20261029.mjs')).href),runtime=await driver.verifyRuntime();
 if(runtime.binary_sha256!==build||resolve(runtime.snapshot)!==snapshot)throw Error('Frozen22 runtime required');
 verifyWurmFrozen(driver.profileFromRuntime(recipe,runtime));
 const a=(await driver.api('/api/application/servers/'+f.server.id)).attributes,egg=(await driver.api('/api/admin/eggs/'+f.egg.id)).attributes;
 if(a.uuid!==f.server.uuid||a.name!==f.name||Number(a.node)!==1||a.egg!==f.egg.id||egg.uuid!==f.egg.uuid||a.container.image!==image||a.container.startup_command!==startup||!['0','4096'].includes(String(a.limits.memory))||(await driver.api('/api/client/servers/'+f.server.uuid+'/resources')).attributes.current_state!=='offline'||f.install?.rawExit!=='0'||!f.install.callback?.success||!f.install.memoryValid||!f.install.removed||!f.install.logsFollowed)throw Error('Owned parked installed Wurm source/resources required');
 const canonical=f.name==='validator-wurm-canonical',profile=driver.profileFromRuntime(recipe,runtime);
 if(canonical&&(egg.script_install!==profile.egg.scripts.installation.script||Number(a.limits.disk)!==8192||f.intent?.build!==build||f.intent.scriptHash!==scriptSHA256||f.intent.externalId!==a.external_id))throw Error('Wurm canonical preparation authority differs');
 if(!canonical&&egg.script_install!==driver.installerGate(profile.egg.scripts.installation.script,f.gateId))throw Error('Wurm native gated installer differs');
 const fields=(await driver.api('/api/client/servers/'+f.server.uuid+'/network/allocations')).data.map(x=>x.attributes??x),primary=fields.filter(x=>x.is_default);
 if(fields.length!==2||primary.length!==1||new Set(fields.map(x=>x.port)).size!==2||new Set(fields.map(x=>x.ip)).size!==1||!fields.some(x=>!x.is_default&&String(x.port)===String(a.container.environment.QUERY_PORT)))throw Error('Wurm explicit owned two-port preparation differs');
 for(const [name,pin]of Object.entries(pins)){const response=await fetch('http://127.0.0.1:18099/api/client/servers/'+f.server.uuid+'/files/contents?file='+encodeURIComponent('/'+name),{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok||sha(Buffer.from(await response.arrayBuffer()))!==pin)throw Error('Wurm preparation exact installed helper differs: '+name);}
 const {docker}=await import('./campaign-session.mjs');const ids=(await docker(['ps','-aq','--filter','name='+f.server.uuid])).trim().split(/\s+/).filter(Boolean);
 for(const id of ids){const [d]=JSON.parse(await docker(['inspect',id]));if(d.Name!=='/'+f.server.uuid||d.State.Running||d.Config.Image!==image||d.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source==='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid).length!==1)throw Error('Wurm preparation native container identity/offline differs');}
 const archive=path+'.resource-preparation-'+Date.now();await fs.mkdir(archive);await fs.writeFile(resolve(archive,'before.json'),raw,{flag:'wx'});
 await fs.writeFile(resolve(archive,'intent.json'),JSON.stringify({uuid:f.server.uuid,before:a.limits,requested:{memory:0},reportSHA256:sha(raw)}),{flag:'wx'});
 if(Number(a.limits.memory)!==0)await driver.api('/api/application/servers/'+f.server.id+'/build','PATCH',{memory:0});
 const after=(await driver.api('/api/application/servers/'+f.server.id)).attributes;
 await fs.writeFile(resolve(archive,'readback.json'),JSON.stringify({uuid:after.uuid,limits:after.limits}),{flag:'wx'});
 if(after.uuid!==a.uuid||Number(after.limits.memory)!==0||Object.keys(a.limits).some(k=>k!=='memory'&&JSON.stringify(a.limits[k])!==JSON.stringify(after.limits[k])))throw Error('Wurm resource release readback differs');
 f.diagnosticMemory={confirmed:true,before:a.limits,after:after.limits,archive,dockerUnlimitedStillRequiredAtEveryStart:true};await fs.writeFile(path,JSON.stringify({...report,fixture:f},null,2)+'\n');
 console.log(JSON.stringify({prepared:true,archive,started:false,installed:false}));
}
const {pathToFileURL}=await import('node:url');
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){if(process.argv[2]!=='--prepare-native-resources'||!process.argv[3]||process.argv.length!==4)throw Error('Use --prepare-native-resources REPORT');await prepareNativeResources(process.argv[3]);}
