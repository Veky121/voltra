/** Dedicated two-fixture adapter. Importing has no runtime side effects.
 * A singleton pair manifest and immutable canonical archives are mandatory. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { campaign as h, receipt, docker, settings } from './campaign-session.mjs';
import * as campaignAdapter from './campaign-adapter.mjs';
import { client } from './api-adapter.mjs';
import * as hooks from './clusterio-checks.mjs';
const recipe='factorio/clusterio/egg-clusterio.json';
export const build='f78390ea7a4ab8d11352ba1698255879ddf46794a84545a792a1249ad31e4b45';
export const helpers={'.voltra/clusterio-start.mjs':'9836ea030a9070cc34c5c871075cc70e01f4a55a0e1f1828c7df82b4451e7c3c','.voltra/clusterio-setup.mjs':'138801ede639f619996563452fa5ab370e07149c01c352d9847cd0e33626a476','.voltra/clusterio-controller.mjs':'fe066393858f9ce7c1bc73bc28f44c2a3183e814d355fc1d1eb196d4957b76c5'};
const sha=x=>createHash('sha256').update(x).digest('hex');
const uuid=x=>/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x??'');
const main=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go');
export async function canonicalPair(contract){
 if(contract?.build!==build||!Number.isSafeInteger(contract.hostId)||contract.hostId<0||contract.hostId>2147483647)throw Error('Exact candidate21 and bounded publisher host ID required');
 const accepted=[];
 for(const [role,id]of [['controller','clusterio-canonical'],['host','clusterio-host-canonical']]){
  const pin=contract[role],expected=resolve(main,'artifacts/game-parity-20261029/validator-20261103-'+id+'/report.json');
  if(!pin||resolve(pin.path??'')!==expected||!/^[a-f0-9]{64}$/.test(pin.sha256??'')||!uuid(pin.uuid))throw Error('Exact archived '+role+' canonical pin required');
  const raw=await readFile(expected),report=JSON.parse(raw),f=report.fixture;
  if(sha(raw)!==pin.sha256||report.status!=='PASS'||report.game!==id||report.build!==build||f?.recipe!==recipe||f.server?.uuid!==pin.uuid||f.server.name!=='validator-'+id||f.intent?.build!==build||f.intent.request.environment.SERVER_MODE!=='controller'||f.intent.request.node_id===202||!f.intent.externalId||!f.egg?.uuid)throw Error('Immutable default-controller canonical archive differs: '+role);
  for(const check of ['served-game-settings','preserved-offline'])if(report.checks?.filter(c=>c.name===check&&c.status==='PASS').length!==1)throw Error('Missing canonical setup check: '+check);
  accepted.push({role,id,uuid:pin.uuid,serverId:f.server.id,eggId:f.egg.id,eggUUID:f.egg.uuid,owner:f.intent.ownerId,node:f.intent.request.node_id,externalId:f.intent.externalId,image:f.intent.request.image,canonicalSHA256:pin.sha256});
 }
 if(accepted[0].uuid===accepted[1].uuid||accepted[0].serverId===accepted[1].serverId||accepted[0].owner!==accepted[1].owner||accepted[0].node!==accepted[1].node)throw Error('Distinct isolated pair with same owner/node required');
 return {build,hostId:contract.hostId,fixtures:accepted,helpers,typedWriteProven:false,playerClaim:false,factorioInstanceClaim:false};
}

// Caller executes only after exact source/hash/UUID/lease/park verification.
// Output is JSON hash/size/path metadata, never a token or captured CLI output.
// Publisher CLI evidence: cached @clusterio/create2.0.2 create.js:837 and frozen
// clusterio-setup.mjs's node_modules/@clusterio/controller/dist/node/controller.js.
export function privateHostTokenProgram(hostId){
 if(!Number.isSafeInteger(hostId)||hostId<0||hostId>2147483647)throw Error('Invalid host ID');
 return `import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root=process.cwd(),id=${hostId},name='.voltra/validator-clusterio-host-token-'+id+'.txt',file=path.resolve(name);
for(const name of ['.voltra','config-controller.json','node_modules/@clusterio/controller/dist/node/controller.js']){let p=path.resolve(name);while(p!==root){if(fs.lstatSync(p).isSymbolicLink())throw Error('Symlink token authority');p=path.dirname(p);}}
const pkg=JSON.parse(fs.readFileSync('node_modules/@clusterio/controller/package.json'));if(pkg.version!=='2.0.2')throw Error('Publisher version differs');
if(fs.existsSync(file))throw Error('Prior private token file exists; explicit owned retry review required');
const result=spawnSync(process.execPath,['node_modules/@clusterio/controller/dist/node/controller.js','bootstrap','generate-host-token',String(id)],{encoding:'utf8',stdio:'pipe',timeout:30000,maxBuffer:1048576});
if(result.error||result.status!==0)throw Error('Publisher private host-token CLI failed');
const matches=result.stdout.trim().split(/\\s+/).filter(x=>/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(x));if(matches.length!==1)throw Error('Private CLI token missing/ambiguous');
const token=matches[0],payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(payload.aud!=='host'||payload.host!==id)throw Error('Wrong native token audience');
fs.writeFileSync(file,token+'\\n',{flag:'wx',mode:0o600});const st=fs.statSync(file);if((st.mode&0o777)!==0o600||fs.readFileSync(file,'utf8')!==token+'\\n')throw Error('Private token readback differs');
console.log(JSON.stringify({file:name,hostId:id,sha256:createHash('sha256').update(token).digest('hex'),mode:st.mode&0o777,uid:st.uid,gid:st.gid}));`;
}

export function privateHostTokenReuseProgram(hostId,expectedSHA){
 if(!Number.isSafeInteger(hostId)||hostId<0||! /^[a-f0-9]{64}$/.test(expectedSHA??''))throw Error('Exact prior private token pin required');
 return `import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const root=process.cwd(),id=${hostId},name='.voltra/validator-clusterio-host-token-'+id+'.txt',file=path.resolve(name);
for(let p=file;p!==root;p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw Error('Symlink token reuse refused');
const st=fs.statSync(file),owner=fs.statSync('config-controller.json');if(!st.isFile()||(st.mode&511)!==384||st.uid!==owner.uid||st.gid!==owner.gid||st.size>16384)throw Error('Private token ownership/mode differs');
const raw=fs.readFileSync(file,'utf8'),token=raw.trim();if(raw!==token+'\\n'||! /^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(token)||createHash('sha256').update(token).digest('hex')!==${JSON.stringify(expectedSHA)})throw Error('Exact previous token bytes differ');
const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));if(payload.aud!=='host'||payload.host!==id)throw Error('Wrong previous token audience');
console.log(JSON.stringify({file:name,hostId:id,sha256:${JSON.stringify(expectedSHA)},mode:st.mode&511,uid:st.uid,gid:st.gid,reused:true}));`;
}
async function retryEvidence(contract,hostUUID,controllerUUID){
 const pin=contract.retry;if(!pin)return null;
 if(pin.sha256!=='6b8f0aabf055c8312e30973bd79581a91a49d8e3aca48ffd9088fb414d942b75')throw Error('Only exact reviewed pre-secret-readback failure retry allowed');
 const raw=await readFile(pin.path),report=JSON.parse(raw);if(sha(raw)!==pin.sha256||report.status!=='FAIL'||report.build!==build||report.fixture?.server?.uuid!==hostUUID||report.checks?.some(c=>c.name==='canonical-install-retry'))throw Error('Reviewed stopped pre-reinstall failure differs');
 const token=report.checks?.filter(c=>c.name==='pair-private-token'&&c.status==='PASS');if(token?.length!==1)throw Error('Previous private token PASS required');
 const value=token[0].evidence,expected='f1f8b2ac61e7cec3bf33d485d91414fd06ceb467b13dce9e60c724018a7c0775';
 if(value.hostId!==contract.hostId||value.hostId!==291||value.file!=='.voltra/validator-clusterio-host-token-291.txt'||value.sha256!==expected||value.mode!==384||value.uid!==988||value.gid!==988)throw Error('Previous exact token identity differs');
 const intentRaw=await readFile(pin.startupIntent.path),intent=JSON.parse(intentRaw);if(sha(intentRaw)!==pin.startupIntent.sha256||intent.uuid!==hostUUID||intent.controllerUUID!==controllerUUID||intent.hostId!==291||intent.tokenSHA256!==expected||intent.role!=='host'||intent.requiresCanonicalReinstall!==true)throw Error('Exact previous private host startup intent required');
 return {token:value,reportSHA256:pin.sha256,startupIntentSHA256:pin.startupIntent.sha256};
}

export function registrationProof(text,hostId){
 if(!Number.isSafeInteger(hostId)||hostId<0)throw Error('Invalid host ID');
 const clean=text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'');
 const found=clean.match(new RegExp('(?:^|\\n)[^\\r\\n]*WsServer \\| registered host '+hostId+' using version 2\\.0\\.2(?:\\r?\\n|$)','g'));
 if(!found?.length)throw Error('Fresh native controller host-registration marker absent');
 return {hostId,version:'2.0.2',freshLogSHA256:sha(text),authenticatedHostRegistration:true,playerClaim:false};
}

export const executionPlan=[
 'Acquire one dedicated pair lease covering exactly both UUIDs; reject ordinary single-fixture pool contexts.',
 'Verify immutable canonical PASS archives, active build21, owner/node/externalID/egg/image/source hashes and both actual stopped process states; record identities.',
 'Start controller with existing exact source; observe fresh native Node child, allocated HTTP and readonly controls; preserve its startedAt and log boundary.',
 'Generate host-audience token using privateHostTokenProgram only after source review; keep private0600 file, record SHA only. Never serialize token/startup environment.',
 'Update second owned fixture Startup to SERVER_MODE=host, private controller URL/token and explicit host name; immediately verify privately without returning token.',
 'Run standard guarded gated canonical installer/reinstall for second fixture with owned gateUUID, serialized installer slot, durable intent/callback/exit/readback/parking receipts: startup helper REFUSES role changes without reinstall. Preserve original canonical archive and new installer callbacks/exit0; verify modehost/config/pkg/helpers and Factorio2.0.77 archive pin.',
 'Start host while controller remains running; prove exact native Node parent/child/executable/config and fresh controller registered-host2.0.2 marker after recorded boundary.',
 'Gracefully stop host, require native savingconfig plus actual child exit0; snapshot complete config/state/token hashes and metadata offline with readonly immutable helper. Refuse symlinks.',
 'Reload host while same verified controller remains up; require fresh registration and retained host ID/config/state identity; stop host cleanly again.',
 'Stop controller last; require native savingdata and actual child exit0; snapshot config/database persistence. No Factorio instance, player or gameplay assertion.',
 'On every error: persist original failure before cleanup, verify each UUID identity, stop host first/controller last, require strict offline native receipts for BOTH. Report cleanup failure separately and retain ownership.'
];
const network={name:'voltra-parity-20261029',id:'a2a8c64f27e93a5a68e0b96e4e7ec09c204349fc4f9999940babb9d51206f9dd'};
async function networkIdentity(context,expected){
 await exactIdentity(context);const uuid=context.fixture.server.uuid,[container]=JSON.parse(await docker(['inspect',uuid],context.signal));
 const rows=container.NetworkSettings?.Networks,entry=rows?.[network.name];
 if(container.Name!=='/'+uuid||Object.keys(rows??{}).length!==1||entry?.NetworkID!==network.id||!entry.DNSNames?.includes(uuid)||expected&&(container.Id!==expected.containerId||container.State.StartedAt!==expected.startedAt||!container.State.Running))throw Error('Exact paired private network/container/DNS identity differs');
 return {uuid,containerId:container.Id,startedAt:container.State.StartedAt,running:container.State.Running,networkName:network.name,networkId:network.id,dnsName:uuid};
}
const pairContexts=new WeakMap();
const attrs=x=>x?.attributes??x;
async function exactIdentity(context){
 const f=context.fixture,s=attrs(await h.api('/api/application/servers/'+f.server.id));
 if(s.uuid!==f.server.uuid||s.name!==f.server.name||s.egg!==f.egg.id||Number(s.user)!==f.intent.ownerId||Number(s.node)!==f.intent.request.node_id||s.external_id!==f.intent.externalId||s.container.image!==f.intent.request.image||s.container.startup_command!=='exec node .voltra/clusterio-start.mjs')throw Error('Exact paired fixture identity differs; untouched');
 const egg=attrs(await h.api('/api/admin/eggs/'+s.egg));if(egg.uuid!==f.egg.uuid)throw Error('Paired canonical egg UUID differs');return s;
}
function runtime(context){const s=context.fixture.server;Object.assign(context.game,{base:'http://127.0.0.1:18099',serverId:s.id,serverUUID:s.uuid,nodeId:context.fixture.intent.request.node_id,expectedName:s.name,checksModule:resolve('tools/runtime/validator/clusterio-checks.mjs')});}
export async function verify(ctx){
 if(receipt?.binary_sha256!==build||ctx.build!==build||settings.games?.length!==1||settings.games[0].id!==ctx.game.id||ctx.game.id!=='clusterio-host-canonical'||ctx.game.family!=='clusterio'||ctx.game.peakMiB<3072||ctx.game.retentionOnly)throw Error('Standalone one-host-alias pair manifest and combined3072MiB reserve required');
 const contract=ctx.game.clusterioPair,pair=await canonicalPair(contract);
 const host=JSON.parse(await readFile(contract.host.path,'utf8')).fixture,controller=JSON.parse(await readFile(contract.controller.path,'utf8')).fixture;
 if(ctx.fixture?.server&&ctx.fixture.server.uuid!==host.server.uuid)throw Error('Previously owned pair host differs');
 await ctx.own(ctx.fixture?.server?ctx.fixture:host);runtime(ctx);
 const controllerCtx={...ctx,fixture:controller,game:{...ctx.game,id:'clusterio-canonical',clusterioRole:'controller',refreshInstaller:false},check:(name,fn)=>ctx.check('pair-controller-'+name,fn),own:async f=>{controllerCtx.fixture=f;await ctx.artifact('clusterio-pair-controller-owned.json',f);}};
 runtime(controllerCtx);await exactIdentity(ctx);await exactIdentity(controllerCtx);
 if(await client(ctx).state()!=='offline'||await client(controllerCtx).state()!=='offline')throw Error('Both paired fixtures must initially be stopped');
 const profile=h.profileFromRuntime(recipe,receipt),script=profile.egg.scripts.installation.script.replaceAll('\r\n','\n');
 // Exact generated helper hashes are verified by prerequisites; reject shell
 // tracing/credential echo before the token can enter an installer environment.
 if(!script.startsWith('#!/bin/bash\nset -euo pipefail\n')||/set\s+-[^\n]*x|(?:echo|console\.log)\([^\n]*CONTROLLER_TOKEN/.test(script))throw Error('Clusterio installer secret-output review differs');
 const networks=await Promise.all([networkIdentity(ctx),networkIdentity(controllerCtx)]);
 const retry=await retryEvidence(contract,host.server.uuid,controller.server.uuid);
 pairContexts.set(ctx.game,{controllerCtx,contract,pair,networks,retry});await campaignAdapter.verify(ctx);
 return {fixtures:pair.fixtures,typedWriteProven:false,scope:'Dedicated two-fixture idle authenticated host registration; no Factorio instances or players'};
}
export async function park(ctx){
 const pair=pairContexts.get(ctx.game);if(!pair)throw Error('Pair ownership not verified; no arbitrary cleanup');
 const results=[],errors=[];
 for(const context of [ctx,pair.controllerCtx]){
  try{const cleanup={...context,signal:new AbortController().signal};await exactIdentity(cleanup);const parked=await campaignAdapter.park(cleanup);const n=await campaignAdapter.native(cleanup);if(!parked.offline||n?.state.Running)throw Error('Pair fixture still running');results.push({uuid:context.fixture.server.uuid,offline:true,native:n?.state});}catch(e){errors.push(String(e.message));}
 }
 await ctx.artifact('clusterio-pair-parking-'+Date.now()+'.json',{results,errors});if(errors.length)throw Error('Paired cleanup incomplete: '+errors.join('; '));return {offline:true,fixtures:results};
}
export async function run(ctx){
 const pair=pairContexts.get(ctx.game);if(!pair)throw Error('Call verified pair adapter first');const controller=pair.controllerCtx,cc=client(controller),originalReserve=ctx.reserve;let failure;
 const floor=Math.max(3072,ctx.game.peakMiB);const aggregateReserve=async mib=>{if(!Number.isFinite(mib)||mib<0)throw Error('Invalid paired reservation');return originalReserve(Math.max(floor,mib));};ctx.reserve=aggregateReserve;controller.reserve=aggregateReserve;
 await ctx.artifact('clusterio-pair-reservation.json',{minimumMiB:floor,hostInstallerRequestedMiB:ctx.game.installPeakMiB??ctx.game.peakMiB,scope:'Aggregate reservation floor retained through host reinstall/lifecycle and both parking receipts'});
 try{
  await ctx.reserve(ctx.game.peakMiB);await ctx.check('pair-controller-prerequisites',()=>hooks.prerequisites(controller,cc));
  controller.startRequestedAt=Date.now();await cc.power('start');const ready=await ctx.check('pair-controller-ready',()=>campaignAdapter.wait(controller,()=>hooks.ready(controller,cc),'Paired controller readiness',180000));
  const before=await hooks.observeState(controller),native=await campaignAdapter.native(controller);
  const tokenMeta=await ctx.check('pair-private-token',async()=>{
   await exactIdentity(controller);const raw=await docker(['exec','-w','/home/container',native.id,'node','--input-type=module','-e',pair.retry?privateHostTokenReuseProgram(pair.contract.hostId,pair.retry.token.sha256):privateHostTokenProgram(pair.contract.hostId)],ctx.signal,45000);const result=JSON.parse(raw);
   if(result.hostId!==pair.contract.hostId||result.mode!==384||!/^[a-f0-9]{64}$/.test(result.sha256))throw Error('Private token metadata differs');return result;
  });
  const token=(await cc.read('/'+tokenMeta.file)).trim();if(sha(token)!==tokenMeta.sha256)throw Error('Private token hash readback differs');
  const input=pair.contract.hostStartup,url=new URL(input?.CONTROLLER_URL??'');
  if(url.protocol!=='http:'||url.hostname!==controller.fixture.server.uuid||url.username||url.password||url.search||url.hash||url.pathname!=='/'||Number(url.port)!==controller.fixture.ports[0]||!input.HOST_NAME)throw Error('Exact controller UUID DNS/private-network endpoint required');
  const networkProof=await Promise.all([networkIdentity(ctx),networkIdentity(controller,{containerId:native.id,startedAt:ready.startedAt})]);
  if(networkProof[0].running)throw Error('Host must remain stopped before private role mutation');
  await ctx.artifact('clusterio-pair-private-network.json',{network,fixtures:networkProof,controllerURL:url.href});

  const environment={SERVER_MODE:'host',HOST_NAME:input.HOST_NAME,CONTROLLER_URL:url.href,CONTROLLER_TOKEN:token,LOG_LEVEL:'info',PLUGINS:''};
  await ctx.artifact('clusterio-pair-host-startup-intent.json',{uuid:ctx.fixture.server.uuid,controllerUUID:controller.fixture.server.uuid,controllerURL:url.href,hostId:pair.contract.hostId,tokenSHA256:tokenMeta.sha256,role:'host',requiresCanonicalReinstall:true});
  await exactIdentity(ctx);await h.api('/api/application/servers/'+ctx.fixture.server.id+'/startup','PATCH',{environment});const actual=await exactIdentity(ctx);
  if(Object.entries(environment).filter(([k])=>k!=='CONTROLLER_TOKEN').some(([k,v])=>actual.container.environment[k]!==v)||actual.container.environment.CONTROLLER_TOKEN!=='[global integration]')throw Error('Private host startup nonsecret/integration placeholder readback differs');
  const startup=await h.api('/api/client/servers/'+ctx.fixture.server.uuid+'/startup'),variables=startup.data?.map(x=>x.attributes??x),secret=variables?.filter(v=>v.env_variable==='CONTROLLER_TOKEN');
  if(secret?.length!==1||secret[0].secret!==true||secret[0].configured!==true||secret[0].secret_configured!==true||secret[0].server_value!==''||secret[0].default_value!=='')throw Error('Native host Startup secret configured authority absent');
  ctx.clusterioExpectedTokenSHA256=tokenMeta.sha256;
  await ctx.artifact('clusterio-pair-host-startup-readback.json',{uuid:ctx.fixture.server.uuid,tokenSHA256:tokenMeta.sha256,integrationPlaceholder:true,secretConfigured:true,retry:pair.retry??null});
  Object.assign(ctx.game,{clusterioRole:'host',clusterioHostId:pair.contract.hostId,clusterioController:{uuid:controller.fixture.server.uuid},refreshInstaller:true});
  ctx.clusterioPeer={uuid:controller.fixture.server.uuid,serverId:controller.fixture.server.id,name:controller.fixture.server.name,eggId:controller.fixture.egg.id,owner:controller.fixture.intent.ownerId,node:controller.fixture.intent.request.node_id,containerId:native.id,startedAt:ready.startedAt,logBoundary:await docker(['logs','--since',ready.startedAt,native.id],ctx.signal)};
  // Existing canonical install lacks canonicalScriptSha256; the shared adapter
  // acquires an installer slot and uses its exact owned gate/callback receipts.
  if(ctx.fixture.install?.canonicalScriptSha256===h.digest(h.profileFromRuntime(recipe,receipt).egg.scripts.installation.script))throw Error('Host retry requires explicit reviewed install-role receipt; no unconditional reinstall');
  await campaignAdapter.run(ctx);
  await networkIdentity(controller,{containerId:native.id,startedAt:ready.startedAt});await networkIdentity(ctx);
  await ctx.check('pair-controller-stop',async()=>{await exactIdentity(controller);await cc.power('stop');await campaignAdapter.wait(controller,async()=>await cc.state()==='offline','Paired controller stop',90000);const stop=await hooks.cleanStop(controller,cc),after=await hooks.observeState(controller);if(before.configSHA256!==after.configSHA256)throw Error('Controller configuration changed during host loop');return {...stop,configRetained:true};});
 }catch(e){failure=e;await ctx.artifact('clusterio-pair-original-error-'+Date.now()+'.json',{error:String(e.message),at:new Date().toISOString()});}
 let cleanup;try{cleanup=await park(ctx);}catch(e){if(failure)throw new AggregateError([failure,e],'Pair operation and cleanup failed');throw e;}ctx.reserve=originalReserve;controller.reserve=originalReserve;if(failure)throw failure;return {parked:cleanup,typedWriteProven:false,authenticatedHostGate:true,playerClaim:false,factorioInstanceClaim:false};
}
