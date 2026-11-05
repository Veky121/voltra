/** SOURCE ONLY. Root owns admission, lifecycle, routing and native diagnostics. */
import {resolve} from 'node:path';
import {campaign as h,receipt,docker} from './campaign-session.mjs';
import {native,logs} from './campaign-adapter.mjs';
import {recipe,build,snapshot,image,startup,sourcePins,sha,verifyJC3MPFrozen,verifyExposure} from './jc3mp-canonical-check.mjs';
export {verifyBuild} from './game-checks.mjs';
export {recipe,build,image,startup,sourcePins,verifyExposure};
export const registration={jc3mp:{recipe,ports:4,peakMiB:2048,installPeakMiB:2048,diskMiB:8192,environment:{PUBLIC_SERVER:'false',XVFB:'0',WINDOWS_INSTALL:'0',SRCDS_APPID:'619960'}}};
export const retentionRequiredPath='/config.json';
export const evidenceLimits=Object.freeze({nativeCurrentPending:true,historicalSourceEquivalent:false,worldSave:false,shutdownFlush:false,players:false,WAN:false,gameplay:false,scope:'Idle operator config/package persistence only; package-load fsync is not shutdown flush'});
export const budgets=Object.freeze({probeMs:60000,quitDiagnosticMs:30000});
function owned(ctx){
 const f=ctx.fixture;
 if(ctx.build!==build||ctx.game.family!=='jc3mp'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server?.uuid!==ctx.game.serverUUID||!/^validator-/.test(f.server.name)||f.server.name!=='validator-'+ctx.game.id||! /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(f.server.uuid)||ctx.game.testStartup||f.ports?.length!==4||new Set(f.ports).size!==4||!f.ports.every(p=>Number.isInteger(p)&&p>1024&&p<65536)||!f.ports.includes(f.allocation?.port))throw Error('Exact owned JC3MP fixture/four allocations required');
 ctx.signal?.throwIfAborted();return f;
}
export async function installedSource(ctx,c){
 const f=owned(ctx);if(!h||receipt?.binary_sha256!==build||resolve(receipt.snapshot)!==resolve(snapshot))throw Error('Verified frozen22 session required');
 const p=h.profileFromRuntime(recipe,receipt),proof=verifyJC3MPFrozen(p),a=(await h.api('/api/application/servers/'+f.server.id)).attributes;
 if(a.uuid!==f.server.uuid||a.name!==f.server.name||a.egg!==f.egg.id||Number(a.node)===202||a.container.startup_command!==startup||a.container.image!==image)throw Error('JC3MP served fixture/source differs');
 const egg=(await h.api('/api/admin/eggs/'+f.egg.id)).attributes;
 if(egg.uuid!==f.egg.uuid||egg.script_install!==p.egg.scripts.installation.script||egg.config_stop!=='^C')throw Error('JC3MP served raw installer/stop differs');
 const env=a.container.environment;
 for(const [key,value]of Object.entries(registration.jc3mp.environment))if(env[key]!==value)throw Error('JC3MP explicit private Linux identity differs: '+key);
 for(const key of ['STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAID','SRCDS_BETAPASS','INSTALL_FLAGS','PYTHONPATH','LD_PRELOAD','EXTRA_ARGS','ADDITIONAL_ARGS'])if(env[key])throw Error('JC3MP anonymous stock launch required');
 if(env.AUTO_UPDATE!=='1')throw Error('JC3MP canonical AUTO_UPDATE1 required');
 for(const [name,pin]of Object.entries(sourcePins))if(sha(await c.read('/'+name))!==pin)throw Error('JC3MP installed LF helper differs: '+name);
 return {...proof,...evidenceLimits};
}
// Read-only, bounded, uses the installed Python. Root must compile before execution.
export const observationPython=String.raw`import os,json,hashlib,stat,re
from pathlib import Path
r=Path('/home/container')
def meta(name):
 p=r/name
 for q in [p,*p.parents]:
  if q==r.parent:break
  assert not q.is_symlink(),'symlink refused'
 a=p.stat();assert stat.S_ISREG(a.st_mode) and a.st_size<=268435456
 with p.open('rb') as f:d=hashlib.file_digest(f,'sha256').hexdigest()
 z=p.stat();assert (a.st_ino,a.st_size,a.st_mtime_ns)==(z.st_ino,z.st_size,z.st_mtime_ns)
 return dict(sha256=d,bytes=z.st_size,mode=stat.S_IMODE(z.st_mode),uid=z.st_uid,gid=z.st_gid)
files={p:meta(p) for p in ['Server','config.json','.voltra/steam-template-release.json','steamapps/appmanifest_619960.acf']}
pub=json.loads((r/'.voltra/steam-template-release.json').read_text())
assert pub.get('appid')==619960 and pub.get('StateFlags')==4 and pub.get('platform')=='linux' and type(pub.get('buildid')) is int
manifest=(r/'steamapps/appmanifest_619960.acf').read_text()
for key,value in [('appid','619960'),('StateFlags','4'),('buildid',str(pub['buildid']))]:assert re.findall('"'+key+'"'+r'\s+"([^\"]+)"',manifest)==[value]
config=json.loads((r/'config.json').read_text(encoding='utf-8-sig'));assert config['announce'] is False
engines=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  if os.readlink(p/'exe')!=str(r/'Server'):continue
  argv=[x.decode() for x in (p/'cmdline').read_bytes().split(b'\0') if x]
  assert argv==[str(r/'Server')] and os.readlink(p/'cwd')==str(r)
  assert hashlib.sha256((p/'exe').read_bytes()).hexdigest()==files['Server']['sha256']
  env=dict(x.split(b'=',1) for x in (p/'environ').read_bytes().split(b'\0') if b'=' in x)
  assert all(k not in env for k in [b'PYTHONHOME',b'PYTHONPATH',b'STEAM_USER',b'STEAM_PASS',b'STEAM_AUTH',b'SRCDS_BETAPASS'])
  assert env[b'LD_LIBRARY_PATH']==b'/home/container/lib:/home/container/linux64:/home/container/.steam/sdk64:/home/container'
  engines.append(dict(pid=int(p.name),startTicks=int((p/'stat').read_text().rsplit(')',1)[1].split()[19]),argv=argv,direct=True,binarySHA256=files['Server']['sha256']))
 except (FileNotFoundError,ProcessLookupError):pass
assert len(engines)==1
print(json.dumps(dict(publication=pub,manifest=files,process=engines[0],config={k:config.get(k) for k in ['name','maxPlayers','maxTickRate','announce','port','queryPort','steamPort','httpPort']},appmanifest=manifest,stockPackages=[str(p.relative_to(r)) for p in (r/'packages').rglob('*')] if (r/'packages').exists() else [],nativeConfigConsumptionProven=False)))`;
export async function observe(ctx){
 const f=owned(ctx),n=await native(ctx);if(!n?.state.Running)throw Error('JC3MP running owned container required');
 const d=JSON.parse(await docker(['inspect',n.id],ctx.signal))[0],source='/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid;
 if(d.Name!=='/'+f.server.uuid||d.Config.Image!==image||d.HostConfig.Memory!==0||d.HostConfig.MemorySwap>0||d.Mounts.filter(m=>m.Source===source&&m.Destination==='/home/container'&&m.RW).length!==1||d.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('JC3MP exact volume/image/unlimited boundary differs');
 try{
  const result=JSON.parse(await docker(['exec','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',n.id,'/home/container/.voltra/python/bin/python3','-B','-c',observationPython],ctx.signal,budgets.probeMs));
  const after=await native(ctx);if(after?.id!==n.id||!after.state.Running||after.state.StartedAt!==n.state.StartedAt)throw Error('JC3MP generation changed during observation');
  const proof={...result,containerId:n.id,startedAt:n.state.StartedAt,...evidenceLimits};await ctx.artifact('jc3mp-observation-'+Date.now()+'.json',proof);return proof;
 }catch(error){await ctx.artifact('jc3mp-observation-failed-'+Date.now()+'.json',{containerId:n.id,state:n.state,error:String(error),...evidenceLimits});throw error;}
}
export async function prerequisites(ctx,c){
 const source=await installedSource(ctx,c);if(await c.state()!=='offline')throw Error('JC3MP parked fixture required');
 const i=ctx.fixture.install;if(i?.rawExit!=='0'||!i.callback?.success||!i.logsFollowed||!i.memoryValid||!i.removed)throw Error('JC3MP fresh installer raw exit/callback/logs/admission evidence required');
 return {source,rootNativeQuitDiagnosticRequired:true,...evidenceLimits};
}
export async function ready(ctx,c){
 owned(ctx);const n=await native(ctx);if(!Number.isFinite(ctx.startRequestedAt))throw Error('JC3MP fresh start boundary required');
 if(!n||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;
 if(!n.state.Running)throw Error('JC3MP exited before readiness');if(await c.state()!=='running')return false;
 const text=await logs(ctx,n.state.StartedAt);if(!text.includes('Server successfully started up'))return false;
 await installedSource(ctx,c);const state=await observe(ctx);
 return {state,readinessOnly:true,nativeSettingsConsumption:false,...evidenceLimits};
}
export function diagnosticGate(phase){throw Error('JC3MP_DIAGNOSTIC_REQUIRED: '+phase+' requires fresh root-owned quit/Stop diagnostic, process-bound native settings/package proof and separate Panel Stop review; raw exit130 must remain 130');}
// Deliberately fail closed. Frozen22 Panel Stop has no proved clean-stop contract.
export async function settings(ctx,c){owned(ctx);await installedSource(ctx,c);diagnosticGate('typed settings restart/native consumption');}
export async function saved(ctx){owned(ctx);diagnosticGate('save/clean stop');}
export async function loaded(ctx){owned(ctx);diagnosticGate('same-package reload');}
export async function retentionStop(ctx){owned(ctx);diagnosticGate('canonical reinstall retention');}
export function restoreContext(ctx){owned(ctx);diagnosticGate('restore historical context');}
export function retentionPaths(ctx){owned(ctx);return ['/config.json','/packages',...Object.keys(sourcePins).map(p=>'/'+p)];}
export function verifyQuitDiagnostic(proof,live){
 if(!proof||!live?.process?.direct||proof.containerId!==live.containerId||proof.startedAt!==live.startedAt||proof.pid!==live.process.pid||proof.startTicks!==live.process.startTicks||proof.binarySHA256!==live.process.binarySHA256||!['quit','jcmp.server.Stop()'].includes(proof.command)||proof.rawExit!==0||proof.elapsedMs<0||proof.elapsedMs>budgets.quitDiagnosticMs||!Number.isFinite(proof.elapsedMs)||proof.signalSent!==false||proof.escalated!==false||proof.descendantsGone!==true||proof.running!==false||proof.oomKilled!==false||proof.dead!==false||!proof.finishedAt||Date.parse(proof.finishedAt)<Date.parse(live.startedAt)||!Number.isFinite(Date.parse(proof.finishedAt))||!proof.commandReceiptSHA256?.match(/^[a-f0-9]{64}$/))throw Error('JC3MP process-bound bounded native exit0 diagnostic absent');
 return {nativeCommandExit0:true,panelStopProven:false,shutdownFlush:false,worldSave:false};
}
export function compareRetention(before,after){
 const required=['config.json','packages/voltra-retention.txt','packages/voltra-persistence/package.json','packages/voltra-persistence/main.js','packages/voltra-persistence/data/counter.json'];
 for(const state of [before,after])for(const name of required){const row=state?.files?.[name];if(!row||! /^[a-f0-9]{64}$/.test(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<0||['mode','uid','gid'].some(k=>!Number.isSafeInteger(row[k])))throw Error('JC3MP strict retention manifest incomplete');}
 for(const state of [before,after]){
  for(const name of ['packages','packages/voltra-persistence','packages/voltra-persistence/data'])if(!state.directories?.[name])throw Error('JC3MP retained directory missing');
  for(const [name,row]of Object.entries(state.directories))if(name.startsWith('/')||name.split('/').includes('..')||['mode','uid','gid'].some(k=>!Number.isSafeInteger(row[k])||row[k]<0))throw Error('JC3MP directory metadata invalid');
  for(const [name,row]of Object.entries(state.files))if(name.startsWith('/')||name.split('/').includes('..')||! /^[a-f0-9]{64}$/.test(row.sha256)||['bytes','mode','uid','gid'].some(k=>!Number.isSafeInteger(row[k])||row[k]<0))throw Error('JC3MP file metadata invalid');
 }
 const sorted=v=>v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])])):v;
 if(JSON.stringify(sorted(before))!==JSON.stringify(sorted(after)))throw Error('JC3MP complete bytes/metadata/directory retention differs');
 return {operatorFilesRetained:true,nativeReloadPending:true,shutdownFlush:false};
}

export const transportPython=String.raw`import os,json,socket,urllib.request,urllib.error
from pathlib import Path
pid=int(os.environ['JC3_PID']);ticks=int(os.environ['JC3_TICKS'])
p=Path('/proc')/str(pid)
assert int((p/'stat').read_text().rsplit(')',1)[1].split()[19])==ticks
fds=[]
for f in (p/'fd').iterdir():
 try:fds.append(os.readlink(f))
 except FileNotFoundError:pass
owned=[]
for name in ['tcp','tcp6','udp','udp6']:
 for line in Path('/proc/net/'+name).read_text().splitlines()[1:]:
  cols=line.split()
  if 'socket:['+cols[9]+']' in fds:owned.append(dict(protocol=name,local=cols[1],state=cols[3],inode=cols[9]))
config=json.loads(Path('/home/container/config.json').read_text())
port=int(config['httpPort']);assert any(int(x['local'].rsplit(':',1)[1],16)==port and x['protocol'].startswith('tcp') for x in owned)
try:
 with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/',timeout=5) as r:http=dict(status=r.status,bytes=len(r.read(65537)))
except urllib.error.HTTPError as e:http=dict(status=e.code,bytes=len(e.read(65537)))
assert int((p/'stat').read_text().rsplit(')',1)[1].split()[19])==ticks
print(json.dumps(dict(sockets=owned,http=http,httpResponseOnly=True,fourthListenerProven=False,A2SProven=False)))`;
export async function transportObservation(ctx,live){
 const n=await native(ctx);if(n?.id!==live.containerId||n.state.StartedAt!==live.startedAt||!n.state.Running)throw Error('JC3MP transport generation changed');
 return JSON.parse(await docker(['exec','-e','JC3_PID='+live.process.pid,'-e','JC3_TICKS='+live.process.startTicks,'-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',n.id,'/home/container/.voltra/python/bin/python3','-B','-c',transportPython],ctx.signal,15000));
}
export async function descendantsGone(ctx,live){
 const n=await native(ctx);if(n?.id!==live.containerId||n.state.StartedAt!==live.startedAt||n.state.Running||n.state.Pid!==0)return false;
 const rows=JSON.parse(await docker(['inspect',n.id],ctx.signal));return rows.length===1&&rows[0].Id===n.id&&rows[0].State.Pid===0&&!rows[0].State.Running;
}
