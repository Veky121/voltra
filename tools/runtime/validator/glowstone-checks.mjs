import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { campaign as h, receipt, docker } from './campaign-session.mjs';
import { native, logs, wait, command } from './campaign-adapter.mjs';
export { verifyBuild } from './game-checks.mjs';
const recipe='minecraft/java/glowstone/egg-glowstone.json',file='/config/glowstone.yml';
export const registration={glowstone:{recipe,ports:1,environment:{SERVER_JARFILE:'glowstone.jar',VERSION:'2021.8.0',GITHUB_USER:'',GITHUB_OAUTH_TOKEN:'',GITHUB_PACKAGE:'GlowstoneMC/Glowstone',MATCH:'glowstone.jar',USE_EXISTING_JAR:'false'}}};
export const budgets={memoryMiB:3072,diskMiB:4096,startupMs:300000,stopMs:90000};
export const retentionRequiredPath=file;
const jarSHA='825b38efc340c1489ce91f31a50e3a632438dde92e5770f2d84486314d42cbbd';
const pluginSHA='2ed9a8adef2869793580f08ef6de398cfa95b7f0df6bf4b8168f3385e190e2bc';
const pluginSourceSHA='5c1142c4b808cf5736f820ce00201fbad26fd8daddb99f14211de84911bccf51';
const pluginYmlSHA='6b645a565490d27531235286f4eff7035a183920d8f2e219a935ce71132ae6b8';
const forkSHA='45ca27d31692978f0915aa549071dce1643dc91924cc3c0e62a695bda5f4e879';
const cache=resolve('C:/Users/Veky/.t3/projects/pteroclone/ptero-go/.local/java-forks/glowstone-plugin');
const hash=value=>createHash('sha256').update(value).digest('hex');
const scope='Legacy Glowstone1.12.2/Java8 idle native query/settings, controlled test-plugin GOLD_BLOCK save/reload, exact source and clean native exit only. No players, gameplay, modern client, WAN or cross-server plugin compatibility claim.';
const proofs=new WeakMap();
function owned(ctx){const f=ctx.fixture;if(ctx.game.family!=='glowstone'||ctx.game.recipe!==recipe||f?.recipe!==recipe||f.server?.uuid!==ctx.game.serverUUID||f.server.name!=='validator-'+ctx.game.id||!/^[a-f0-9-]{36}$/.test(ctx.game.canonicalEggUUID??'')||f.ports?.length!==1||ctx.game.testStartup)throw Error('Exact root-created canonical Glowstone fixture/catalog UUID required');return f.server;}
const url=ctx=>'/api/client/servers/'+owned(ctx).uuid+'/game-settings?file='+encodeURIComponent(file);
async function authority(ctx,c){
 const f=ctx.fixture,p=h.profileFromRuntime(recipe,receipt),s=(await h.api('/api/application/servers/'+owned(ctx).id)).attributes,e=(await h.api('/api/admin/eggs/'+s.egg)).attributes;
 const script=p.egg.scripts.installation.script,allowedScripts=[script];
 if(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(f.gateId??'')){const gated=h.installerGate(script,f.gateId);allowedScripts.push(gated,gated.replace(/\n$/, ''));}
 if(p.revision!=='java-forks-managed-v1'||p.egg.startup!=='java -Xms128M -Dterminal.jline=false -Dterminal.ansi=false -jar "{{SERVER_JARFILE}}"'||p.egg.voltra?.java_config?.default_major!==8||e.uuid!==ctx.game.canonicalEggUUID||s.egg!==f.egg.id||!allowedScripts.includes(e.script_install)||p.egg.config.stop!=='stop')throw Error('Exact Glowstone canonical Java8/source authority differs');
 const runtimes=(await h.api('/api/admin/java/runtimes')).data.map(x=>x.attributes??x);if(!runtimes.some(r=>r.enabled===true&&Number(r.major)===8&&r.image===s.container.image))throw Error('Canonical automatic Java8 effective image differs');
 if(s.container.environment.SERVER_JARFILE!=='glowstone.jar'||!['latest','2021.8.0'].includes(s.container.environment.VERSION)||Object.keys(s.java_config??{}).length)throw Error('Glowstone canonical version/JAR/Java override differs');
 // Wings server/install.go:250 converts CRLF to LF before executing the script.
  // Extract exact emitted bytes AFTER that source-proven conversion only.
  const helpers={};for(const m of p.egg.scripts.installation.script.replaceAll('\r\n','\n').matchAll(/cat > (\.voltra\/[\w.-]+) <<'([^']+)'\n([\s\S]*?)\n\2/g)){helpers['/'+m[1]]=hash(m[3]+'\n');if(hash(await c.read('/'+m[1]))!==helpers['/'+m[1]])throw Error('Installed Glowstone helper differs: '+m[1]);}
 if(helpers['/.voltra/java_fork_install.py']!==forkSHA)throw Error('Reviewed candidate19 fork helper changed');return {helpers,effectiveJavaImage:s.container.image};
}
export async function prerequisites(ctx,c){
 if(await c.state()!=='offline')throw Error('Glowstone preparation requires parked owned fixture');const source=await authority(ctx,c);
 const plugin=await readFile(resolve(cache,'VoltraGlowstoneAcceptance.jar')),java=await readFile(resolve(cache,'VoltraGlowstoneAcceptance.java')),manifest=await readFile(resolve(cache,'plugin.yml'));
 if(plugin.length!==3475||hash(plugin)!==pluginSHA||hash(java)!==pluginSourceSHA||hash(manifest)!==pluginYmlSHA)throw Error('Historical actual plugin/source cache differs; adapter never compiles/replaces it');
 if(ctx.game.offlineHelperImage!=='sha256:e6dae589c1c05976188fd3bd019afd091445fc533ed2ea29001beddc7368a9c8')throw Error('Immutable offline Python/NBT helper required');
 await ctx.artifact('glowstone-test-plugin-intent.json',{pluginSHA,pluginSourceSHA,pluginYmlSHA,worldEdit:'Owned test plugin saves GOLD_BLOCK at0,70,0; reload log is captured BEFORE plugin rewrites it',scope});
 await c.write('/eula.txt','eula=true\n');if(await c.read('/eula.txt')!=='eula=true\n')throw Error('Glowstone EULA readback differs');await ctx.artifact('glowstone-eula.json',{accepted:true,terms:'https://www.minecraft.net/eula',at:new Date().toISOString(),authority:'User explicitly authorized game-server EULA acceptance',fixture:ctx.fixture.server.uuid});
 const doc=(await h.api(url(ctx))).attributes,settings={'/server/max-players':'6','/server/motd':'Validator Glowstone literal $safe','/world/name':'validator_glow_world','/world/seed':'517077','/world/level-type':'FLAT','/world/spawn-radius':'1','/world/view-distance':'2','/world/gen-structures':false,'/world/allow-nether':false,'/world/allow-end':false,'/world/keep-spawn-loaded':false};
 for(const key of Object.keys(settings))if(!doc.fields?.some(f=>f.key===key&&f.readonly===false))throw Error('Actual existing Glowstone test-config field absent: '+key);
 await ctx.artifact('glowstone-test-config-intent.json',{fixture:ctx.fixture.server.uuid,beforeSHA:hash(await c.read(file)),beforeRevision:doc.revision,previousOwnedTest:ctx.fixture.glowstoneTest??null,settings,scope:'Offline controlled test baseline; preserve existing world and plugin boot history. Capacity resets to6 before exercising7 again.'});
 await h.api(url(ctx),'PUT',{revision:doc.revision,settings});
 const after=(await h.api(url(ctx))).attributes;for(const [key,value]of Object.entries(settings))if(String(after.fields.find(f=>f.key===key)?.value)!==String(value))throw Error('Glowstone test config readback differs');
 ctx.glowstone={edited:false};
 await ctx.artifact('glowstone-test-config-readback.json',{afterSHA:hash(await c.read(file)),revision:after.revision,settings});
 // The shared file writer sends this Buffer as raw request bytes; installed
 // plugin contents are independently hashed inside the real game container.
 const root=(await c.api('GET','/api/client/servers/'+ctx.fixture.server.uuid+'/files/list?directory=%2F')).data;
 if(!Array.isArray(root))throw Error('Glowstone plugin parent inventory absent');const directories=root.map(row=>row.attributes??row).filter(row=>row.name==='plugins');
 if(directories.length>1||directories.some(row=>row.is_file!==false||row.is_symlink!==false))throw Error('Unsafe plugin parent');
 if(!directories.length)await c.api('POST','/api/client/servers/'+ctx.fixture.server.uuid+'/files/create-folder',{root:'/',name:'plugins'});
 await c.write('/plugins/VoltraGlowstoneAcceptance.jar',plugin);
 await ctx.own({...ctx.fixture,glowstoneTest:{world:'validator_glow_world',pluginSHA,expectedCapacity:6}});
 return {source,pluginSHA,testSettings:settings,scope};
}
function vint(value){const out=[];do{let b=value&127;value>>>=7;if(value)b|=128;out.push(b)}while(value);return Buffer.from(out)}
function readVint(b,at=0){let value=0;for(let n=0;n<5;n++){if(at+n>=b.length)return null;const byte=b[at+n];value|=(byte&127)<<(n*7);if(!(byte&128))return{value,bytes:n+1}}throw Error('Oversized Minecraft VarInt');}
const packet=body=>Buffer.concat([vint(body.length),body]);
async function query(ctx,capacity){return new Promise((resolve,reject)=>{
 const port=ctx.fixture.ports[0],nonce=randomBytes(8),socket=net.createConnection({host:'127.0.0.1',port});let data=Buffer.alloc(0),status,done=false;
 const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);ctx.signal.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(value)};
 const abort=()=>finish(Error('Glowstone status aborted')),timer=setTimeout(()=>finish(Error('Glowstone native status timeout')),5000);ctx.signal.addEventListener('abort',abort,{once:true});
 socket.on('error',()=>finish(Error('Glowstone status socket failed')));socket.on('close',()=>{if(!done)finish(Error('Glowstone status closed before nonce reply'))});
 socket.on('connect',()=>{const address=Buffer.from('127.0.0.1'),p=Buffer.alloc(2);p.writeUInt16BE(port);socket.write(Buffer.concat([packet(Buffer.concat([vint(0),vint(340),vint(address.length),address,p,vint(1)])),packet(vint(0))]))});
 socket.on('data',chunk=>{try{data=Buffer.concat([data,chunk]);if(data.length>524288)throw Error('Oversized status payload');while(data.length){const length=readVint(data);if(!length||data.length<length.bytes+length.value)return;const body=data.subarray(length.bytes,length.bytes+length.value);data=data.subarray(length.bytes+length.value);const id=readVint(body);if(!id)throw Error('Missing packet type');if(!status){if(id.value!==0)throw Error('Not native status JSON');const size=readVint(body,id.bytes);if(!size||body.length!==id.bytes+size.bytes+size.value)throw Error('Invalid status JSON frame');status=JSON.parse(body.subarray(id.bytes+size.bytes).toString());if(status.version?.protocol!==340||status.players?.online!==0||status.players?.max!==capacity||status.description?.text!=='Validator Glowstone literal $safe')throw Error('Native Glowstone legacy/settings status differs');socket.write(packet(Buffer.concat([vint(1),nonce])))}else{if(id.value!==1||!body.subarray(id.bytes).equals(nonce))throw Error('Native ping nonce mismatch');finish(null,{...status,nonceEcho:true,playerLoginSent:false})}}}catch(error){finish(error)}});if(ctx.signal.aborted)abort();
});}
async function processProof(ctx){
 const n=await native(ctx);if(!n?.state.Running)throw Error('Glowstone process missing');
 const script='set -eu\nsha256sum /home/container/glowstone.jar /home/container/plugins/VoltraGlowstoneAcceptance.jar\nfor p in /proc/[0-9]*; do exe=$(readlink "$p/exe" 2>/dev/null || true); case "$exe" in */bin/java) args=$(tr "\\000" "\\n" < "$p/cmdline"); if printf "%s\\n" "$args" | grep -qx glowstone.jar; then printf "ENGINE %s %s %s\\n" "${p##*/}" "$(awk \'/^PPid:/ {print $2}\' "$p/status")" "$(awk \'{print $22}\' "$p/stat")"; fi;; esac; done';
 const raw=await docker(['exec',n.id,'sh','-ec',script],ctx.signal,30000),lines=raw.trim().split(/\r?\n/),engineLines=lines.filter(l=>l.startsWith('ENGINE '));
 if(!lines.some(l=>l.startsWith(jarSHA+' ')&&l.endsWith('/glowstone.jar'))||!lines.some(l=>l.startsWith(pluginSHA+' ')&&l.endsWith('/plugins/VoltraGlowstoneAcceptance.jar'))||engineLines.length!==1)throw Error('Glowstone native JAR/plugin/process identity differs');
 const [,pid,ppid,startTicks]=engineLines[0].split(' ');let entrypoint;
 if(pid!=='1'){
  if(ppid!=='1')throw Error('Glowstone unknown engine supervisor');const text=await docker(['exec',n.id,'cat','/entrypoint.sh'],ctx.signal,10000),last=text.split(/\r?\n/).filter(l=>l.trim()&&!l.trim().startsWith('#')).at(-1)?.trim();
  if(!['eval ${STARTUP}','eval "${STARTUP}"','exec ${STARTUP}','exec "${STARTUP}"','eval ${MODIFIED_STARTUP}','eval "${MODIFIED_STARTUP}"','exec ${MODIFIED_STARTUP}','exec "${MODIFIED_STARTUP}"'].includes(last))throw Error('Unreviewed Java entrypoint status propagation');entrypoint={sha256:hash(text),lastCommand:last,scope:'Exact inspected image script ends in native startup eval/exec; no later command remaps status'};
 }
 const [id]=JSON.parse(await docker(['inspect',n.id],ctx.signal));return{containerId:n.id,startedAt:n.state.StartedAt,imageId:id.Image,engine:{pid:Number(pid),ppid:Number(ppid),startTicks,direct:true},entrypoint,jarSHA,pluginSHA};
}
export async function ready(ctx,c){
 const n=await native(ctx);if(!n||n.state.Status==='created'||!Number.isFinite(Date.parse(n.state.StartedAt))||Date.parse(n.state.StartedAt)<ctx.startRequestedAt)return false;if(!n.state.Running)throw Error('Glowstone exited before readiness: '+n.state.ExitCode);
 const text=(await logs(ctx,n.state.StartedAt)).replace(/\x1b\[[0-9;]*m/g,'');if(!text.includes('Ready for connections.')||await c.state()!=='running')return false;
 const loaded=/VOLTRA_GLOW_WORLD_LOADED block=(\w+) seed=(-?\d+) name=([\w-]+)/.exec(text),boots=/VOLTRA_GLOW_PLUGIN_ENABLED boots=(\d+)/.exec(text);
 if(!loaded||!boots||!text.includes('VOLTRA_GLOW_WORLD_SAVED block=GOLD_BLOCK')||loaded[2]!=='517077'||loaded[3]!=='validator_glow_world')throw Error('Fresh native plugin world load/save proof absent');
 const source=await authority(ctx,c),process=await processProof(ctx),capacity=ctx.glowstone?.edited?7:6,discovery=await query(ctx,capacity);proofs.set(ctx,process);
 return {...process,source,discovery,world:{loadedBlock:loaded[1],seed:loaded[2],name:loaded[3],boots:Number(boots[1])},scope};
}
async function clean(ctx,c){const p=proofs.get(ctx),n=await native(ctx);if(!p||n?.id!==p.containerId||n.state.StartedAt!==p.startedAt||n.state.Running||n.state.ExitCode!==0||n.state.OOMKilled||n.state.Dead||await c.state()!=='offline')throw Error('Glowstone exact native clean exit0 unproved');const text=await logs(ctx,n.state.StartedAt);if(!text.includes('VOLTRA_GLOW_PLUGIN_DISABLED'))throw Error('Native plugin shutdown missing');return{...p,engineNumericExit:0,engineExitProven:true,nativeState:n.state};}
export async function settings(ctx,c){await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Glowstone settings stop',budgets.stopMs);await clean(ctx,c);const before=(await h.api(url(ctx))).attributes;if(!before.fields.some(f=>f.key==='/server/max-players'&&f.type==='number'&&f.readonly===false))throw Error('Glowstone typed native capacity missing');await h.api(url(ctx),'PUT',{revision:before.revision,settings:{'/server/max-players':'7'}});const after=(await h.api(url(ctx))).attributes;if(String(after.fields.find(f=>f.key==='/server/max-players')?.value)!=='7')throw Error('Glowstone typed capacity readback differs');ctx.glowstone={edited:true};ctx.startRequestedAt=Date.now();await c.power('start');const fresh=await wait(ctx,()=>ready(ctx,c),'Glowstone edited native load',budgets.startupMs);if(fresh.world.loadedBlock!=='GOLD_BLOCK'||fresh.world.boots<2)throw Error('Actual saved block was not loaded before plugin write');const console=await command(ctx,'voltrastate',/VOLTRA_GLOW_COMMAND boots=\d+ block=GOLD_BLOCK seed=517077 name=validator_glow_world/);return{changes:{'/server/max-players':'7'},fresh,console,scope};}
export function retentionPaths(ctx){owned(ctx);return [file,'/worlds/validator_glow_world','/plugins','/glowstone.jar','/.voltra/java_fork_install.py','/.voltra/java-fork-releases.json'];}
export function restoreContext(ctx,saved){owned(ctx);if(!saved?.engineExitProven||saved.engineNumericExit!==0||!saved.processProof?.engine?.direct||!saved.world?.seed||!saved.baseline)throw Error('Glowstone retained native proof absent');ctx.glowstone={edited:true,baseline:saved.baseline};}
async function disk(ctx){
 const n=await native(ctx);if(!n||n.state.Running||n.state.ExitCode!==0)throw Error('Glowstone snapshot requires clean offline process');const source='/var/lib/voltra-parity-20261029/volumes/'+owned(ctx).uuid;const [id]=JSON.parse(await docker(['inspect',n.id],ctx.signal));if(id.Name!=='/'+ctx.fixture.server.uuid||id.State.Running||id.Mounts.filter(m=>m.Source===source&&m.Destination==='/home/container').length!==1||id.Mounts.some(m=>m.Destination.startsWith('/home/container/')))throw Error('Glowstone owned stopped mount mismatch');
 const script=String.raw`import pathlib,gzip,hashlib,json,stat,struct,io
r=pathlib.Path('/source');p=r/'worlds/validator_glow_world/level.dat'
# Actual publisher config folders.worlds=worlds and native world.name select this path.
# Reject a changed folder authority rather than silently inspect another tree.
config=r/'config/glowstone.yml'
if any(x.is_symlink() for x in [config,*config.parents]):raise ValueError('Symlink config authority')
import re
text=config.read_text()
folders=re.findall(r'^folders:\s*\n((?:[ \t]+[^\n]*\n)*)',text,re.M)
if len(folders)!=1 or re.findall(r'^    worlds: ([^\r\n]+)',folders[0],re.M)!=['worlds']:raise ValueError('Native world folder authority differs')
for q in [p,*p.parents]:
 if q==r.parent:break
 if q.is_symlink():raise ValueError('Symlink in native level path')
if p.stat().st_size>1048576:raise ValueError('Compressed NBT size')
raw=p.read_bytes();data=gzip.GzipFile(fileobj=io.BytesIO(raw)).read(1048577)
if len(data)>1048576:raise ValueError('Oversized native NBT')
at=0

def take(n):
 global at
 if n<0 or at+n>len(data):raise ValueError('Truncated NBT')
 v=data[at:at+n];at+=n;return v

def num(f):return struct.unpack('>'+f,take(struct.calcsize(f)))[0]
def text():return take(num('H')).decode('utf8')
def tag(t,depth=0):
 if depth>32:raise ValueError('NBT depth')
 if t in [1,2,3,4,5,6]:return num({1:'b',2:'h',3:'i',4:'q',5:'f',6:'d'}[t])
 if t==8:return text()
 if t in [7,11,12]:
  n=num('i')
  if n<0 or n>1048576:raise ValueError('Array bound')
  take(n*{7:1,11:4,12:8}[t]);return None
 if t==9:
  kind=num('B');n=num('i')
  if n<0 or n>100000:raise ValueError('List bound')
  return [tag(kind,depth+1)for _ in range(n)]
 if t==10:
  result={}
  while True:
   kind=num('B')
   if kind==0:return result
   key=text();result[key]=tag(kind,depth+1)
 raise ValueError('Unknown native NBT')
if num('B')!=10:raise ValueError('Root NBT')
text();root=tag(10);world=root.get('Data',root)
if at!=len(data)or world.get('RandomSeed')!=517077 or world.get('LevelName')!='validator_glow_world':raise ValueError('Native world seed/name differs')
config=r/'config/glowstone.yml';plugin=r/'plugins/VoltraGlowstoneAcceptance.jar'
for target in [config,plugin]:
 for ancestor in [target,*target.parents]:
  if ancestor==r.parent:break
  if ancestor.is_symlink():raise ValueError('Symlink in native source/config path')
 if not target.is_file() or target.stat().st_size>1048576:raise ValueError('Invalid config/plugin file')
if p.read_bytes()!=raw:raise ValueError('Stopped level.dat changed during snapshot')
print(json.dumps(dict(seed=str(world['RandomSeed']),name=world['LevelName'],levelSHA256=hashlib.sha256(raw).hexdigest(),configSHA256=hashlib.sha256(config.read_bytes()).hexdigest(),pluginSHA256=hashlib.sha256(plugin.read_bytes()).hexdigest(),mode=stat.S_IMODE(p.stat().st_mode),uid=p.stat().st_uid,gid=p.stat().st_gid)))`;
 const helper='validator-glowstone-snapshot-'+randomUUID();await ctx.artifact('glowstone-snapshot-helper-'+Date.now()+'.json',{helper,source,image:ctx.game.offlineHelperImage,readonly:true});const result=JSON.parse(await docker(['run','--rm','--pull','never','--name',helper,'--user','0:0','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--security-opt','no-new-privileges','--mount','type=bind,src='+source+',dst=/source,readonly','--entrypoint','python3',ctx.game.offlineHelperImage,'-B','-c',script],ctx.signal,30000));const after=await native(ctx);if(after?.id!==n.id||after.state.Running||after.state.StartedAt!==n.state.StartedAt||after.state.FinishedAt!==n.state.FinishedAt||result.pluginSHA256!==pluginSHA)throw Error('Glowstone stopped snapshot changed');return result;
}
export async function saved(ctx,c){if(!ctx.glowstone?.edited)throw Error('Glowstone edited context missing');const processProof=await clean(ctx,c),baseline=await disk(ctx);return{baseline,world:{seed:baseline.seed,name:baseline.name},processProof,engineNumericExit:0,engineExitProven:true,scope};}
export async function loaded(ctx,c,saved){restoreContext(ctx,saved);const fresh=await ready(ctx,c);if(!fresh||fresh.startedAt===saved.processProof.startedAt||fresh.world.loadedBlock!=='GOLD_BLOCK'||fresh.world.seed!==saved.world.seed)throw Error('Glowstone fresh saved-block reload missing');await c.power('stop');await wait(ctx,async()=>await c.state()==='offline','Glowstone reload stop',budgets.stopMs);const stop=await clean(ctx,c),baseline=await disk(ctx);if(baseline.configSHA256!==saved.baseline.configSHA256||baseline.seed!==saved.baseline.seed||baseline.name!==saved.baseline.name)throw Error('Glowstone config/native identity reload differs');return{fresh,stop,baseline,savedBlockLoadedBeforePluginMutation:true,scope};}
