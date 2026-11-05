/** Default-controller setup only. Host authentication/game instances require a second fixture. */
import { resolve, dirname } from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { hash } from './runner.mjs';
export const CLUSTERIO_BUILD='f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
export const CLUSTERIO_SNAPSHOT=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-build-20261103-21/build-input-1793674979520');
export const clusterioIdentity=(id,build)=>['clusterio-canonical','clusterio-host-canonical'].includes(id)&&build===CLUSTERIO_BUILD;
export const clusterioRecipe='factorio/clusterio/egg-clusterio.json';
const pins={'.voltra/clusterio-start.mjs':'9836ea030a9070cc34c5c871075cc70e01f4a55a0e1f1828c7df82b4451e7c3c','.voltra/clusterio-setup.mjs':'138801ede639f619996563452fa5ab370e07149c01c352d9847cd0e33626a476','.voltra/clusterio-controller.mjs':'fe066393858f9ce7c1bc73bc28f44c2a3183e814d355fc1d1eb196d4957b76c5'};
const sorted=v=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
const scope='Canonical default controller setup/readonly exposure only; current native settings/retention and separate authenticated host/Factorio graph pending';
export function clusterioDefaultRules(variables,environment){
 if(environment.SERVER_MODE!=='controller'||environment.CONTROLLER_TOKEN!==''||environment.CONTROLLER_URL!=='')throw Error('Canonical Clusterio default controller without host credentials required');
 return variables.map(v=>({...v,rules:v.rules.replace(/required_if:environment\.SERVER_MODE,(controller|host)/g,(_,role)=>role==='controller'?'required':'nullable')}));
}
export function verifyClusterioPrior(ctx,report,raw,pin,frozen){
 const p=h.profileFromRuntime(clusterioRecipe,receipt);
 if(!clusterioIdentity(ctx.game.id,ctx.build)||receipt?.binary_sha256!==CLUSTERIO_BUILD||resolve(receipt.snapshot)!==CLUSTERIO_SNAPSHOT
  ||resolve(pin.path)!==resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/clusterio-live-acceptance.json')||pin.sha256!=='4a3b77a05e6bc4047d4528229369b0b0aee73bffa9da458782e874649ae1db65'||hash(raw)!==pin.sha256
  ||report.template!==clusterioRecipe||report.release!=='2.0.2'||report.factorio!=='2.0.77'||report.authenticated_host_registration!==true
  ||report.graceful_service_stop_exit_codes?.controller!==0||report.graceful_service_stop_exit_codes?.host!==0
  ||frozen?.nativeCurrentPending!==true||frozen.historicalSourceEquivalent!==false||frozen.canonicalRole!=='controller'||frozen.hostGraphPending!==true
  ||hash(JSON.stringify(sorted(p)))!==frozen.profileSHA256||hash(p.egg.scripts.installation.script)!==frozen.scriptSHA256)throw Error('Exact historical Clusterio/current-pending controller boundary required');
}
export function verifyClusterioExposure(body){
 if(!body.revision||!Array.isArray(body.fields))throw Error('Clusterio readonly document missing');
 const keys=['/controller.name','/controller.http_port','/controller.bind_address'];
 if(body.fields.length!==keys.length)throw Error('Clusterio opaque or credential fields exposed');
 for(const key of keys){const rows=body.fields.filter(f=>f.key===key);if(rows.length!==1||!(rows[0].readonly===true||rows[0].readOnly===true||rows[0].read_only===true))throw Error('Clusterio managed control must remain readonly: '+key);}
 return {managedReadonly:keys,writableNativeFields:[],scope};
}
const attrs=v=>v?.attributes??v;
async function identity(ctx){
 const f=ctx.fixture,p=h.profileFromRuntime(clusterioRecipe,receipt),s=attrs(await h.api('/api/application/servers/'+f.server.id));
 if(!clusterioIdentity(ctx.game.id,ctx.build)||receipt?.binary_sha256!==CLUSTERIO_BUILD||resolve(receipt.snapshot)!==CLUSTERIO_SNAPSHOT||!f.install?.callback?.success||f.install.rawExit!=='0'||!f.install.removed||!f.install.logsFollowed||!f.install.memoryValid||f.recipe!==clusterioRecipe||f.server.uuid!==s.uuid||s.name!=='validator-'+ctx.game.id||s.egg!==f.egg.id||Number(s.user)!==f.intent.ownerId||s.external_id!==f.intent.externalId||Number(s.node)!==f.intent.request.node_id||Number(s.node)===202||Number(s.limits?.memory)!==2048||s.container?.startup_command!=='exec node .voltra/clusterio-start.mjs'||p.egg.config.stop!=='^C'||s.container.image!==f.intent.request.image||f.intent.scriptHash!==hash(p.egg.scripts.installation.script))throw Error('Clusterio exact canonical controller identity differs');
 for(const variable of p.egg.variables){const value=String(variable.default_value);if(s.container.environment?.[variable.env_variable]!==value)throw Error('Clusterio canonical default differs: '+variable.env_variable);}
 const egg=attrs(await h.api('/api/admin/eggs/'+s.egg));if(egg.uuid!==f.egg.uuid||egg.script_install!==p.egg.scripts.installation.script||egg.config_stop!=='^C')throw Error('Clusterio canonical egg changed');
 return s;
}
export function clusterioKnownContainerGone(error,id){
 if(!/^[a-f0-9]{12,64}$/.test(id??''))return false;
 const match=String(error?.message??error).trim().match(/^(?:Docker inspect failed:\s*)?(?:Error(?: response from daemon)?:\s*)?No such (?:object|container):\s*([a-f0-9]{12,64})$/i);
 return !!match && match[1]===id;
}
async function container(ctx,{allowReplacement=false}={}){
 const f=ctx.fixture,ids=(await docker(['ps','-aq','--filter','name='+f.server.uuid],ctx.signal)).trim().split(/\s+/).filter(Boolean);if(!ids.length&&allowReplacement)return null;if(ids.length!==1)throw Error('Clusterio container/installer ambiguous');
 let inspected;try{inspected=await docker(['inspect',ids[0]],ctx.signal);}catch(error){if(allowReplacement&&clusterioKnownContainerGone(error,ids[0]))return null;throw error;}
 const [n]=JSON.parse(inspected);
 if(n.Name!=='/'+f.server.uuid||n.Config.Labels?.ContainerType!=='server_process'||n.Config.Image!==f.intent.request.image||n.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source==='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid).length!==1||n.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Clusterio owned volume boundary differs');return n;
}
async function observe(ctx,n){
 const script=String.raw`const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const r='/home/container',pins=${JSON.stringify(pins)};
function read(name,max=8388608){const p=path.join(r,name);for(let q=p;q!==path.dirname(r);q=path.dirname(q)){if(fs.lstatSync(q).isSymbolicLink())throw Error('symlink native state');}const s=fs.statSync(p);if(!s.isFile()||s.size>max)throw Error('invalid native state');return fs.readFileSync(p);}
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');for(const [name,pin]of Object.entries(pins))if(digest(read(name))!==pin)throw Error('frozen helper differs');
if(read('.voltra/clusterio-mode').toString()!=='controller\n')throw Error('wrong role');
const config=JSON.parse(read('config-controller.json')),packages={};for(const name of ['controller','host','ctl']){const p=JSON.parse(read('node_modules/@clusterio/'+name+'/package.json'));if(p.version!=='2.0.2')throw Error('wrong core package');packages[name]=p.version;}
const token=read('.voltra/admin-token.txt'),metadata=fs.statSync(path.join(r,'.voltra/admin-token.txt'));if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\s*$/.test(token.toString())||(metadata.mode&0o777)!==0o600)throw Error('private token missing/permissions differ');
if(config['controller.name']!=='Your Cluster'||config['controller.bind_address']!=='0.0.0.0'||config['controller.http_port']!==${ctx.fixture.allocation.port}||config['controller.default_mod_pack_id']===null)throw Error('default controller settings differ');
if(read('.voltra/clusterio-controller-initialized').toString()!=='2.0.2\n')throw Error('bootstrap incomplete');
console.log(JSON.stringify({helpers:pins,packages,role:'controller',nodeVersion:process.version,configSHA256:digest(read('config-controller.json')),lockSHA256:digest(read('package-lock.json',33554432)),privateAdminTokenPresent:true,tokenMode:'0600',defaultModPackSelected:true,settings:{name:config['controller.name'],port:config['controller.http_port'],bind:config['controller.bind_address']}}));`;
 const source='/var/lib/voltra-parity-20261029/volumes/'+ctx.fixture.server.uuid;
 const args=n.State.Running?['exec',n.Id,'node','-e',script]:['run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,src='+source+',dst=/home/container,readonly','--entrypoint','node',n.Image,'-e',script];
 const proof=JSON.parse(await docker(args,ctx.signal,30000));if(!/^v24\./.test(proof.nodeVersion))throw Error('Reviewed Node24 runtime required');return proof;
}
export async function verifyClusterioBootstrapRecovery(ctx,n,prior){
 const f=ctx.fixture,pin=ctx.game.canonicalBootstrapRecovery;
 const used=new Set((f.canonicalBootstrapRecoveryHistory??[]).map(x=>x.sha256));if(f.canonicalBootstrapRecoveryUsed?.sha256)used.add(f.canonicalBootstrapRecoveryUsed.sha256);
 if(!prior?.attemptedAt||prior.complete||!pin?.path||!/^[a-f0-9]{64}$/.test(pin.sha256??'')||used.has(pin.sha256)||!clusterioIdentity(ctx.game.id,ctx.build))throw Error('Reviewed single-use Clusterio bootstrap recovery required');
 const path=resolve(pin.path),ownedDirectory=resolve(ctx.output,ctx.game.id);
 if(dirname(path)!==ownedDirectory||!path.endsWith('.json'))throw Error('Clusterio recovery receipt path differs');
 const info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||info.size>1048576)throw Error('Invalid Clusterio recovery receipt');
 const raw=await readFile(path,'utf8');if(hash(raw)!==pin.sha256)throw Error('Clusterio recovery receipt hash changed');
 const recovery=JSON.parse(raw),originalPath=recovery.originalReportPath?resolve(recovery.originalReportPath):resolve(dirname(path),'bootstrap-before-recovery21.json');
 if(dirname(originalPath)!==ownedDirectory||!originalPath.endsWith('.json')||originalPath===path)throw Error('Original Clusterio failure path differs');
 const originalInfo=await lstat(originalPath);if(originalInfo.isSymbolicLink()||!originalInfo.isFile()||originalInfo.size>8388608)throw Error('Invalid original Clusterio failure receipt');
 const originalRaw=await readFile(originalPath,'utf8'),original=JSON.parse(originalRaw);
 if(hash(originalRaw)!==recovery.originalReportSHA256||!['UNSAFE','FAIL'].includes(original.status)||original.build!==ctx.build||original.game!==ctx.game.id||original.fixture?.server?.uuid!==f.server.uuid||JSON.stringify(sorted(original.fixture.canonicalBootstrap))!==JSON.stringify(sorted(prior)))throw Error('Original Clusterio attempt/failure changed');
 if(recovery.build!==ctx.build||recovery.uuid!==f.server.uuid||recovery.id!==f.server.id||recovery.attemptedAt!==prior.attemptedAt||recovery.offline!==true||recovery.exitCode!==0||recovery.retryAuthorized!==true||recovery.containerId!==n.Id
  ||!recovery.before||recovery.before.StartedAt!==recovery.after?.StartedAt||(!recovery.before.Running&&JSON.stringify(sorted(recovery.before))!==JSON.stringify(sorted(recovery.after)))||JSON.stringify(sorted(recovery.after))!==JSON.stringify(sorted(n.State))
  ||n.State.Running||n.State.ExitCode!==0||n.State.OOMKilled||n.State.Dead||n.State.Status!=='exited'||!Number.isFinite(Date.parse(n.State.StartedAt))||Date.parse(n.State.StartedAt)<Date.parse(prior.attemptedAt)||!Number.isFinite(Date.parse(n.State.FinishedAt))||Date.parse(n.State.FinishedAt)<Date.parse(n.State.StartedAt))throw Error('Exact recovered stopped Clusterio generation/authorization differs');
 return {path,sha256:pin.sha256,originalReportSHA256:recovery.originalReportSHA256,previousAttempt:prior,containerId:n.Id,startedAt:n.State.StartedAt,finishedAt:n.State.FinishedAt,exitCode:0,singleUse:true};
}
export function clusterioDocumentMarkers(html){
 return {htmlRoot:/<html(?:\s|>)/i.test(html),defaultTitle:/<title>\s*Your Cluster\s*<\/title>/i.test(html),appRoot:/<[^>]+\bid=["']root["']/i.test(html),scriptBundle:/<script\b[^>]*\bid=["']script-bundle["']/i.test(html)};
}
export async function runClusterioCanonicalBoot(ctx){
 await identity(ctx);let n=await container(ctx);if(n.State.Running)throw Error('Stopped Clusterio bootstrap required');
 const prior=ctx.fixture.canonicalBootstrap,recovery=prior?.attemptedAt?await verifyClusterioBootstrapRecovery(ctx,n,prior):null;
 if(!prior?.attemptedAt&&(ctx.fixture.canonicalBootstrapRecovery||ctx.game.canonicalBootstrapRecovery))throw Error('Clusterio recovery has no original attempt');
 const before=await observe(ctx,n),started=Date.now(),attemptedAt=new Date(started).toISOString();await ctx.own({...ctx.fixture,...(recovery?{canonicalBootstrapRecoveryHistory:[...(ctx.fixture.canonicalBootstrapRecoveryHistory??[]),...(ctx.fixture.canonicalBootstrapRecoveryUsed?[ctx.fixture.canonicalBootstrapRecoveryUsed]:[])],canonicalBootstrapRecoveryUsed:{sha256:recovery.sha256,attemptedAt}}:{}),canonicalBootstrap:{attemptedAt,role:'controller',scope,...(recovery?{recovery}:{})}});
 const route='/api/client/servers/'+ctx.fixture.server.uuid;
 const until=async(fn,label,ms=120000)=>{const end=Date.now()+ms;while(Date.now()<end){ctx.signal.throwIfAborted();const x=await fn();if(x)return x;await new Promise(r=>setTimeout(r,500));}throw Error('Clusterio bootstrap timeout: '+label);};
 let observed;
 const park=async()=>{await identity(ctx);const current=await container(ctx);if(!observed||current.Id!==observed.Id||current.State.StartedAt!==observed.State.StartedAt)throw Error('Clusterio observed start changed');if(current.State.Running)await h.api(route+'/power','POST',{signal:'stop'});return until(async()=>{const x=await container(ctx);if(x.Id!==observed.Id||x.State.StartedAt!==observed.State.StartedAt)throw Error('Clusterio container replaced during stop');if(x.State.Running)return false;if(x.State.ExitCode!==0||x.State.OOMKilled||x.State.Dead||Date.parse(x.State.FinishedAt)<Date.parse(x.State.StartedAt))throw Error('Clusterio bootstrap clean exit0 absent');return {containerId:x.Id,startedAt:x.State.StartedAt,finishedAt:x.State.FinishedAt,exitCode:0};},'controller native stop');};
 try{
  await h.api(route+'/power','POST',{signal:'start'});
  const ready=await until(async()=>{const x=await container(ctx,{allowReplacement:true});if(!x)return false;if(!x.State.Running){if(Date.parse(x.State.StartedAt)>=started)throw Error('Clusterio controller exited before readiness');return false;}if(!Number.isFinite(Date.parse(x.State.StartedAt)))throw Error('Clusterio running generation lacks valid start boundary');if(Date.parse(x.State.StartedAt)<started)return false;if(observed&&(x.Id!==observed.Id||x.State.StartedAt!==observed.State.StartedAt))throw Error('Clusterio bootstrap restarted');observed=x;const text=await docker(['logs','--since',x.State.StartedAt,x.Id],ctx.signal,10000);if(!text.includes('Started '))return false;
   const response=await fetch('http://127.0.0.1:'+ctx.fixture.allocation.port+'/',{redirect:'error',signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(5000)])});
   const http={status:response.status,contentType:String(response.headers.get('content-type')??'').slice(0,128),declaredBytes:Number(response.headers.get('content-length')??'0'),authenticated:false};
   await ctx.artifact('clusterio-bootstrap-http.json',http);
   if(response.status!==200)throw Error('Clusterio default controller HTTP not200');
   if(http.declaredBytes>1048576)throw Error('Clusterio public document oversized');
   const reader=response.body.getReader();let chunks=[],total=0;try{while(true){const part=await reader.read();if(part.done)break;total+=part.value.length;if(total>1048576){await ctx.artifact('clusterio-bootstrap-http.json',{...http,observedBytes:total,oversized:true});throw Error('Clusterio public document oversized');}chunks.push(Buffer.from(part.value));}}finally{await reader.cancel();}
   const html=Buffer.concat(chunks).toString('utf8'),markers=clusterioDocumentMarkers(html),metadata={...http,bytes:total,documentSHA256:hash(html),markers};
   await ctx.artifact('clusterio-bootstrap-http.json',metadata);
   if(!Object.values(markers).every(Boolean))throw Error('Clusterio public controller document missing');
   return {containerId:x.Id,startedAt:x.State.StartedAt,logSHA256:hash(text),marker:'Started ',http:metadata};},'default controller readiness');
  const parking=await park();n=await container(ctx);const after=await observe(ctx,n);const proof={...ctx.fixture.canonicalBootstrap,before,after,ready,parking,complete:true,hostGraphProven:false,nativeLifecycleAcceptance:false};await ctx.own({...ctx.fixture,canonicalBootstrap:proof});return proof;
 }catch(error){
  const failure={message:String(error.message),scope};await ctx.artifact('clusterio-bootstrap-failure.json',failure);
  if(observed){
   try{const safePark=await park();await ctx.artifact('clusterio-bootstrap-safe-park.json',safePark);await ctx.own({...ctx.fixture,canonicalBootstrap:{...ctx.fixture.canonicalBootstrap,failure,safePark,complete:false}});}
   catch(parkingError){await ctx.artifact('clusterio-bootstrap-parking-failure.json',{originalFailure:failure.message,parkingFailure:String(parkingError.message)});throw Error(failure.message+'; safe parking failed: '+parkingError.message);}
  }
  throw error;
 }
}
