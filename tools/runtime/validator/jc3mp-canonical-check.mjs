import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const attrs=x=>x?.attributes??x;
/** Import-safe frozen22 source gates. No execution on import. */
import {createHash} from 'node:crypto';
export const recipe="just_cause/just_cause_3/egg-j-c3-m-p.json";
export const build='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const snapshot="C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-22/build-input-1793678490224";
export const profileSHA256='dcfbb830d7a44c1073c86240eea568fa58c24aa5c430e34b06b6d3cbba0635f3';
export const scriptSHA256='bd7e48361d12559c597f6d08ba8c6e66259ecd41b6d0519debd4dd02cf7afe90';
export const image="ghcr.io/ptero-eggs/yolks@sha256:db48c30fc50104a43d951200174d33e2b9200f80b03b3ded9c106586450dbcf8";
export const startup="exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/open_world_servers.py run jc3";
export const sourcePins=Object.freeze({
  ".voltra/steam_template.py": "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
  ".voltra/native-console.py": "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
  ".voltra/onset-mariadb-compat.py": "7d68cf7fa520ab5afc5b66a21ddaf66daf4ca2f44c780dbba9336087c839553b",
  ".voltra/additional_survival_install.py": "a2c9dca09dc86279e0f154a5d1574f6e6e68d4c4260687cf6fffe7003ea55b29",
  ".voltra/native-release.py": "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
  ".voltra/small-native-install.py": "13543ec2dac32acafa497b2acd84724dccda5ef5b8fe52571ffc7be10c370a39",
  ".voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
  ".voltra/open_world_servers.py": "0dd83bcbc9bd46ceee3661b69e75bd63c2219c909e6a86d20e641ba5e65f8d28",
  ".voltra/open-world-releases.json": "6361344affbdad8f45b75dbaadd3a80105273382606587bdb1af0d6e5c61cfa1"
});
// game_settings_campaign_authority.go semanticFiles removes exactly one final LF.
export const authorityPins=Object.freeze({
  ".voltra/steam_template.py": "7d908cdc739fbb999fdfb13f48f3e8d3a5fdf26fbfa48091dee1442913078897",
  ".voltra/native-console.py": "7f0c2a6e4050d12fc3bb2af9dcd723df6b80109fed91a26ccd1ae52d2bb1b3a4",
  ".voltra/onset-mariadb-compat.py": "7deaa592dd1fcab234450874148e8283f468c58a36cecdf9bdf17a22433f8b0a",
  ".voltra/additional_survival_install.py": "aa891c7f0afc1c492480b76caa8f4c63cdd288aa2cac057ba25be109de483c4d",
  ".voltra/native-release.py": "f33518a3579198e5cf657f794a467b5cf53023a848203ef62d215d13936cd15d",
  ".voltra/small-native-install.py": "a7992f28e4eff019b94c282c15aa02ece3fb81e0e912df233c721b0702c3b5ef",
  ".voltra/bundle_debian_python.py": "8da05c31a5aeebc8b6096223508a9e7314fc853bf1682ae31da52ec46db11aad",
  ".voltra/open_world_servers.py": "60c2f9bf43fba71238c91e57b26219ec3df6b98a7a6bf7d6934c2e85097219c3",
  ".voltra/open-world-releases.json": "dfb54a12e99fa4bcd129c632a286d573647bc1db85e3de4edbd17d2155e498e8"
});
export const historicalSHA256="55de807c24be06fc2864a797583bfe8ee1954d8b3db8d225cd0cbd3e4d17f4a5";
export const sha=x=>createHash('sha256').update(x).digest('hex');
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
export const jc3mpIdentity=(id,b)=>id==='jc3mp-canonical'&&b===build;
export function emittedHelpers(profile){
 const script=profile.egg.scripts.installation.script.replaceAll('\r\n','\n'), result={};
 for(const m of script.matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){
  if(Object.hasOwn(result,m[1]))throw Error('Duplicate emitted helper');result[m[1]]=m[3]+'\n';
 }return result;
}
export function verifyJC3MPFrozen(profile){
 if(sha(JSON.stringify(sorted(profile)))!==profileSHA256||sha(profile.egg.scripts.installation.script)!==scriptSHA256||profile.egg.startup!==startup||profile.egg.config.stop!=='^C'||profile.required_ports!==4||!Object.values(profile.egg.docker_images).includes(image))throw Error('JC3MP frozen22 profile/raw script/launch differs');
 const emitted=emittedHelpers(profile);
 if(JSON.stringify(Object.keys(emitted).sort())!==JSON.stringify(Object.keys(sourcePins).sort()))throw Error('JC3MP emitted inventory differs');
 for(const [name,body]of Object.entries(emitted))if(sha(body)!==sourcePins[name]||sha(body.slice(0,-1))!==authorityPins[name])throw Error('JC3MP LF installed/semantic authority differs: '+name);
 return {profileSHA256,rawScriptSHA256:scriptSHA256,installedLFPins:sourcePins,productionAuthorityPins:authorityPins,nativeCurrentPending:true};
}
export function verifyJC3MPHistorical(raw){
 if(sha(raw)!==historicalSHA256||JSON.parse(raw).recipe!==recipe)throw Error('JC3MP historical receipt differs');
 return {historicalOnly:true,nativeCurrentPending:true,historicalSourceEquivalent:false,exit130:'signal termination only',shutdownFlush:false,worldSave:false};
}
export function verifyExposure(body){
 if(!body.revision||body.file!=='/config.json')throw Error('JC3MP revisioned config authority absent');
 for(const [key,type]of Object.entries({'/name':'text','/maxPlayers':'number','/maxTickRate':'number','/announce':'boolean'})){
  const f=body.fields?.filter(f=>f.key===key);if(f?.length!==1||f[0].type!==type||f[0].readonly||f[0].read_only||f[0].readOnly)throw Error('JC3MP typed scalar authority differs: '+key);
 }
 for(const key of ['host','bind','port','queryPort','steamPort','httpPort','requiredDLC'])for(const f of body.fields??[])if(f.key==='/'+key&&!(f.readonly||f.read_only||f.readOnly||f.type==='readonly'))throw Error('JC3MP managed field editable');
 return {typedSourceOnly:true,nativeConsumptionPending:true};
}

export async function canonicalExposure(ctx,c){
 const {installedSource}=await import('./jc3mp-checks.mjs');await installedSource(ctx,c);
 const {campaign:h,receipt}=await import('./campaign-session.mjs');const p=h.profileFromRuntime(recipe,receipt);
 const fields=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/startup')).data.map(x=>x.attributes??x);
 for(const v of p.egg.variables.filter(v=>v.user_viewable)){
  const hits=fields.filter(f=>f.env_variable===v.env_variable);
  if(hits.length!==1||hits[0].is_editable!==v.user_editable)throw Error('JC3MP canonical Startup exposure differs: '+v.env_variable);
 }
 const body=(await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/game-settings?file=%2Fconfig.json')).attributes;
 return {...verifyExposure(body),browserVerified:false,setupFlowVerified:false};
}
export function verifyJC3MPPrior(ctx,report,raw,pin,frozen){
 if(!jc3mpIdentity(ctx.game.id,ctx.build)||pin?.sha256!==sha(raw)||frozen?.profileSHA256!==profileSHA256||frozen?.rawScriptSHA256!==scriptSHA256||frozen?.nativeCurrentPending!==true||frozen?.historicalSourceEquivalent!==false)throw Error('JC3MP explicit historical/current pending boundary required');
 return verifyJC3MPHistorical(raw);
}

export function jc3mpEnvironment(profile){verifyJC3MPFrozen(profile);const e=Object.fromEntries(profile.egg.variables.map(v=>[v.env_variable,String(v.default_value)]));if(e.PUBLIC_SERVER!=='true'||e.SRCDS_APPID!=='619960'||e.AUTO_UPDATE!=='1'||e.WINDOWS_INSTALL!=='0'||e.XVFB!=='0')throw Error('JC3MP frozen defaults differ');e.PUBLIC_SERVER='false';return e;}
export function materializeJC3MPDefaults(variables,request){const e=Object.fromEntries(variables.map(v=>[v.env_variable,String(v.default_value)]));if(e.PUBLIC_SERVER!=='true'||e.SRCDS_APPID!=='619960')throw Error('JC3MP defaults differ');e.PUBLIC_SERVER='false';if(JSON.stringify(Object.keys(e).sort())!==JSON.stringify(Object.keys(request.environment??{}).sort())||Object.entries(e).some(([k,v])=>request.environment[k]!==v&&!(k==='SERVER_PASSWORD'&&request.environment[k]==='[REDACTED]'&&v==='')))throw Error('Exact private JC3MP request required');return {...request,environment:e};}

// Invoked only by the existing exclusive canonical runner after installer admission.
export async function runJC3MPCanonicalBoot(ctx){
 const {campaign:h,receipt}=await import('./campaign-session.mjs');
 const {native,wait,logs}=await import('./campaign-adapter.mjs');
 const hooks=await import('./jc3mp-checks.mjs');
 const f=ctx.fixture,p=h.profileFromRuntime(recipe,receipt),attrs=x=>x?.attributes??x;
 verifyJC3MPFrozen(p);materializeJC3MPDefaults(p.egg.variables,f.intent.request);
 if(!jc3mpIdentity(ctx.game.id,ctx.build)||f.intent.build!==build||f.intent.scriptHash!==sha(p.egg.scripts.installation.script)||f.name!=='validator-jc3mp-canonical'||f.server.name!==f.name||f.intent.request.memory!==1024||f.intent.request.disk!==8192||f.intent.request.image!==image)throw Error('Exact JC3MP canonical intent required');
 const lc={...ctx,game:{...ctx.game,family:'jc3mp',recipe,serverUUID:f.server.uuid}},route='/api/client/servers/'+f.server.uuid;
 const c={read:async path=>{const r=await fetch('http://127.0.0.1:18099'+route+'/files/contents?file='+encodeURIComponent(path),{redirect:'error',signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(15000)])});if(!r.ok)throw Error('JC3MP file HTTP '+r.status);return Buffer.from(await r.arrayBuffer());},state:async()=>attrs(await h.api(route+'/resources')).current_state,power:signal=>h.api(route+'/power','POST',{signal})};
 await hooks.prerequisites(lc,c);
 const a=attrs(await h.api('/api/application/servers/'+f.server.id));
 if(f.diagnosticMemory?.confirmed!==true||Number(a.limits.memory)!==0)throw Error('ROOT_RESOURCE_PREP_REQUIRED: fresh install preserved; run jc3mp-canonical-check.mjs --prepare-native-resources REPORT before retry. No native start attempted');
 if(f.canonicalBootstrap?.attemptedAt||(await native(lc))?.state.Running)throw Error('JC3MP first diagnostic requires fresh parked fixture; prior attempt needs root review');
 await ctx.reserve(ctx.game.peakMiB);const started=Date.now();lc.startRequestedAt=started;
 await ctx.own({...f,canonicalBootstrap:{attemptedAt:new Date(started).toISOString(),complete:false,...hooks.evidenceLimits}});
 let generation,live;
 try{
  await c.power('start');
  await wait(lc,async()=>{const n=await native(lc);if(!n||Date.parse(n.state.StartedAt)<started)return false;if(generation&&(generation.id!==n.id||generation.state.StartedAt!==n.state.StartedAt))throw Error('JC3MP diagnostic generation changed');generation=n;return hooks.ready(lc,c);},'JC3MP stock readiness',240000);
  live=await hooks.observe(lc);const text=await logs(lc,generation.state.StartedAt);
  await ctx.artifact('jc3mp-stock-native.log',text);
  if(live.stockPackages.some(p=>/voltra-persistence|voltra-retention|validator/i.test(p)))throw Error('JC3MP stock boot contains test package');
  const perfBoundary=text.length;await h.api(route+'/command','POST',{command:'perf'});
  await wait(lc,async()=>{const current=await native(lc);if(current?.id!==live.containerId||current.state.StartedAt!==live.startedAt||!current.state.Running)throw Error('JC3MP perf generation changed');const fresh=(await logs(lc,live.startedAt)).slice(perfBoundary);await ctx.artifact('jc3mp-perf-response.log',fresh);return /tick|performance|connections/i.test(fresh);},'JC3MP real perf response',15000);
  const transport=await hooks.transportObservation(lc,live);await ctx.artifact('jc3mp-stock-transport.json',transport);
  const {randomUUID}=await import('node:crypto');
  const command={nonce:randomUUID(),command:'quit',containerId:live.containerId,startedAt:live.startedAt,...live.process,at:new Date().toISOString()};
  await ctx.artifact('jc3mp-quit-command-intent.json',command);const begin=Date.now();
  await h.api(route+'/command','POST',{command:'quit'});
  const commandReceipt={...command,acceptedAt:new Date().toISOString()};await ctx.artifact('jc3mp-quit-command-receipt.json',commandReceipt);
  let stopped;
  try{const deadline=begin+30000;while(Date.now()<deadline){ctx.signal.throwIfAborted();const n=await native({...lc,signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))])});if(!n||n.id!==live.containerId||n.state.StartedAt!==live.startedAt)throw Error('JC3MP exact diagnostic generation lost');if(!n.state.Running){stopped=n;break;}await new Promise(done=>setTimeout(done,Math.min(250,Math.max(1,deadline-Date.now()))));}if(!stopped)throw Error('JC3MP quit diagnostic 30000ms deadline; no signals sent');}
  finally{const n=await native(lc);await ctx.artifact('jc3mp-quit-raw-observation.json',{container:n,elapsedMs:Date.now()-begin,signalSent:false,escalated:false,live,commandReceipt});}
  const proof={containerId:stopped.id,startedAt:stopped.state.StartedAt,pid:live.process.pid,startTicks:live.process.startTicks,binarySHA256:live.process.binarySHA256,command:'quit',rawExit:stopped.state.ExitCode,elapsedMs:Date.now()-begin,signalSent:false,escalated:false,descendantsGone:await hooks.descendantsGone(lc,live),running:stopped.state.Running,oomKilled:stopped.state.OOMKilled,dead:stopped.state.Dead,finishedAt:stopped.state.FinishedAt,commandReceiptSHA256:sha(JSON.stringify(commandReceipt))};
  await ctx.artifact('jc3mp-quit-diagnostic.json',proof);hooks.verifyQuitDiagnostic(proof,live);
  const finalLog=await logs(lc,live.startedAt);await ctx.artifact('jc3mp-stock-final.log',finalLog);
  if(!/Steam.*connect|connect.*Steam/i.test(finalLog)||!finalLog.includes('Server successfully started up'))throw Error('JC3MP actual Steam/readiness evidence missing');
  await ctx.own({...ctx.fixture,jc3mpDiagnostic:{proof,transport,reviewRequired:true,...hooks.evidenceLimits}});
  hooks.diagnosticGate('root review after stock diagnostic');
 }catch(error){
  await ctx.artifact('jc3mp-diagnostic-failure.json',{error:String(error),generation,live,complete:false,...hooks.evidenceLimits});
  // Ordinary preserving park is deliberately outside the no-signal diagnostic.
  const pc={...lc,signal:AbortSignal.timeout(90000)},n=await native(pc);
  if(n?.state.Running){if(!generation||n.id!==generation.id||n.state.StartedAt!==generation.state.StartedAt)throw Error('JC3MP unknown generation: preserve lease for root');await ctx.artifact('jc3mp-ordinary-park-intent.json',{container:n,diagnosticSuccess:false});await h.api(route+'/power','POST',{signal:'stop'});const parked=await wait(pc,async()=>{const x=await native(pc);if(!x||x.id!==n.id||x.state.StartedAt!==n.state.StartedAt)throw Error('JC3MP park generation changed');return !x.state.Running&&await c.state()==='offline'?x:false;},'JC3MP ordinary preserving park',60000);await ctx.artifact('jc3mp-ordinary-park.json',{container:parked,diagnosticSuccess:false});}
  throw error;
 }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const [mode,path,...extra]=process.argv.slice(2);
 if(!['--prepare-native-resources'].includes(mode)||!path||extra.length)throw Error('Usage: jc3mp-canonical-check.mjs --prepare-native-resources REPORT');
 const work=resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go'),main=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go'),out=resolve(work,'.local/validator-campaign'),reportPath=resolve(path);
 if(reportPath!==resolve(out,'jc3mp-canonical.json'))throw Error('Exact canonical report path required');
 const lease=await fs.open(resolve(out,'queue.lock'),'wx');await lease.writeFile(JSON.stringify({pid:process.pid,operation:'jc3mp-resource-preparation'}));try{
 const raw=await fs.readFile(reportPath,'utf8'),report=JSON.parse(raw),f=report.fixture;
 const driver=await import(pathToFileURL(resolve(main,'tools/runtime/campaign-native-20261029.mjs')).href),runtime=await driver.verifyRuntime();
 if(runtime.binary_sha256!==build||resolve(runtime.snapshot)!==resolve(snapshot)||report.build!==build||report.game!=='jc3mp-canonical'||f?.name!=='validator-jc3mp-canonical'||f.server?.name!==f.name||f.recipe!==recipe||f.intent?.build!==build||f.install?.rawExit!=='0'||!f.install.callback?.success||!f.install.logsFollowed||!f.install.memoryValid||!f.install.removed)throw Error('Exact frozen22 observed canonical fixture/install required');
 const profile=driver.profileFromRuntime(recipe,runtime);verifyJC3MPFrozen(profile);if(f.intent.scriptHash!==sha(profile.egg.scripts.installation.script)||f.install.scriptHash!==f.intent.scriptHash)throw Error('JC3MP exact raw installer proof required');materializeJC3MPDefaults(profile.egg.variables,f.intent.request);
 const a=attrs(await driver.api('/api/application/servers/'+f.server.id)),egg=attrs(await driver.api('/api/admin/eggs/'+f.egg.id)),route='/api/client/servers/'+f.server.uuid;
 if(a.uuid!==f.server.uuid||a.name!==f.name||a.external_id!==f.intent.externalId||Number(a.user)!==f.intent.ownerId||Number(a.node)!==f.intent.request.node_id||Number(a.node)===202||a.egg!==f.egg.id||egg.uuid!==f.egg.uuid||egg.script_install!==profile.egg.scripts.installation.script||a.container?.image!==image||a.container.startup_command!==startup||Number(a.limits.disk)!==8192||attrs(await driver.api(route+'/resources')).current_state!=='offline')throw Error('Owned exact parked canonical identity/source required');
 const allocations=(await driver.api(route+'/network/allocations')).data.map(attrs),primary=allocations.find(a=>a.is_default);
 if(allocations.length!==4||allocations.filter(a=>a.is_default).length!==1||new Set(allocations.map(a=>a.port)).size!==4||JSON.stringify(allocations.map(a=>a.port).sort())!==JSON.stringify([...f.ports].sort()))throw Error('Exact owned four JC3MP allocations required');
 const queue=JSON.parse(await fs.readFile(resolve(driver.runtime,'queue.json'),'utf8'));if(queue.claims.some(c=>c.status==='active')||queue.installer_slot||queue.activation_pause?.validatorOutput!==out)throw Error('Existing exclusive campaign exclusion required');
 const archive=resolve(out,'jc3mp-root-preparation-'+Date.now());await fs.mkdir(archive);await fs.writeFile(resolve(archive,'before-report.json'),raw,{flag:'wx'});
 if(mode==='--prepare-native-resources'){
  if(f.canonicalBootstrap?.attemptedAt||f.diagnosticMemory?.confirmed||Number(a.limits.memory)!==1024)throw Error('Resource preparation requires initial canonical recommendation and no native attempt');
  const intent={uuid:f.server.uuid,before:a.limits,requested:{memory:0},canonicalReportSHA256:sha(raw),at:new Date().toISOString()};await fs.writeFile(resolve(archive,'resource-intent.json'),JSON.stringify(intent,null,2)+'\n',{flag:'wx'});
  await driver.api('/api/application/servers/'+f.server.id+'/build','PATCH',{memory:0});const after=attrs(await driver.api('/api/application/servers/'+f.server.id)).limits;
  await fs.writeFile(resolve(archive,'resource-readback.json'),JSON.stringify({before:a.limits,after},null,2)+'\n',{flag:'wx'});
  if(Number(after.memory)!==0||Object.keys(a.limits).some(k=>k!=='memory'&&JSON.stringify(a.limits[k])!==JSON.stringify(after[k])))throw Error('JC3MP memory release changed other limits');
  f.diagnosticMemory={confirmed:true,intent,before:a.limits,after,at:new Date().toISOString(),dockerUnlimitedStillRequiredAtEveryStart:true};
 }
 await fs.writeFile(reportPath,JSON.stringify({...report,fixture:f},null,2)+'\n');console.log(JSON.stringify({mode,fixture:f.server.uuid,archive,started:false,ledgerChanged:false}));
 }finally{await lease.close();await fs.unlink(resolve(out,'queue.lock'));}
}
