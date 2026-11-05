/** Same-fixture canonical PASS adoption only. No provision or heap override. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { campaign as h, receipt } from './campaign-session.mjs';
import * as api from './api-adapter.mjs';
import { build, recipe, ids, canonicalArchive, validateCanonical, hash } from './glowstone-native-pin.mjs';
const root=resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go');
const attrs=value=>value?.attributes??value;
function runtimeFor(ctx){const f=ctx.fixture;Object.assign(ctx.game,{base:'http://127.0.0.1:18099',serverId:f.server.id,serverUUID:f.server.uuid,nodeId:f.intent.request.node_id,expectedName:f.name});}
async function identity(ctx){
 const f=ctx.fixture,s=attrs(await h.api('/api/application/servers/'+f.server.id)),p=h.profileFromRuntime(recipe,receipt),e=attrs(await h.api('/api/admin/eggs/'+s.egg));
 if(s.uuid!==f.server.uuid||s.name!==f.name||s.external_id!==f.intent.externalId||Number(s.user)!==f.intent.ownerId||Number(s.node)!==f.intent.request.node_id||s.egg!==f.egg.id||e.uuid!==ctx.game.canonicalEggUUID||e.script_install!==p.egg.scripts.installation.script||Number(s.limits?.memory)!==2048||Number(s.limits?.disk)!==10240||Object.keys(s.java_config??{}).length)throw Error('Original canonical Glowstone identity/2048MiB/default Java authority changed');
 const runtimes=(await h.api('/api/admin/java/runtimes')).data.map(attrs);if(!runtimes.some(r=>r.enabled===true&&Number(r.major)===8&&r.image===s.container?.image)||p.egg.voltra?.java_config?.default_major!==8||s.container.environment.SERVER_JARFILE!=='glowstone.jar'||s.container.environment.VERSION!=='latest')throw Error('Canonical Java8 effective image/default startup changed');
 return s;
}
export async function verify(ctx){
 if(!ids.includes(ctx.game.id)||ctx.game.family!=='glowstone'||ctx.game.recipe!==recipe||ctx.build!==build||receipt?.binary_sha256!==build||ctx.game.testStartup||resolve(ctx.game.checksModule)!==resolve(root,'tools/runtime/validator/glowstone-checks.mjs'))throw Error('Exact candidate19 Glowstone native hook required');
 const pin=ctx.game.canonicalPass;if(!pin?.path||resolve(pin.path)!==canonicalArchive(ctx.game.id)||!/^[a-f0-9]{64}$/.test(pin.sha256??''))throw Error('Archive and hash the actual same-alias canonical PASS first');
 const raw=await readFile(pin.path,'utf8'),report=JSON.parse(raw);if(hash(raw)!==pin.sha256||report.game!==ctx.game.id)throw Error('Canonical PASS pin changed');const f=validateCanonical(report);
 if(f.intent.ownerId!==ctx.game.ownerId||f.egg.uuid!==ctx.game.canonicalEggUUID)throw Error('Canonical owner/catalog UUID differs');
 if(ctx.fixture&&(ctx.fixture.server?.uuid!==f.server.uuid||ctx.fixture.server.id!==f.server.id||ctx.fixture.intent?.externalId!==f.intent.externalId))throw Error('Existing native fixture differs; preserve both');
 await ctx.own(ctx.fixture??f);runtimeFor(ctx);await identity(ctx);
 await api.verify({...ctx,fixture:{uuid:f.server.uuid},own:async()=>{}});
 await ctx.artifact('glowstone-canonical-pass-adopted.json',{pin,fixture:f.server.uuid,canonicalMemoryMiB:2048,javaOverride:false,scope:'Exact canonical install reused; this followup must generate fresh native evidence'});
}
export async function run(ctx){runtimeFor(ctx);await identity(ctx);if(await api.client(ctx).state()!=='offline')throw Error('Glowstone followup requires parked canonical fixture');await ctx.reserve(ctx.game.peakMiB);return api.run(ctx);}
export async function park(ctx){if(!ctx.fixture?.server)return{preserved:true,noAdoptedFixture:true};runtimeFor(ctx);await identity(ctx);return api.park(ctx);}
