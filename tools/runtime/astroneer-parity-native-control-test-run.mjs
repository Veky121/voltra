// Root-authorized owned fixture acceptance actions; every action checks pause/runtime.
import fs from 'node:fs';
import {api,docker,containers,activeLease,verifyRuntime,observePower,digest} from './campaign-native-20261029.mjs';
import {capturePython} from './astroneer-parity-native.mjs';
const id='2b0703e0-e216-4b1a-b48a-0d2afe4f7d00',uuid='ade0b289-f128-4cf9-8f3b-9c0ca4ef94e4',folder='.local/game-parity-20261029/astroneer-native/'+id;
const [action,label='first']=process.argv.slice(2),state=JSON.parse(fs.readFileSync(folder+'/state.json'));
if(!['boot','restart-api','inspect','commands','stop','protocol-stop','crash'].includes(action)||!/^[-a-z0-9]{1,24}$/.test(label))throw Error('Bounded fixture action/label required');
const runtime=await verifyRuntime(),queue=JSON.parse(fs.readFileSync('.local/game-parity-20261029/runtime/queue.json'));activeLease(id,'astroneer_native');if(queue.activation_pause)throw Error('Coordinator activation pause');
const server=(await api('/api/application/servers/35')).attributes;if(server.uuid!==uuid||server.node!==1||server.egg!==30||server.container?.installed!==1)throw Error('Exact installed owned fixture required');
if(!fs.existsSync(folder+'/control-application-after.json')||fs.existsSync(folder+'/control-application-restored.json'))throw Error('Root-approved candidate must be applied and not restored');
const pause=ms=>new Promise(r=>setTimeout(r,ms)),power='/api/client/servers/'+uuid+'/power';
const persist=(suffix,value)=>fs.writeFileSync(folder+'/control-test-'+label+'-'+suffix+'.json',JSON.stringify(value,null,2)+'\n',{mode:0o600});
function owned(required=true){const c=containers().find(x=>x.Name==='/'+uuid);if(!c&&required)throw Error('Owned game container absent');return c;}
function consoleLog(c){return docker(['logs','--since',c.State.StartedAt,'--tail','5000',c.Id]);}
const fileCode=String.raw`import pathlib,json,hashlib
root=pathlib.Path('/home/container');result={};total=0
for name in ['Astro/Saved/Config/WindowsServer/AstroServerSettings.ini','Astro/Saved/Config/WindowsServer/Engine.ini']:
 p=root/name
 if p.is_symlink()or not p.resolve().is_relative_to(root):raise ValueError('Unsafe native settings path')
 b=p.read_bytes();result[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
base=root/'Astro/Saved/SaveGames'
if base.exists():
 for p in sorted(base.rglob('*')):
  if p.is_symlink():raise ValueError('Unexpected save symlink')
  if not p.is_file():continue
  st=p.stat();row={'bytes':st.st_size,'mtime_ns':st.st_mtime_ns};total+=st.st_size
  if st.st_size<=33554432 and total<=67108864:row['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
  else:row['hash_skipped']='bounded capture limit'
  result[str(p.relative_to(root))]=row
print(json.dumps(result))`;
function inspect(c){
 if(!c.State.Running)throw Error('Owned running native required');
 const capture=JSON.parse(docker(['exec',c.Id,'python3','-B','-c',capturePython]));delete capture.log?.content_base64;
 const configs=JSON.parse(docker(['exec',c.Id,'python3','-B','-c',fileCode]));
 const binds=JSON.parse(docker(['exec',c.Id,'python3','-B','-c',"import pathlib,json\nrows=[]\nfor name in ('tcp','tcp6'):\n for line in pathlib.Path('/proc/net/'+name).read_text().splitlines()[1:]:\n  fields=line.split()\n  if len(fields)>9 and int(fields[1].rsplit(':',1)[1],16)==39000:rows.append({'protocol':name,'local_address_hex':fields[1].rsplit(':',1)[0],'state':fields[3],'inode':fields[9]})\nprint(json.dumps(rows))"]));
 const mappings=c.HostConfig.PortBindings;if(Object.keys(mappings).some(k=>k.startsWith('39000/')))throw Error('Private console port unexpectedly published');
 const output=consoleLog(c),file=folder+'/control-test-'+label+'-console.log';fs.writeFileSync(file,output,{mode:0o600});
 return {at:new Date().toISOString(),capture,configs,console:{private_path:file,bytes:Buffer.byteLength(output),sha256:digest(output),ready_marker:output.includes('Astroneer native server ready (authenticated RCON, advancing native clock, owned UDP)')},private_port:{port:39000,published:false,native_binds:binds},published_ports:mappings};
}
async function waitOffline(){const samples=[],deadline=Date.now()+65000;while(Date.now()<deadline){const p=await observePower(state);samples.push(p);if(p.current_state==='offline'){const c=owned();const logs=consoleLog(c);fs.writeFileSync(folder+'/control-test-'+label+'-terminal-console.log',logs,{mode:0o600});return {samples,container:c.State,private_console_sha256:digest(logs),raw_exit_diagnostic:logs.split(/\r?\n/).filter(x=>/Native process exited: raw_status=/.test(x)),save_messages:logs.split(/\r?\n/).filter(x=>/Astroneer native (save|shutdown)/.test(x))};}await pause(1000);}throw Error('Owned native did not stop in bounded window; retain evidence and request review');}
if(action==='boot'||action==='restart-api'){
 const previousState=(await observePower(state)).current_state;if(action==='boot'&&previousState!=='offline'||action==='restart-api'&&previousState!=='running')throw Error('Correct native start/restart state required');
 const c=owned(),env=JSON.parse(docker(['inspect','--format','{{json .Config.Env}}',c.Id]));const map=Object.fromEntries(env.map(x=>{const n=x.indexOf('=');return [x.slice(0,n),x.slice(n+1)];}));
 if((map.VOLTRA_STEAM_AUTO_UPDATE??map.AUTO_UPDATE??'1')!=='0')throw Error('Native boot refuses any automatic acquisition outside installer gate');
 const previousStart=c.State.StartedAt,start=Date.now(),samples=[];await api(power,'POST',{signal:action==='restart-api'?'restart':'start'});let result;
 while(Date.now()-start<90000){const p=await observePower(state);samples.push(p);if(p.current_state==='offline'&&Date.now()-start>3000&&action!=='restart-api')break;const c=owned(false);if(c?.State.Running&&c.State.StartedAt!==previousStart&&consoleLog(c).includes('Astroneer native server ready (authenticated RCON, advancing native clock, owned UDP)')){result=inspect(c);break;}await pause(1500);}
 persist('boot',{runtime:{pid:runtime.pid,binary_sha256:runtime.binary_sha256},samples,result:result||null});
 if(!result){if((await observePower(state)).current_state!=='offline'){await api(power,'POST',{signal:'stop'});persist('failed-boot-terminal',await waitOffline());}throw Error('No actual ready marker in90s; source diagnosis required before any retry');}
 console.log(JSON.stringify({ready_marker:true,resource_state:(await observePower(state)).current_state,private_port_unpublished:true,native_udp:result.capture.sockets.filter(x=>x.port===29101),receipt:folder+'/control-test-'+label+'-boot.json'}));
}else if(action==='inspect'){const result=inspect(owned());persist('inspect',result);console.log(JSON.stringify({captured:true,ready_marker:result.console.ready_marker,private_port_unpublished:true}));
}else if(action==='commands'){
 const before=inspect(owned());for(const command of ['status','players','saves','save']){await api('/api/client/servers/'+uuid+'/command','POST',{command});await pause(1500);}await pause(3000);const after=inspect(owned());persist('commands',{before,after});console.log(JSON.stringify({commands_sent:['status','players','saves','save'],disk_save_confirmation:'Review exact before/after native file receipt; no acknowledgment inferred'}));
}else if(action==='stop'||action==='protocol-stop'){
 const before=inspect(owned());if(action==='protocol-stop')await api('/api/client/servers/'+uuid+'/command','POST',{command:'stop'});else await api(power,'POST',{signal:'stop'});const terminal=await waitOffline();persist('stop',{before,terminal});console.log(JSON.stringify({offline:true,raw_exit:terminal.container.ExitCode,oom:terminal.container.OOMKilled,messages:terminal.save_messages}));
}else if(action==='crash'){
 const before=inspect(owned());const c=owned();const code="import pathlib,os,signal,json\nmatches=[]\nfor p in pathlib.Path('/proc').iterdir():\n if not p.name.isdigit():continue\n try:args=(p/'cmdline').read_bytes().lower().split(bytes([0]));names=[a.replace(bytes([92]),b'/').rsplit(b'/',1)[-1] for a in args if a]\n except OSError:continue\n if names and names[0] in (b'astroserver-win64-shipping.exe',b'wine64-preloader',b'wine64') and b'astroserver-win64-shipping.exe' in names:matches.append(int(p.name))\nif len(matches)!=1:raise ValueError('Exactly one owned native shipping child required')\nos.kill(matches[0],signal.SIGKILL);print(json.dumps({'native_pid':matches[0],'signal':'SIGKILL'}))";
 const killed=JSON.parse(docker(['exec',c.Id,'python3','-B','-c',code]));const terminal=await waitOffline();persist('crash',{before,killed,terminal});console.log(JSON.stringify({offline:true,raw_exit:terminal.container.ExitCode,oom:terminal.container.OOMKilled,diagnostic:terminal.raw_exit_diagnostic}));
}




