/** Dedicated paired canonical-reinstall retention; importing performs no work. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { campaign as h, receipt, docker, settings } from './campaign-session.mjs';
import * as campaignAdapter from './campaign-adapter.mjs';
import { client } from './api-adapter.mjs';
import * as hooks from './clusterio-checks.mjs';
import { retryBuild, verifyRetry22 } from './clusterio-retention-retry22.mjs';
import { canonicalPair, build, privateHostTokenReuseProgram } from './clusterio-pair-check.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex'),contexts=new WeakMap();
const attrs=x=>x?.attributes??x;
async function identity(ctx){const f=ctx.fixture,s=attrs(await h.api('/api/application/servers/'+f.server.id));if(s.uuid!==f.server.uuid||s.name!==f.server.name||s.egg!==f.egg.id||s.external_id!==f.intent.externalId||Number(s.node)!==f.intent.request.node_id||Number(s.user)!==f.intent.ownerId||s.container.image!==f.intent.request.image||s.container.startup_command!=='exec node .voltra/clusterio-start.mjs')throw Error('Exact retained Clusterio fixture identity differs');const e=attrs(await h.api('/api/admin/eggs/'+s.egg));if(e.uuid!==f.egg.uuid)throw Error('Retained egg UUID differs');return s;}
function runtime(ctx){const s=ctx.fixture.server;Object.assign(ctx.game,{serverUUID:s.uuid,serverId:s.id,nodeId:ctx.fixture.intent.request.node_id,expectedName:s.name,base:'http://127.0.0.1:18099',checksModule:resolve('tools/runtime/validator/clusterio-checks.mjs'),retentionOnly:true});}
async function stopped(ctx,proof){await identity(ctx);const n=await campaignAdapter.native(ctx);if(!proof?.engine?.direct||proof.engineNumericExit!==0||proof.engineExitProven!==true||!n||n.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await client(ctx).state()!=='offline')throw Error('Current native stopped identity differs from pinned pair proof');return n;}
export async function verify(ctx){
 const contract=ctx.game.clusterioRetention;
 if(ctx.game.id!=='clusterio-host-canonical'||ctx.game.family!=='clusterio'||settings.games?.length!==1||settings.games[0].id!==ctx.game.id||ctx.game.peakMiB<3072||![build,retryBuild].includes(ctx.build)||receipt?.binary_sha256!==ctx.build||!contract)throw Error('Dedicated candidate21 paired retention manifest required');
 const pair=await canonicalPair(contract.canonical),pin=contract.pairEvidence,expected=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-20261103-clusterio-host-canonical/lifecycle.json');
 if(resolve(pin?.path??'')!==expected||!/^[a-f0-9]{64}$/.test(pin.sha256??''))throw Error('Immutable actual paired lifecycle archive required');
 const raw=await readFile(expected),report=JSON.parse(raw);if(sha(raw)!==pin.sha256||report.status!=='PASS'||report.build!==build||report.fixture?.server?.uuid!==contract.canonical.host.uuid)throw Error('Paired lifecycle archive differs');
 const evidence=name=>{const checks=report.checks?.filter(c=>c.name===name&&c.status==='PASS');if(checks?.length!==1)throw Error('Exact paired PASS check missing: '+name);return checks[0].evidence;};
 let controllerProof=evidence('pair-controller-stop');const hostProof=evidence('reload').stop,token=evidence('pair-private-token');
 if(token.hostId!==contract.canonical.hostId||token.mode!==384||!/^[a-f0-9]{64}$/.test(token.sha256??''))throw Error('Pinned private token identity missing');
 const originalController=JSON.parse(await readFile(contract.canonical.controller.path,'utf8')).fixture;
 if(ctx.fixture?.server&&ctx.fixture.server.uuid!==report.fixture.server.uuid)throw Error('Previously retained fixture differs');
 await ctx.own(ctx.fixture?.server?ctx.fixture:report.fixture);Object.assign(ctx.game,{clusterioRole:'host',clusterioHostId:token.hostId,clusterioController:{uuid:originalController.server.uuid}});ctx.clusterioExpectedTokenSHA256=token.sha256;runtime(ctx);
 const controller={...ctx,fixture:originalController,game:{...ctx.game,id:'clusterio-canonical',clusterioRole:'controller'},check:(name,fn)=>ctx.check('controller-'+name,fn),artifact:(name,value)=>ctx.artifact('controller-'+name,value),own:async f=>{controller.fixture=f;await ctx.artifact('clusterio-retention-controller-owned.json',f);}};runtime(controller);
 if(ctx.build===retryBuild)controllerProof=await verifyRetry22(ctx,contract.retryBridge,pin.sha256);
 const currentController=await stopped(controller,controllerProof);await stopped(ctx,hostProof);
 const [full]=JSON.parse(await docker(['inspect',currentController.id],ctx.signal));
 const tokenRaw=await docker(['run','--rm','--pull','never','--network','none','--read-only','--memory','128m','--user',full.Config.User,'--cap-drop','ALL','--mount','type=bind,src=/var/lib/voltra-parity-20261029/volumes/'+controller.fixture.server.uuid+',dst=/home/container,readonly','--workdir','/home/container','--entrypoint','node',full.Image,'--input-type=module','-e',privateHostTokenReuseProgram(token.hostId,token.sha256)],ctx.signal,30000);
 const observedToken=JSON.parse(tokenRaw);if(observedToken.sha256!==token.sha256||observedToken.mode!==384||observedToken.uid!==token.uid||observedToken.gid!==token.gid)throw Error('Retained exact private token metadata differs');
 await hooks.prerequisites(controller,client(controller));await hooks.prerequisites(ctx,client(ctx));
 // Fresh offline manifests include both role configs and private token paths.
 const controllerSaved={...controllerProof,processProof:controllerProof,baseline:await hooks.observeState(controller)},hostSaved={...hostProof,processProof:hostProof,baseline:await hooks.observeState(ctx)};
 controller.fixture.retentionBaseline=controllerSaved;ctx.fixture.retentionBaseline=hostSaved;await ctx.own(ctx.fixture);
 contexts.set(ctx.game,{controller,controllerSaved,hostSaved,pair,token});await campaignAdapter.verify(ctx);
 return {pairEvidenceSHA256:pin.sha256,tokenSHA256:token.sha256,fixtures:pair.fixtures,typedWriteProven:false};
}
export async function park(ctx){const pair=contexts.get(ctx.game);if(!pair)throw Error('Paired retention ownership not verified');const result=[],errors=[];for(const context of [ctx,pair.controller])try{const cleanup={...context,signal:new AbortController().signal};await identity(cleanup);const parked=await campaignAdapter.park(cleanup),n=await campaignAdapter.native(cleanup);if(!parked.offline||n?.state.Running)throw Error('Retained pair still running');result.push({uuid:context.fixture.server.uuid,offline:true,native:n?.state});}catch(e){errors.push(String(e.message));}await ctx.artifact('clusterio-retention-pair-park-'+Date.now()+'.json',{result,errors});if(errors.length)throw Error('Retained paired cleanup failed: '+errors.join('; '));return {offline:true,fixtures:result};}
export async function run(ctx){const pair=contexts.get(ctx.game);if(!pair)throw Error('Verify paired retention first');const controller=pair.controller,cc=client(controller),reserve=ctx.reserve,floor=Math.max(3072,ctx.game.peakMiB);ctx.reserve=controller.reserve=mib=>reserve(Math.max(floor,mib));let failure;
 try{
  await ctx.reserve(floor);
  // First reinstall and reload controller with both fixtures initially parked.
  await campaignAdapter.run(controller);
  controller.startRequestedAt=Date.now();await cc.power('start');const ready=await ctx.check('controller-held-ready',()=>campaignAdapter.wait(controller,()=>hooks.ready(controller,cc),'Controller held for host retention',180000)),n=await campaignAdapter.native(controller);
  ctx.clusterioPeer={uuid:controller.fixture.server.uuid,serverId:controller.fixture.server.id,name:controller.fixture.server.name,eggId:controller.fixture.egg.id,owner:controller.fixture.intent.ownerId,node:controller.fixture.intent.request.node_id,containerId:n.id,startedAt:ready.startedAt,logBoundary:await docker(['logs','--since',ready.startedAt,n.id],ctx.signal)};
  await campaignAdapter.run(ctx);
  await ctx.check('controller-final-stop',async()=>{await identity(controller);await cc.power('stop');await campaignAdapter.wait(controller,async()=>await cc.state()==='offline','Controller retention final stop',90000);return hooks.cleanStop(controller,cc);});
 }catch(e){failure=e;await ctx.artifact('clusterio-retention-pair-original-error-'+Date.now()+'.json',{error:String(e.message)});}
 try{await park(ctx);}catch(e){if(failure)throw new AggregateError([failure,e],'Retention and paired cleanup failed');throw e;}ctx.reserve=controller.reserve=reserve;if(failure)throw failure;return {bothCanonicalReinstalls:true,bothNativeReloads:true,tokenSHA256:pair.token.sha256,typedWriteProven:false,playerClaim:false,factorioInstanceClaim:false};
}
