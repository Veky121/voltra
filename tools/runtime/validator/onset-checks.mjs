import {createHash,randomUUID} from 'node:crypto';
import {campaign as h,receipt,docker} from './campaign-session.mjs';
import {native,wait,logs} from './campaign-adapter.mjs';
export {verifyBuild} from './game-checks.mjs';
export const recipe='onset/egg-onset.json';
export const build='ff6b7d0373b206bd1c448d645620503002b218fcab9d1a8ed74d82caeb090d80';
export const image="ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b";
export const startup="exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/onset_native.py run";
export const sourcePins={
  ".voltra/steam_template.py": "dc8ff0a9e462751878aad55da80bea8fd2a2d4ef16dbf8d37b798ea8d4c476dd",
  ".voltra/native-console.py": "e8274872cb9ccbf7c60bca3615aed0d200c66bc28dc54b7fdd3b243070f9f3e5",
  ".voltra/onset-mariadb-compat.py": "7d68cf7fa520ab5afc5b66a21ddaf66daf4ca2f44c780dbba9336087c839553b",
  ".voltra/additional_survival_install.py": "a2c9dca09dc86279e0f154a5d1574f6e6e68d4c4260687cf6fffe7003ea55b29",
  ".voltra/native-release.py": "31f274542a9d0b85a7a2cf86ad48b62d9ce8a8549b3e0f631de7b8043e88f193",
  ".voltra/small-native-install.py": "13543ec2dac32acafa497b2acd84724dccda5ef5b8fe52571ffc7be10c370a39",
  ".voltra/bundle_debian_python.py": "16b2ebdcfa2656b591624c9d627defa4c3940be4c8a69d8842778ff25ea0cdc0",
  ".voltra/open_world_servers.py": "0dd83bcbc9bd46ceee3661b69e75bd63c2219c909e6a86d20e641ba5e65f8d28",
  ".voltra/open-world-releases.json": "6361344affbdad8f45b75dbaadd3a80105273382606587bdb1af0d6e5c61cfa1",
  ".voltra/onset_native.py": "eb9cdee075176cfefebd9a69be98f836a1b934d723416ff85b97dad4b6faf06e"
};
// Publisher config keeps its existing blank game password. SQL alone uses the env password.
export const configPassword='';
export const testPassword='validator-onset-idle-only';
export const registration={onset:{recipe,ports:3,peakMiB:2048,installPeakMiB:2048,diskMiB:8192,environment:{PUBLIC_SERVER:'false',SERVER_PASSWORD:testPassword}}};
export const retentionRequiredPath='/server_config.json';
export const evidenceLimits=Object.freeze({nativeCurrentPending:true,historicalSourceEquivalent:false,worldSave:false,players:false,WAN:false,gameplay:false,A2SRequired:false,consoleCommands:false,scope:'Native idle/plugin SQL and operator DB/config/package/plugin persistence only'});
const hash=x=>createHash('sha256').update(x).digest('hex'),attrs=x=>x?.attributes??x,contexts=new WeakMap(),processes=new WeakMap();
function owned(ctx){const f=ctx.fixture;if(ctx.game.family!=='onset'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||ctx.game.testStartup||f.ports?.length!==3||new Set(f.ports).size!==3||!f.ports.every(p=>Number.isInteger(p)&&p>=1025&&p<=65535)||!f.ports.includes(f.allocation.port-1)||!f.ports.includes(f.allocation.port-2))throw Error('Exact owned Onset fixture/consecutive offset2 allocations required');return f;}
export async function installedSource(ctx,c){
 const f=owned(ctx),p=h.profileFromRuntime(recipe,receipt),a=attrs(await h.api('/api/application/servers/'+f.server.id));
 if(ctx.build!==build||receipt?.binary_sha256!==build||a.uuid!==f.server.uuid||a.name!==f.server.name||a.egg!==f.egg.id||Number(a.node)===202||a.container?.image!==image||a.container.startup_command!==startup||p.egg.startup!==startup||p.egg.config.stop!=='^C'||Number(a.limits?.memory)!==0)throw Error('Onset exact frozen source and strictly unlimited native RAM required after root resource preparation');
 const emitted=Object.fromEntries([...p.egg.scripts.installation.script.replaceAll('\r\n','\n').matchAll(/cat > (\S+) <<'([^']+)'\n([\s\S]*?)\n\2/g)].map(m=>[m[1],hash(m[3]+'\n')]));
 for(const [path,pin]of Object.entries(sourcePins))if(emitted[path]!==pin||hash(await c.read('/'+path))!==pin)throw Error('Onset frozen emitted/installed helper differs: '+path);
 const egg=attrs(await h.api('/api/admin/eggs/'+f.egg.id));if(egg.uuid!==f.egg.uuid||egg.script_install!==p.egg.scripts.installation.script||egg.config_stop!=='^C')throw Error('Onset served installer/stop authority changed');
 const env=a.container.environment;if(env.AUTO_UPDATE!=='1'||env.VOLTRA_STEAM_AUTO_UPDATE!==undefined&&env.VOLTRA_STEAM_AUTO_UPDATE!=='1'||env.PUBLIC_SERVER!=='false'||![testPassword,'[global integration]'].includes(env.SERVER_PASSWORD)||env.SRCDS_APPID!=='1204170'||env.WINDOWS_INSTALL!=='0'||['STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS','SRCDS_BETAID','INSTALL_FLAGS'].some(k=>env[k]!==''))throw Error('Onset stock anonymous/private explicit controls differ');
 return {helpers:sourcePins,primary:f.allocation.port,image,startup};
}
export function verifyConfig(raw,port){const c=JSON.parse(raw.replace(/^\uFEFF/,''));if(c.port!==port||c.ipaddress!=='0.0.0.0'||c.masterlist!==false||c.password!==configPassword||typeof c.servername!=='string'||!Array.isArray(c.packages)||!Array.isArray(c.plugins))throw Error('Onset owned allocation/private config differs');return c;}
export function verifySnapshotConfig(state,port){verifyConfig(JSON.stringify({...state.config,password:configPassword}),port);if(state.passwordSHA256!==hash(configPassword))throw Error('Onset exact preserved publisher password differs');return state;}
export function verifyExposure(body){if(!body.revision)throw Error('Onset settings revision missing');for(const [key,type]of Object.entries({servername:'text',masterlist:'boolean',password:'text'})){const rows=body.fields?.filter(f=>f.key===key);if(rows?.length!==1||rows[0].type!==type||rows[0].readonly||rows[0].read_only||rows[0].readOnly)throw Error('Onset existing scalar authority differs: '+key);}for(const f of body.fields??[])if(['port','ipaddress','maxplayers','packages','plugins'].includes(f.key)&&!(f.readonly||f.read_only||f.readOnly))throw Error('Onset managed/operator field unexpectedly editable: '+f.key);return {configAuthorityOnly:true,nativeConsumptionPending:true};}
// Root creates the isolated DB first. No DB image download or container creation here.
async function database(ctx){const f=owned(ctx),s=f.onsetSQL;if(!s||!/^validator-onset-[a-z0-9-]+$/.test(s.container)||s.fixture!==f.server.uuid||!Number.isSafeInteger(s.marker)||s.marker<100000||s.marker>999999||!s.requestId)throw Error('Root-owned isolated Onset SQL resource receipt required');const d=JSON.parse(await docker(['inspect',s.container],ctx.signal))[0],game=await native(ctx),gd=game?JSON.parse(await docker(['inspect',game.id],ctx.signal))[0]:null;if(!gd||!Object.keys(d.NetworkSettings.Networks??{}).some(k=>k!=='host'&&k!=='none'&&Object.hasOwn(gd.NetworkSettings.Networks??{},k)))throw Error('Owned DB/game shared network missing');if(!d?.State.Running||d.Config.Labels?.['voltra.acceptance.server']!==s.fixture||d.Config.Labels?.['voltra.acceptance.request']!==s.requestId||d.HostConfig.Memory!==536870912||Object.keys(d.HostConfig.PortBindings??{}).length||Object.values(d.NetworkSettings.Ports??{}).some(v=>v?.length))throw Error('Owned private DB identity/no-public-port boundary differs');return s;}
export function sqlPackage(s){if(!/^validator-onset-[a-z0-9-]+$/.test(s.container)||!Number.isSafeInteger(s.marker)||s.marker<100000||s.marker>999999)throw Error('Bounded SQL choices required');return `local sql = nil
AddEvent("OnPackageStart", function()
 sql = mariadb_connect("${s.container}:3306", "voltra_onset_acceptance", os.getenv("SERVER_PASSWORD"), "voltra_onset_acceptance")
 if sql == false then print("VOLTRA_SQL_CONNECT_FAILED"); return end
 mariadb_query(sql, "CREATE TABLE IF NOT EXISTS acceptance (id INT PRIMARY KEY, boots INT NOT NULL)")
 mariadb_query(sql, "INSERT INTO acceptance VALUES (1,1) ON DUPLICATE KEY UPDATE boots=boots+1")
 mariadb_query(sql, "SELECT ${s.marker},boots FROM acceptance WHERE id=1", function()
  print("VOLTRA_SQL_PROOF marker=" .. tostring(mariadb_get_value_index_int(1,1)) .. " boots=" .. tostring(mariadb_get_value_index_int(1,2)))
 end)
end)
AddEvent("OnPackageStop", function() if sql ~= nil and sql ~= false then mariadb_close(sql) end end)
`;}
export async function prerequisites(ctx,c){const source=await installedSource(ctx,c),s=await database(ctx),config=verifyConfig(await c.read('/server_config.json'),source.primary);if(!config.packages.includes('validator_onset_sql')||hash(await c.read('/packages/validator_onset_sql/server.lua'))!==hash(sqlPackage(s)))throw Error('Root must stage exact sqlPackage and package.json in owned packages/validator_onset_sql, append package without removing defaults');if(ctx.fixture.install?.rawExit!=='0'||!ctx.fixture.install.callback?.success||!ctx.fixture.install.logsFollowed||!ctx.fixture.install.memoryValid||!ctx.fixture.install.removed)throw Error('Raw fresh installer exit/log/callback/memory/removal evidence required');return {source,sqlResourceOwned:true,...evidenceLimits};}

export function snapshotProgram(running){return String.raw`import json,os,hashlib,stat,re,ctypes
from pathlib import Path
r=Path('/home/container')
def observe(name):
 p=r/name
 if p.is_symlink() or not p.resolve().is_relative_to(r) or not p.is_file():raise ValueError('nonregular confined file: '+name)
 a=p.stat()
 if a.st_size>268435456:raise ValueError('oversized bounded file: '+name)
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 z=p.stat()
 if (a.st_ino,a.st_size,a.st_mtime_ns)!=(z.st_ino,z.st_size,z.st_mtime_ns):raise ValueError('unstable file')
 return dict(sha256=h.hexdigest(),bytes=z.st_size,mode=stat.S_IMODE(z.st_mode),uid=z.st_uid,gid=z.st_gid)
pins=json.loads(${JSON.stringify(JSON.stringify(sourcePins))})
for name,pin in pins.items():
 if observe(name)['sha256']!=pin:raise ValueError('installed helper changed')
config=json.loads((r/'server_config.json').read_text(encoding='utf-8-sig'))
publication=json.loads((r/'.voltra/steam-template-release.json').read_text())
if publication.get('appid')!=1204170 or publication.get('StateFlags')!=4 or publication.get('platform')!='linux' or not isinstance(publication.get('buildid'),int):raise ValueError('fresh completed anonymous Steam publication required')
raw=(r/'steamapps/appmanifest_1204170.acf').read_text()
for k,v in [('appid','1204170'),('StateFlags','4'),('buildid',str(publication['buildid']))]:
 if re.findall('"'+k+'"'+r'\s+"([^"]+)"',raw)!=[v]:raise ValueError('Steam manifest differs')
paths=['server_config.json','OnsetServer','.voltra/steam-template-release.json','.voltra/onset-mariadb/release.json','.voltra/onset-mariadb/copyright','.voltra/onset-mariadb/lib/libmariadbclient.so.18',*pins]
operator=[]
for folder in ['packages','plugins','autostart']:
 d=r/folder
 if not d.exists():continue
 if d.is_symlink() or not d.is_dir():raise ValueError('invalid operator directory')
 for f in sorted(d.rglob('*')):
  if f.is_symlink():raise ValueError('operator symlink')
  if f.is_file():operator.append(str(f.relative_to(r)))
  if len(operator)>10000:raise ValueError('operator inventory unbounded')
manifest={n:observe(n) for n in sorted(set(paths+operator))}
compat=json.loads((r/'.voltra/onset-mariadb/release.json').read_text())
if compat.get('package_version')!='1:10.11.19-0+deb12u1' or compat.get('package_sha256')!='cfd599e218eb53c471014b40d180f2f7f9ca7debaacfbd271bc9e4f4cc6eec39' or compat.get('library_sha256')!='2db2abfde1604086774bcb5e7a8f6216728f21e8ca3b7d79ecfb40c215a49763' or manifest['.voltra/onset-mariadb/lib/libmariadbclient.so.18']['sha256']!=compat['library_sha256'] or manifest['.voltra/onset-mariadb/copyright']['sha256']!=compat.get('copyright_sha256'):raise ValueError('published compatibility identity differs')
# Actual published helper version, RTLD_NOW and all exact versioned symbols.
import importlib.util,sys
sys.path.insert(0,str(r/'.voltra'))
spec=importlib.util.spec_from_file_location('compat',r/'.voltra/onset-mariadb-compat.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
abi=module.validate(r/module.RELATIVE)
state=dict(manifest=manifest,publication=publication,compatibility=compat,abi=abi,config={k:config.get(k) for k in ['servername','masterlist','maxplayers','port','ipaddress','packages','plugins','voice']},passwordSHA256=hashlib.sha256(config['password'].encode()).hexdigest())
if ${running?'True':'False'}:
 found=[]
 for p in Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   if os.readlink(p/'exe')!=str(r/'OnsetServer'):continue
   argv=[x.decode() for x in (p/'cmdline').read_bytes().split(b'\0') if x]
   if argv!=[str(r/'OnsetServer'),'--noinput'] or os.readlink(p/'cwd')!=str(r):raise ValueError('actual native argv/cwd differs')
   if hashlib.sha256((p/'exe').read_bytes()).hexdigest()!=manifest['OnsetServer']['sha256']:raise ValueError('actual native executable differs')
   maps=(p/'maps').read_text();loaded=[name for name in operator if name.endswith('.so') and str(r/name) in maps]
   if not any('mariadb' in name.lower() for name in loaded) or str(r/module.RELATIVE) not in maps:raise ValueError('native MariaDB plugin/private client not actually mapped')
   inodes=set()
   for fd in (p/'fd').iterdir():
    try:link=os.readlink(fd)
    except FileNotFoundError:continue
    if link.startswith('socket:['):inodes.add(link[8:-1])
   sockets={}
   for kind in ['udp','udp6','tcp','tcp6']:
    sockets[kind]=[]
    for line in (Path('/proc/net')/kind).read_text().splitlines()[1:]:
     fields=line.split()
     if len(fields)>9 and fields[9] in inodes and (kind.startswith('udp') or fields[3]=='0A'):sockets[kind].append(int(fields[1].split(':')[-1],16))
   found.append(dict(pid=int(p.name),startTicks=int((p/'stat').read_text().rsplit(')',1)[1].split()[19]),direct=True,argv=argv,loadedPlugins=loaded,sockets=sockets,binarySHA256=manifest['OnsetServer']['sha256']))
  except (FileNotFoundError,ProcessLookupError,PermissionError):continue
 if len(found)!=1:raise ValueError('unique native Onset process required')
 state['process']=found[0]
print(json.dumps(state))`;}
export async function snapshot(ctx,running=false){
 const f=owned(ctx),n=await native(ctx);if(!n)throw Error('Owned native container missing');
 const d=JSON.parse(await docker(['inspect',n.id],ctx.signal))[0];if(d.HostConfig.Memory!==0||d.HostConfig.MemorySwap>0)throw Error('Strict unlimited native Docker memory required');
 const program=snapshotProgram(running),env=['-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib'];
 const args=running?['exec',...env,n.id,'/home/container/.voltra/python/bin/python3','-B','-c',program]:['run','--rm','--pull','never','--network','none','--read-only','--user','0:0','--memory','512m','--memory-swap','512m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges',...env,'--mount','type=bind,src=/var/lib/voltra-parity-20261029/volumes/'+f.server.uuid+',dst=/home/container,readonly','--entrypoint','/home/container/.voltra/python/bin/python3',image,'-B','-c',program];
 try{return verifySnapshotConfig({...JSON.parse(await docker(args,ctx.signal,60000)),containerId:n.id,startedAt:n.state.StartedAt},f.allocation.port);}catch(error){await ctx.artifact('onset-snapshot-failure-'+Date.now()+'.json',{message:String(error),containerId:n.id,state:n.state,running});throw error;}
}
async function sqlReadback(ctx){const s=await database(ctx),raw=await docker(['exec',s.container,'mariadb','--batch','--skip-column-names','-uvoltra_onset_acceptance','-p'+testPassword,'voltra_onset_acceptance','-e','SELECT id,boots FROM acceptance ORDER BY id'],ctx.signal);if(!/^1\t[1-9][0-9]*\s*$/.test(raw))throw Error('Owned SQL single-row native counter readback differs');return {marker:s.marker,boots:Number(raw.trim().split('\t')[1])};}
export async function ready(ctx,c){
 const source=await installedSource(ctx,c),n=await native(ctx);if(!n?.state.Running||!Number.isFinite(ctx.startRequestedAt)||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;
 const text=await logs(ctx,n.state.StartedAt),plain=text.replace(/\x1b\[[0-9;]*m/g,'');
 await ctx.artifact('onset-native-observation.json',{containerId:n.id,state:n.state,logSHA256:hash(text),readyMarker:plain.includes('Entering simulation'),mariadbLoaded:plain.includes('MariaDB: v1.0 successfully loaded.'),sqlMarkers:plain.match(/VOLTRA_SQL_PROOF marker=\d+ boots=\d+/g)??[],secretValuesOmitted:true});
 if(!plain.includes('Entering simulation'))return false;
 const resource=await database(ctx);if(!plain.includes('VOLTRA_SQL_PROOF marker='+resource.marker+' boots='))return false;
 if(!/Success! App '1204170' (?:fully installed|already up to date)\./.test(plain))throw Error('Onset default AUTO_UPDATE1 fresh publisher success missing');
 const state=await snapshot(ctx,true),config=verifyConfig(await c.read('/server_config.json'),source.primary),sql=await sqlReadback(ctx),s=await database(ctx);
 const expectedBoots=(contexts.get(ctx)?.sql?.boots??0)+1;if(sql.boots!==expectedBoots)throw Error('Onset native SQL boot counter not the exact next owned boot');
 if(!plain.includes('MariaDB: v1.0 successfully loaded.')||!plain.includes(`VOLTRA_SQL_PROOF marker=${s.marker} boots=${sql.boots}`)||!plain.includes(`Max players set to ${config.maxplayers}`)||state.passwordSHA256!==hash(config.password))throw Error('Fresh native plugin/SQL/config consumption missing');
 const sockets=state.process.sockets;if(![...(sockets.udp??[]),...(sockets.udp6??[])].includes(source.primary)||![...(sockets.udp??[]),...(sockets.udp6??[])].includes(source.primary-1)||![...(sockets.tcp??[]),...(sockets.tcp6??[])].includes(source.primary-2))throw Error('Actual native allocated socket ownership missing');
 contexts.set(ctx,{...contexts.get(ctx),state,sql});processes.set(ctx,{containerId:n.id,startedAt:n.state.StartedAt,process:state.process});return {process:state.process,sql,publication:state.publication,abi:state.abi,...evidenceLimits};
}
async function stopped(ctx,c){const proof=processes.get(ctx),n=await native(ctx),text=n?await logs(ctx,n.state.StartedAt):'';await ctx.artifact('onset-native-stop-'+Date.now()+'.json',{proof,state:n?.state,containerId:n?.id,logSHA256:hash(text),secretValuesOmitted:true});if(!proof?.process.direct||!n||n.id!==proof.containerId||n.state.StartedAt!==proof.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline'||Date.parse(n.state.FinishedAt)<Date.parse(n.state.StartedAt)||/grace expired|escalating owned process|Native process exited:/.test(text))throw Error('Current process-bound Onset clean SIGINT exit0 required');return {...proof,finishedAt:n.state.FinishedAt,engineExitProven:true,engineNumericExit:0};}
export async function settings(ctx,c){await c.power('stop');await wait(ctx,async()=>await c.state()==='offline'&&!(await native(ctx))?.state.Running,'Onset stopped typed edit');await stopped(ctx,c);const route='/api/client/servers/'+owned(ctx).server.uuid+'/game-settings?file=%2Fserver_config.json',before=attrs(await h.api(route)),raw=await c.read('/server_config.json');verifyExposure(before);verifyConfig(raw,owned(ctx).allocation.port);const changes={servername:'Onset '+randomUUID().slice(0,8)};await h.api(route,'PUT',{revision:before.revision,settings:changes});const after=attrs(await h.api(route)),patched=await c.read('/server_config.json');verifyConfig(patched,owned(ctx).allocation.port);const strip=t=>t.replace(/("servername"\s*:\s*)"(?:\\.|[^"\\])*"/g,'$1"VALUE"');if(after.revision===before.revision||strip(raw)!==strip(patched)||JSON.parse(patched).servername!==changes.servername)throw Error('Onset exact typed name edit/opaque preservation failed');for(const settings of [{maxplayers:'7'},{port:'1'},{ipaddress:'127.0.0.1'}]){let refused=false;try{await h.api(route,'PUT',{revision:after.revision,settings});}catch(e){if(!/: (?:400|422) /.test(e.message))throw e;refused=true;}if(!refused||await c.read('/server_config.json')!==patched)throw Error('Onset readonly refusal changed config');}let stale=false;try{await h.api(route,'PUT',{revision:before.revision,settings:changes});}catch(e){if(!/: 409 /.test(e.message))throw e;stale=true;}if(!stale||await c.read('/server_config.json')!==patched)throw Error('Onset stale refusal failed');ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'Onset typed restart and native SQL');contexts.set(ctx,{...contexts.get(ctx),edited:true});return {typedConfigReadback:true,nativeNameConsumptionClaim:false,sql:fresh.sql,staleRefused:true,managedRefused:true,...evidenceLimits};}
export function retentionPaths(ctx){owned(ctx);return ['/server_config.json','/packages','/plugins',...(Object.keys(contexts.get(ctx)?.state?.manifest??{}).some(p=>p.startsWith('autostart/'))?['/autostart']:[]),'/.voltra/onset-mariadb',...Object.keys(sourcePins).map(p=>'/'+p)];}
export function restoreContext(ctx,saved){owned(ctx);if(!saved?.baseline?.manifest||saved.baseline.passwordSHA256!==hash(configPassword)||!saved.stop?.process.direct||saved.stop.engineExitProven!==true||saved.stop.engineNumericExit!==0||!Number.isSafeInteger(saved.sql?.boots))throw Error('Onset prior native/plugin/SQL/stop proof missing');contexts.set(ctx,{state:saved.baseline,sql:saved.sql,edited:true});processes.set(ctx,saved.stop);}
export async function saved(ctx,c){if(!contexts.get(ctx)?.edited)throw Error('Onset typed/native cycle missing');const stop=await stopped(ctx,c),baseline=await snapshot(ctx),sql=await sqlReadback(ctx);return {baseline,stop,sql,...evidenceLimits};}
export async function retentionStop(ctx,c,saved){restoreContext(ctx,saved);const stop=await stopped(ctx,c);if(stop.containerId!==saved.stop.containerId||stop.startedAt!==saved.stop.startedAt)throw Error('Onset latest stop differs');return await (async()=>{const baseline=await snapshot(ctx),sql=await sqlReadback(ctx);return {...saved,stop,baseline,sql};})();}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const fresh=await ready(ctx,c),state=contexts.get(ctx)?.state;if(!fresh||fresh.sql.boots!==saved.sql.boots+1||state.startedAt===saved.stop.startedAt||fresh.process.pid===saved.stop.process.pid&&fresh.process.startTicks===saved.stop.process.startTicks)throw Error('Onset fresh native SQL increment/reload identity missing');if(state.publication.buildid!==saved.baseline.publication.buildid||state.manifest.OnsetServer.sha256!==saved.baseline.manifest.OnsetServer.sha256)throw Error('Onset publisher payload changed during reload; root reviews current publication');if(JSON.stringify(state.config)!==JSON.stringify(saved.baseline.config)||state.passwordSHA256!==saved.baseline.passwordSHA256)throw Error('Onset retained config values differ');for(const [name,row]of Object.entries(saved.baseline.manifest)){if(!Object.hasOwn(sourcePins,name)&&!name.startsWith('plugins/')&&!name.startsWith('.voltra/onset-mariadb/')&&!name.startsWith('packages/validator_onset_sql/'))continue;if(JSON.stringify(state.manifest[name])!==JSON.stringify(row))throw Error('Onset retained operator bytes/metadata changed across boot: '+name);}await c.power('stop');await wait(ctx,async()=>await c.state()==='offline'&&!(await native(ctx))?.state.Running,'Onset final clean stop');return {fresh,stop:await stopped(ctx,c),operatorSQLPersistence:true,...evidenceLimits};}
