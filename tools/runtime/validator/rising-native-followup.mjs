import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { verify as verifyFixture, park, native } from './campaign-adapter.mjs';
import { run as lifecycle } from './api-adapter.mjs';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { registration, rconSource } from './rising-legacy-checks.mjs';
import { isRisingBuild, risingIdentity, verifyRisingAllocation } from './rising-canonical-check.mjs';
export { park };
const root = resolve('C:/Users/Veky/.t3/worktrees/pteroclone/t3-6837dde7/ptero-go');
const main = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go');
const sha = x => createHash('sha256').update(x).digest('hex');
const classSHA = 'e2c6e637bddb170022eb0f963391c9afff66ebdc4b4c6bfa3f88596dc5aa9abb';
const helper = 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8';
const recipe = 'rising_world/legacy/egg-rising-world-legacy.json';
const attrs = x => x?.attributes ?? x;
async function identity(ctx) {
  const f=ctx.fixture,s=attrs(await h.api('/api/application/servers/'+f.server.id));
  if(!isRisingBuild(ctx.build)||receipt?.binary_sha256!==ctx.build||!risingIdentity(ctx.game.id,ctx.build)||ctx.game.family!=='rising-legacy'
    ||s.uuid!==f.server.uuid||s.name!=='validator-'+ctx.game.id||Number(s.node)===202||Number(s.node)!==f.intent.request.node_id
    ||Number(s.user)!==f.intent.ownerId||s.external_id!==f.intent.externalId||s.egg!==f.egg.id||f.recipe!==recipe
    ||s.container?.image!==f.intent.request.image||s.container.startup_command!==h.profileFromRuntime(recipe,receipt).egg.startup)
    throw Error('Exact owned canonical Rising identity required');
  if(attrs(await h.api('/api/client/servers/'+s.uuid+'/resources')).current_state!=='offline'||(await native(ctx))?.state.Running)
    throw Error('Observer and startup preparation require stopped owned fixture');
  const rows=(await h.api('/api/client/servers/'+s.uuid+'/network/allocations')).data.map(attrs); verifyRisingAllocation(rows);
  return s;
}
export async function verify(ctx) {
  const pin=ctx.game.canonicalEvidence;
  const expected=resolve(main,'artifacts/game-parity-20261029/validator-20261103-'+ctx.game.id+'/report.json');
  if(!pin?.path||resolve(pin.path)!==expected||!/^[a-f0-9]{64}$/.test(pin.sha256??'')) throw Error('Exact archived Rising canonical evidence pin required');
  const raw=await readFile(pin.path),prior=JSON.parse(raw);
  if(sha(raw)!==pin.sha256||prior.status!=='PASS'||prior.game!==ctx.game.id||prior.fixture?.server?.uuid!==ctx.fixture?.server?.uuid
    ||prior.fixture?.egg?.uuid!==ctx.game.canonicalEggUUID||prior.fixture?.intent?.build!==ctx.build
    ||['served-game-settings','preserved-offline'].some(name=>prior.checks.filter(c=>c.name===name&&c.status==='PASS').length!==1)
    ||prior.fixture.canonicalBootstrap?.complete!==true || prior.fixture.canonicalBootstrap.parking?.offline!==true
    ||prior.fixture.canonicalBootstrap.parking.state?.Running!==false || prior.fixture.canonicalBootstrap.parking.state?.ExitCode!==0
    ||prior.fixture.canonicalBootstrap.ready?.containerId!==prior.fixture.canonicalBootstrap.parking.containerId
    ||prior.fixture.canonicalBootstrap.ready?.startedAt!==prior.fixture.canonicalBootstrap.parking.state.StartedAt)
    throw Error('Exact successful archived Rising canonical setup required');
  await verifyFixture(ctx); await identity(ctx);
}
export async function run(ctx) {
  await ctx.reserve(ctx.game.peakMiB);
  await ctx.check('reviewed-rcon-observer-install',async()=>{
    const s=await identity(ctx),dir=resolve(root,'.local/validator-campaign/rising-rcon-observer');
    const compiled=JSON.parse(await readFile(resolve(dir,'compile-receipt.json'),'utf8'));
    const source=await readFile(resolve(main,rconSource.file)),binary=await readFile(resolve(dir,'RisingWorldRcon.class'));
    const observer=ctx.game.risingRconObserver;
    if(sha(source)!==rconSource.sha256||sha(binary)!==classSHA||binary.readUInt32BE(0)!==0xcafebabe||binary.readUInt16BE(6)!==52
      ||compiled.release!==8||compiled.nativeExecution!==false||compiled.sourceSHA256!==rconSource.sha256||compiled.classSHA256!==classSHA
      ||!observer||observer.sourceSHA256!==rconSource.sha256||observer.classSHA256!==classSHA||!observer.publisherJars
      ||ctx.game.offlineHelperImage!==helper) throw Error('Reviewed observer compile/source/class/helper pins required');
    const jars=observer.publisherJars;
    for(const [path,hash] of Object.entries(jars)) if(!/^lib\/[A-Za-z0-9_.-]+\.jar$/.test(path)||!/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid exact publisher jar manifest');
    for(const dep of compiled.dependencies.filter(d=>d.file!=='server.jar')) if(!Object.values(jars).includes(dep.sha256)) throw Error('Compiled publisher dependency absent from manifest');
    const payload={jars,files:{'RisingWorldRcon.java':{sha256:rconSource.sha256,data:source.toString('base64')},'RisingWorldRcon.class':{sha256:classSHA,data:binary.toString('base64')}}};
    const program=`import pathlib,os,json,hashlib,base64,stat
r=pathlib.Path('/fixture');p=json.loads(${JSON.stringify(JSON.stringify(payload))})
def safe(x):
 for a in [x,*x.parents]:
  if a==r:break
  assert not a.is_symlink(),'symlink refused'
def digest(x):
 safe(x)
 with x.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
assert digest(r/'server.jar')=='b0d507b90b80846d5bdac97a146e2486b0b2b290d82e205e854debdd7235f5d4'
assert {str(x.relative_to(r)) for x in (r/'lib').glob('*.jar')}==set(p['jars']),'publisher classpath set differs'
for name,want in p['jars'].items():assert digest(r/name)==want,'publisher dependency hash differs'
owner=(r/'server.jar').stat();d=r/'.voltra/validator-rcon';safe(d);assert (r/'.voltra').is_dir()
if not d.exists():d.mkdir(mode=0o755);os.chown(d,owner.st_uid,owner.st_gid)
assert d.is_dir()
for name,entry in p['files'].items():
 x=d/name;safe(x);data=base64.b64decode(entry['data'],validate=True);assert hashlib.sha256(data).hexdigest()==entry['sha256']
 if x.exists():assert digest(x)==entry['sha256'],'existing observer differs'
 else:
  fd=os.open(x,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644)
  with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.chown(x,owner.st_uid,owner.st_gid)
 st=x.stat();assert digest(x)==entry['sha256'] and st.st_uid==owner.st_uid and st.st_gid==owner.st_gid and stat.S_IMODE(st.st_mode)==0o644
print(json.dumps({'sourceSHA256':p['files']['RisingWorldRcon.java']['sha256'],'classSHA256':p['files']['RisingWorldRcon.class']['sha256'],'publisherJars':p['jars'],'ownershipReadback':True,'scope':'Observer only; no native execution'}))`;
    const name='validator-rising-observer-'+s.uuid;
    await ctx.artifact('rising-observer-install-intent.json',{uuid:s.uuid,helper,sourceSHA256:rconSource.sha256,classSHA256:classSHA,publisherJars:jars});
    const result=JSON.parse(await docker(['run','--rm','--name',name,'--pull','never','--network','none','--read-only','--memory','256m','--cpus','0.5','--label','voltra.validator='+ctx.game.id,'--mount','type=bind,source=/var/lib/voltra-parity-20261029/volumes/'+s.uuid+',target=/fixture',helper,'python3','-c',program],ctx.signal,60000));
    await identity(ctx); return result;
  });
  await ctx.check('reviewed-native-startup',async()=>{
    const s=await identity(ctx),environment=registration['rising-legacy'].environment;
    await ctx.artifact('rising-native-startup-intent.json',{uuid:s.uuid,environment,memory:0,scope:'Idle native checks; canonical defaults retained in archived receipt'});
    if(Number(s.limits.memory)!==0) throw Error('Canonical reviewed memory release missing; preserve original resource evidence');
    await h.api('/api/application/servers/'+s.id+'/startup','PATCH',{environment});
    const actual=await identity(ctx);
    if(Number(actual.limits.memory)!==0||Object.entries(environment).some(([k,v])=>String(actual.container.environment[k])!==v)) throw Error('Rising native startup readback differs');
    return {confirmed:true,memory:0,uuid:s.uuid};
  });
  return lifecycle(ctx);
}
