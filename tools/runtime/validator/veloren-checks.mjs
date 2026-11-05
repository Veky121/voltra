import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';
const recipe = 'veloren/egg-veloren.json', file = '/userdata/server/server_config/settings.ron';
export const registration = { veloren: { recipe, ports: 1, environment: { VERSION: 'weekly', SERVER_NAME: 'Validator Veloren', MAX_PLAYERS: '32', AUTH_MODE: 'official', AUTH_SERVER_URL: 'https://auth.veloren.net', MANAGE_NETWORK: '1', QUERY_ENABLED: '1', QUERY_PORT: '0', METRICS_PORT: '14005', METRICS_PUBLIC: '0' } } };
export const budgets = { memoryMiB: 4096, diskMiB: 8192, startupMs: 300000, stopMs: 90000 };
export const retentionRequiredPath = file;
const digest = value => createHash('sha256').update(value).digest('hex');
const querySHA = '1ce0f0c8a09be33f96ea912105851f5fbfd3bdaf9906c2cc9aff678aa5ca793d';
const queryPath = resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/.local/game-parity-20261029/veloren-root-native/query-build/target/release/voltra-veloren-query');
const pins = { '.voltra/veloren-runtime.py': '5e2ae85c9435c4adb34005313a7d50404aeee671f24b6ab7f12eff45eb5a7c09', '.voltra/veloren-install.py': 'a77786a5fc68c9ec59f5d41f8d2133a1ec1138f2a675a0f6273dd6918d8818d4', '.voltra/veloren-builds.json': '8644cd0c66a7754d814825d551d73dc8f825d69e0913e91447113e72d8360b48' };
const scope = 'Pinned c5024ebf idle native UDP/settings deserialization, direct child clean stop and initialized database metadata retention only; no measured day/night rate, proven world seed, players, gameplay or WAN.';
const proofs = new WeakMap();
function owned(ctx) {
 const f = ctx.fixture;
 if (ctx.game.family !== 'veloren' || ctx.game.recipe !== recipe || f?.recipe !== recipe || f.server?.uuid !== ctx.game.serverUUID || f.server.name !== 'validator-' + ctx.game.id || !/^[a-f0-9-]{36}$/.test(f.server.uuid) || !/^[a-f0-9-]{36}$/.test(ctx.game.canonicalEggUUID ?? '') || ctx.game.testStartup || f.ports?.length !== 1) throw Error('Root-provisioned exact canonical Veloren fixture and catalog egg UUID required');
 return f.server;
}
async function authority(ctx, c) {
 const server = owned(ctx), p = h.profileFromRuntime(recipe, receipt), actual = (await h.api('/api/application/servers/' + server.id)).attributes;
 const egg = (await h.api('/api/admin/eggs/' + actual.egg)).attributes;
 if (p.revision !== 'veloren-weekly-c5024ebf-v1' || p.egg.startup !== 'exec python3 .voltra/veloren-runtime.py' || p.egg.config.stop !== 'shutdown graceful 5' || actual.uuid !== server.uuid || actual.egg !== ctx.fixture.egg.id || egg.uuid !== ctx.game.canonicalEggUUID || actual.container.startup_command !== p.egg.startup || (egg.script_install !== p.egg.scripts.installation.script && (!/^[a-f0-9-]{36}$/.test(ctx.fixture.gateId ?? '') || egg.script_install !== h.installerGate(p.egg.scripts.installation.script, ctx.fixture.gateId).replace(/\n$/, '')))) throw Error('Canonical Veloren source/egg authority differs');
 for (const [key, expected] of Object.entries(registration.veloren.environment)) if (String(actual.container.environment[key]) !== expected) throw Error('Reviewed Veloren startup setting differs: ' + key);
 const found = {};
 for (const m of p.egg.scripts.installation.script.matchAll(/cat > (\.voltra\/[\w.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)) found[m[1]] = digest(m[3] + '\n');
 for (const [path, hash] of Object.entries(pins)) if (found[path] !== hash || digest(await c.read('/' + path)) !== hash) throw Error('Veloren installed helper differs: ' + path);
 const release = JSON.parse(await c.read('/.voltra/veloren-release.json'));
 if (release.sha256 !== 'ad6ad879d6f680a06b0c270c74ecbeea74f20dbd49fc84ac2195a0d15916b16e' || release.architecture !== 'x86_64') throw Error('Reviewed Veloren publisher archive differs');
 return { pins, release };
}
const velorenTestBody = '    // Validator operator test input. Native default is 30.0 minutes.\n    day_length: 600.0,\n    validator_nested_marker: (message: "literal comma, nested close )", nested: (flag: true)),\n';
const failedVelorenSuffix = velorenTestBody + ')\n';
// Locate the publisher root close and last root token, ignoring opaque strings
// and comments. Add a separator only when the publisher omitted its final comma.
function appendVelorenTestInput(text) {
 if (text.length > 262144 || !/^\s*\(/.test(text)) throw Error('Reviewed publisher RON root missing');
 let i=0,stack=[],last='',close=-1;
 while(i<text.length) {
  const c=text[i];if(/\s/.test(c)){i++;continue}
  if(text.startsWith('//',i)){const at=text.indexOf('\n',i);i=at<0?text.length:at+1;continue}
  if(text.startsWith('/*',i)){let depth=1;i+=2;while(i<text.length&&depth){if(text.startsWith('/*',i)){depth++;i+=2}else if(text.startsWith('*/',i)){depth--;i+=2}else i++;if(depth>16)throw Error('Comment depth')}if(depth)throw Error('Unclosed RON comment');continue}
  const raw=/^r(#{0,8})"/.exec(text.slice(i));
  if(raw){const ending='"'+raw[1],at=text.indexOf(ending,i+raw[0].length);if(at<0)throw Error('Unclosed raw string');i=at+ending.length;if(stack.length===1)last='string';continue}
  if(c==='"'){i++;let done=false;while(i<text.length){if(text[i]==='\\'){i+=2;continue}if(text[i++]==='"'){done=true;break}}if(!done)throw Error('Unclosed RON string');if(stack.length===1)last='string';continue}
  if('([{'.includes(c)){stack.push(c);if(stack.length>32)throw Error('RON nesting depth');i++;continue}
  if(')]}'.includes(c)){const want={')':'(',']':'[','}':'{'}[c];if(stack.pop()!==want)throw Error('RON delimiter mismatch');if(!stack.length){close=i;i++;if(text.slice(i).trim())throw Error('Trailing publisher RON expression');break}if(stack.length===1)last=c;i++;continue}
  if(stack.length===1)last=c;i++;
 }
 if(close<0||stack.length||!last)throw Error('Incomplete publisher RON');
 return text.slice(0,close)+(last===','?'\n':',\n')+velorenTestBody+text.slice(close);
}
async function recoverVelorenTestInput(ctx,c) {
 const text=await c.read(file),marker='// Validator operator test input. Native default is 30.0 minutes.';
 if(!text.includes(marker))return;
 try {const body=(await h.api(settingsURL(ctx))).attributes;if(body.fields?.some(field=>field.key==='day_length'&&field.type==='number'))return;} catch(error) {if(!/400|422/.test(String(error)))throw error;}
 if(text.split(marker).length!==2||!text.endsWith(failedVelorenSuffix))throw Error('Existing Veloren test input differs; preserve for root review');
 const intent=JSON.parse(await readFile(resolve(ctx.output,ctx.game.id,'veloren-scalar-test-input-intent.json'),'utf8'));
 if(digest(text)!==intent.afterSHA256)throw Error('Failed test input hash differs from durable original intent');
 const prefix=text.slice(0,-failedVelorenSuffix.length);
 const candidates=[')\n',')\r\n',')'].map(end=>prefix+end).filter(value=>digest(value)===intent.beforeSHA256);
 if(candidates.length!==1)throw Error('Cannot reconstruct exact publisher bytes from failed seed intent');
 const parked=await native(ctx);if(parked?.state.Running)throw Error('Cannot repair Veloren test config while native process is active');
 const original=candidates[0],fixed=appendVelorenTestInput(original);
 await ctx.artifact('veloren-seed-recovery-'+Date.now()+'.json',{oldIntent:intent,beforeSHA256:digest(text),originalPublisherSHA256:digest(original),afterSHA256:digest(fixed),scope:'Only exact prior owned test suffix replaced; every original publisher byte retained'});
 await c.write(file,fixed);if(await c.read(file)!==fixed)throw Error('Veloren seed recovery readback differs');
}
export async function prerequisites(ctx, c) {
 if (await c.state() !== 'offline') throw Error('Veloren prerequisites require parked canonical fixture');
 const source = await authority(ctx,c), bytes = await readFile(queryPath);
 await recoverVelorenTestInput(ctx,c);
 if (bytes.length !== 1036672 || digest(bytes) !== querySHA) throw Error('Historical locked upstream UDP query tool missing or changed; root must supply reviewed binary, adapter never builds/downloads it');
 if (ctx.game.offlineHelperImage !== 'sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8') throw Error('Root-reviewed immutable SQLite helper required');
 return { source, querySHA, canonicalProvisionRequired: true, scope };
}
async function processProof(ctx) {
 const n = await native(ctx); if (!n?.state.Running) throw Error('Native Veloren process missing');
 const result = JSON.parse(await docker(['exec',n.id,'python3','-c',String.raw`import os,json,hashlib
from pathlib import Path
r=Path('/home/container');rows=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  if os.readlink(p/'exe')!='/home/container/veloren-server-cli':continue
  args=(p/'cmdline').read_bytes().split(b'\0')[:-1]
  pp=int(next(x.split()[1] for x in (p/'status').read_text().splitlines() if x.startswith('PPid:')))
  parent=Path('/proc',str(pp));pa=(parent/'cmdline').read_bytes().split(b'\0')[:-1]
  env=(p/'environ').read_bytes().split(b'\0')
  rows.append(dict(pid=int(p.name),startTicks=(p/'stat').read_text().rsplit(')',1)[1].split()[19],direct=pa[1:]==[b'.voltra/veloren-runtime.py'],userdata=b'VELOREN_USERDATA=/home/container/userdata' in env,argv=[v.decode() for v in args]))
 except FileNotFoundError:pass
print(json.dumps(dict(engines=rows,binarySHA256=hashlib.sha256((r/'veloren-server-cli').read_bytes()).hexdigest())))`],ctx.signal,30000));
 if (result.binarySHA256 !== '7c40dca6da18ff43a08022e0288e6b8f25b3949c4eb933283867b4d671578fd6' || result.engines.length !== 1 || !result.engines[0].direct || !result.engines[0].userdata) throw Error('Pinned native Veloren direct process/active userdata differs');
 return { containerId:n.id,startedAt:n.state.StartedAt,...result };
}
async function query(ctx) {
 const n = await native(ctx);if (!n?.state.Running) throw Error('Query requires owned running fixture');
 await docker(['cp',queryPath,n.id+':/home/container/.voltra/validator-veloren-query'],ctx.signal,30000);
 await ctx.artifact('veloren-query-mode-intent.json',{container:n.id,path:'/.voltra/validator-veloren-query',sha256:querySHA,mode:'0755',scope:'Only the copied owned query observer; no native game files'});
 const observed = await docker(['exec','--user','0:0',n.id,'python3','-c',"import hashlib,os,stat; p='/home/container/.voltra/validator-veloren-query'; assert not os.path.islink(p) and not os.path.islink(os.path.dirname(p)); assert stat.S_ISREG(os.stat(p).st_mode); assert hashlib.sha256(open(p,'rb').read()).hexdigest()=='"+querySHA+"'; os.chmod(p,0o755); assert stat.S_IMODE(os.stat(p).st_mode)==0o755"],ctx.signal,10000); void observed;
 const result = JSON.parse(await docker(['exec',n.id,'/home/container/.voltra/validator-veloren-query','127.0.0.1:'+ctx.fixture.ports[0]],ctx.signal,15000));
 if (result.git_hash !== 'c5024ebf' || result.git_timestamp !== 1792582154 || result.players !== 0 || result.player_cap !== 32) throw Error('Native Veloren UDP challenge/settings readback differs');
 return result;
}
export async function ready(ctx,c) {
 owned(ctx);const n=await native(ctx);if (!n || n.state.Status==='created' || !Number.isFinite(Date.parse(n.state.StartedAt)) || Date.parse(n.state.StartedAt)<ctx.startRequestedAt) return false;
 if (!n.state.Running) throw Error('Veloren exited before readiness: '+n.state.ExitCode);
 const text=await logs(ctx,n.state.StartedAt);
 if (!text.includes('Server is ready to accept connections') || await c.state()!=='running') return false;
 if (/falling back to default settings|failed to parse setting file|FATAL: Failed to parse/i.test(text)) throw Error('Veloren rejected native configuration');
 const source=await authority(ctx,c), proof=await processProof(ctx), discovery=await query(ctx);proofs.set(ctx,proof);
 await ctx.artifact('veloren-fresh-ready-'+Date.now()+'.json',{source,proof,discovery,scope});
 return {...proof,discovery,scope};
}
async function clean(ctx,c) {
 const n=await native(ctx),p=proofs.get(ctx);
 if (!p || n?.id!==p.containerId || n.state.StartedAt!==p.startedAt || n.state.Running || n.state.ExitCode!==0 || n.state.OOMKilled || n.state.Dead || await c.state()!=='offline') throw Error('Veloren fresh direct native exit0 unproved');
 const text=await logs(ctx,n.state.StartedAt);
 if (/FATAL: Failed to parse|falling back to default settings/i.test(text)) throw Error('Veloren settings fallback during lifecycle');
 return {...p,engineNumericExit:0,engineExitProven:true,nativeState:n.state,scope};
}
const settingsURL=ctx=>'/api/client/servers/'+ctx.fixture.server.uuid+'/game-settings?file='+encodeURIComponent(file);
async function priorVeloren720Proof(ctx,text) {
 const hash=digest(text),durable=ctx.fixture.velorenSettings;
 if(durable?.complete===true&&durable.fixture===ctx.fixture.server.uuid&&durable.configSHA256===hash&&durable.scriptHash===ctx.fixture.intent.scriptHash)return {kind:'durable-owned-settings',proof:durable};
 const directory=resolve(ctx.output,ctx.game.id),history=resolve(ctx.output,'history');
 const reportNames=(await readdir(history)).filter(name=>name.startsWith(ctx.game.id+'-')&&name.endsWith('.json'));
 if(reportNames.length>200)throw Error('Veloren retry evidence history requires bounded root review');
 let accepted;
 for(const name of reportNames.reverse()) {
  const path=resolve(history,name),bytes=await readFile(path,'utf8'),report=JSON.parse(bytes),e=report.checks?.find(check=>check.name==='settings'&&check.status==='PASS')?.evidence;
  if(report.game===ctx.game.id&&report.fixture?.server?.uuid===ctx.fixture.server.uuid&&report.fixture.recipe===recipe&&report.fixture.intent?.scriptHash===ctx.fixture.intent.scriptHash
   &&e?.changes?.day_length==='720.0'&&e.fresh?.binarySHA256==='7c40dca6da18ff43a08022e0288e6b8f25b3949c4eb933283867b4d671578fd6'
   &&e.fresh.engines?.length===1&&e.fresh.engines[0].direct===true&&e.fresh.discovery?.git_hash==='c5024ebf'&&e.fresh.discovery.players===0){accepted={path,sha256:digest(bytes)};break}
 }
 if(!accepted)throw Error('Existing720 requires prior exact owned successful settings/native phase');
 const restored=text.replace(/(^[ \t]*day_length:\s*)720\.0\b/m,(_match,prefix)=>prefix+'600.0');
 if(restored===text)throw Error('Prior720 scalar cannot be uniquely restored');
 const intents=(await readdir(directory)).filter(name=>name==='veloren-scalar-test-input-intent.json'||/^veloren-seed-recovery-[0-9]+\.json$/.test(name));
 if(intents.length>200)throw Error('Veloren seed evidence requires bounded root review');
 for(const name of intents){const path=resolve(directory,name),bytes=await readFile(path,'utf8'),intent=JSON.parse(bytes);if(intent.afterSHA256===digest(restored))return {kind:'historical-owned-settings-plus-exact-seed-hash',report:accepted,intent:{path,sha256:digest(bytes)},configSHA256:hash,restoredSHA256:digest(restored)}}
 throw Error('Prior successful720 exists but full config hash does not match owned600 seed evidence');
}
export async function settings(ctx,c) {
 await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Veloren settings stop',budgets.stopMs);await clean(ctx,c);
 const original=await c.read(file),initial=(await h.api(settingsURL(ctx))).attributes;
 if (!initial.revision) throw Error('Canonical bounded RON backend unavailable');
 if (!initial.fields.some(f=>f.key==='day_length')) {
  const seeded=appendVelorenTestInput(original);
  await ctx.artifact('veloren-scalar-test-input-intent.json',{beforeSHA256:digest(original),afterSHA256:digest(seeded),value:'600.0',nativeDefault:'30.0',source:'https://gitlab.com/veloren/veloren/-/blob/c5024ebf/common/src/consts.rs#L39',worldDataModified:false});
  await c.write(file,seeded);if(await c.read(file)!==seeded)throw Error('Veloren test input readback differs');
 }
 let before=(await h.api(settingsURL(ctx))).attributes,raw=await c.read(file),field=before.fields.find(f=>f.key==='day_length');
 if(field?.type!=='number'||field.readonly||!['600.0','720.0'].includes(String(field.value)))throw Error('Owned editable Veloren600/720 scalar required');
 if(String(field.value)==='720.0') {
  const prior=await priorVeloren720Proof(ctx,raw),restored=raw.replace(/(^[ \t]*day_length:\s*)720\.0\b/m,(_match,prefix)=>prefix+'600.0');
  const n=await native(ctx);if(n?.state.Running||await c.state()!=='offline')throw Error('Veloren typed retry reset requires offline fixture');
  await ctx.artifact('veloren-typed-retry-intent-'+Date.now()+'.json',{fixture:ctx.fixture.server.uuid,beforeSHA256:digest(raw),afterSHA256:digest(restored),from:'720.0',to:'600.0',prior,scope:'Repeat owned typed roundtrip only; preserve every other config byte'});
  await h.api(settingsURL(ctx),'PUT',{revision:before.revision,settings:{day_length:'600.0'}});
  before=(await h.api(settingsURL(ctx))).attributes;const actual=await c.read(file);
  if(actual!==restored||String(before.fields.find(f=>f.key==='day_length')?.value)!=='600.0')throw Error('Veloren typed retry reset readback/preservation failed');
  raw=actual;
 }
 await h.api(settingsURL(ctx),'PUT',{revision:before.revision,settings:{day_length:'720.0'}});
 const after=(await h.api(settingsURL(ctx))).attributes,edited=await c.read(file);
 if(String(after.fields.find(f=>f.key==='day_length')?.value)!=='720.0'||edited!==raw.replace(/(^[ \t]*day_length:\s*)600\.0\b/m,(_match,prefix)=>prefix+'720.0')) throw Error('Veloren typed span edit changed unknown or nested bytes');
 ctx.veloren={edited:true,configSHA256:digest(edited)};ctx.startRequestedAt=Date.now();await c.power('start');
 const fresh=await wait(ctx,()=>ready(ctx,c),'Veloren positive720 config loading',budgets.startupMs);
 if(await c.read(file)!==edited)throw Error('Veloren managed bridge changed operator RON bytes');
 const durable={fixture:ctx.fixture.server.uuid,scriptHash:ctx.fixture.intent.scriptHash,configSHA256:digest(edited),complete:true,fresh,at:new Date().toISOString()};
 await ctx.artifact('veloren-typed-settings-proof-'+Date.now()+'.json',durable);
 await ctx.own({...ctx.fixture,velorenSettings:durable});
 return {changes:{day_length:'720.0'},configSHA256:digest(edited),fresh,nativeConfigLoading:'Pinned wrapper native admin validation plus same active userdata and fresh game readiness; no measured day/night rate',scope};
}
export function retentionPaths(ctx){owned(ctx);return [file,'/userdata','/.voltra/veloren-release.json','/.voltra/veloren-runtime.py','/.voltra/veloren-builds.json'];}
export function restoreContext(ctx,saved){owned(ctx);if(!saved?.engineExitProven||saved.engineNumericExit!==0||!saved.processProof?.engines?.[0]?.direct||!saved.configSHA256)throw Error('Veloren retained process/config proof absent');ctx.veloren={edited:true,configSHA256:saved.configSHA256,baseline:saved.baseline};}
// Initialized SQLite state is inspected only offline, read-only, with no WAL
// discard/checkpoint or injected rows. Absent databases remain explicitly absent.
async function snapshot(ctx) {
 const n=await native(ctx);if(!n||n.state.Running||n.state.ExitCode!==0)throw Error('Veloren SQLite snapshot requires clean stopped process');
 const [id]=JSON.parse(await docker(['inspect',n.id],ctx.signal));const source='/var/lib/voltra-parity-20261029/volumes/'+owned(ctx).uuid;
 if(id.Name!=='/'+ctx.fixture.server.uuid||id.State.Running||id.State.StartedAt!==n.state.StartedAt||id.State.FinishedAt!==n.state.FinishedAt||id.Mounts.filter(m=>m.Destination==='/home/container'&&m.Source===source).length!==1||id.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Owned stopped Veloren mount differs');
 const script=String.raw`import pathlib,hashlib,json,sqlite3,stat,os
if os.geteuid()!=0:raise ValueError('Read-only root observer identity required')
r=pathlib.Path('/source');rows=[];databases=[]
if r.is_symlink() or not r.is_dir():raise ValueError('Invalid read-only source root')
if (r/'userdata').is_symlink() or not (r/'userdata').is_dir():raise ValueError('Invalid native userdata root')
for index,p in enumerate(sorted((r/'userdata').rglob('*'))):
 if index>100000:raise ValueError('Oversized userdata tree')
 if p.is_symlink():raise ValueError('Symlink userdata')
 if not p.is_file():continue
 s=p.stat();name=str(p.relative_to(r));before=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
 rows.append(dict(path=name,sha256=before,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid))
 if p.open('rb').read(16)==b'SQLite format 3\x00':
  wal=pathlib.Path(str(p)+'-wal')
  if wal.exists() and wal.stat().st_size:raise ValueError('Nonempty WAL requires review; never discard')
  c=sqlite3.connect(p.as_uri()+'?mode=ro&immutable=1',uri=True);check=c.execute('pragma quick_check').fetchall()
  if check!=[('ok',)]:raise ValueError('SQLite quick_check failed')
  schema=c.execute('select type,name,tbl_name,sql from sqlite_master order by type,name').fetchall();c.close()
  if hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=before:raise ValueError('SQLite read changed bytes')
  databases.append(dict(path=name,schemaSHA256=hashlib.sha256(json.dumps(schema,separators=(',',':')).encode()).hexdigest(),quickCheck='ok'))
for row in rows:
 p=r/row['path'];s=p.stat()
 if p.is_symlink() or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=row['sha256'] or stat.S_IMODE(s.st_mode)!=row['mode'] or s.st_uid!=row['uid'] or s.st_gid!=row['gid']:raise ValueError('Stopped userdata changed during read-only snapshot')
print(json.dumps(dict(files=rows,databases=databases,worldSeedClaimed=False,playerDataInjected=False)))`;
 const helper='validator-veloren-snapshot-'+randomUUID();
 await ctx.artifact('veloren-snapshot-helper-'+Date.now()+'.json',{helper,source,image:ctx.game.offlineHelperImage,readOnly:true,user:'0:0',capability:'DAC_READ_SEARCH',scope:'Read/traverse permission only on exact stopped readonly bind; no game chmod/chown or write mount'});
 const result=JSON.parse(await docker(['run','--rm','--pull','never','--name',helper,'--user','0:0','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,src='+source+',dst=/source,readonly','--entrypoint','python3',ctx.game.offlineHelperImage,'-B','-c',script],ctx.signal,60000));
 const current=await native(ctx);if(current?.id!==n.id||current.state.Running||current.state.StartedAt!==n.state.StartedAt||current.state.FinishedAt!==n.state.FinishedAt)throw Error('Veloren snapshot process boundary changed');return result;
}
export async function saved(ctx,c){const processProof=await clean(ctx,c);if(!ctx.veloren?.edited||digest(await c.read(file))!==ctx.veloren.configSHA256)throw Error('Veloren typed config lost');const baseline=await snapshot(ctx);return {baseline,configSHA256:ctx.veloren.configSHA256,processProof,engineNumericExit:0,engineExitProven:true,scope};}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.processProof.startedAt||digest(await c.read(file))!==saved.configSHA256)throw Error('Veloren fresh native reload/config absent');await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Veloren reload stop',budgets.stopMs);const stop=await clean(ctx,c),disk=await snapshot(ctx);if(JSON.stringify(disk.databases)!==JSON.stringify(saved.baseline.databases))throw Error('Veloren initialized database path/schema changed');return {fresh,stop,disk,initializedDatabaseSchemaRetained:saved.baseline.databases.length>0,databaseState:saved.baseline.databases.length?'initialized path/schema retained':'no native SQLite database observed',worldSeedClaimed:false,scope};}
