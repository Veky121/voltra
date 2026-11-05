/** Adopt only actual archived canonical PASS; no provisioning side effects on import. */
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {campaign as h,receipt} from './campaign-session.mjs';
import * as campaignAdapter from './campaign-adapter.mjs';
import {build,recipe} from './lac-canonical-check.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
async function identity(ctx){const f=ctx.fixture,s=(await h.api('/api/application/servers/'+f.server.id)).attributes;if(s.uuid!==f.server.uuid||s.name!=='validator-lac-canonical'||s.egg!==f.egg.id||s.external_id!==f.intent.externalId||Number(s.user)!==f.intent.ownerId||Number(s.node)!==f.intent.request.node_id||s.container.image!==f.intent.request.image||s.container.startup_command!==h.profileFromRuntime(recipe,receipt).egg.startup)throw Error('Exact owned canonical LAC native identity differs');const e=(await h.api('/api/admin/eggs/'+s.egg)).attributes;if(e.uuid!==f.egg.uuid)throw Error('Canonical LAC egg UUID differs');}
export async function verify(ctx){
 const pin=ctx.game.canonicalEvidence,path=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-20261103-lac-canonical/report.json');
 if(ctx.game.id!=='lac-canonical'||ctx.game.family!=='lac'||ctx.game.recipe!==recipe||ctx.build!==build||receipt?.binary_sha256!==build||resolve(pin?.path??'')!==path||!/^[a-f0-9]{64}$/.test(pin?.sha256??''))throw Error('Exact LAC22 canonical archive pin required');
 const raw=await readFile(path),report=JSON.parse(raw),f=report.fixture;if(sha(raw)!==pin.sha256||report.status!=='PASS'||report.game!==ctx.game.id||report.build!==build||f?.recipe!==recipe||f.server?.name!=='validator-lac-canonical'||f.intent.build!==build||f.install?.rawExit!=='0'||f.canonicalBootstrap?.complete!==true||f.canonicalBootstrap.parking?.state?.Running!==false||f.canonicalBootstrap.parking.state.ExitCode!==0)throw Error('Actual LAC canonical setup/bootstrap/parking PASS required');
 for(const name of ['served-startup-files','recipe-startup-metadata','preserved-offline'])if(report.checks?.filter(c=>c.name===name&&c.status==='PASS').length!==1)throw Error('Canonical LAC evidence incomplete: '+name);
 if(ctx.fixture?.server&&ctx.fixture.server.uuid!==f.server.uuid)throw Error('Preserved LAC fixture differs');await ctx.own(ctx.fixture?.server?ctx.fixture:f);Object.assign(ctx.game,{base:'http://127.0.0.1:18099',serverId:f.server.id,serverUUID:f.server.uuid,nodeId:f.intent.request.node_id,expectedName:f.server.name,checksModule:resolve('tools/runtime/validator/lac-checks.mjs')});await identity(ctx);await campaignAdapter.verify(ctx);
}
export async function run(ctx){await identity(ctx);return campaignAdapter.run(ctx);}
export async function park(ctx){await identity(ctx);return campaignAdapter.park(ctx);}
