// Bounded owned Empyrion native observation. Does not infer readiness from panel state.
import fs from 'node:fs';import {verifyRuntime,activeLease,api,containers,docker,digest,runtime}from './campaign-native-20261029.mjs';
const id='14c3a416-0f1d-47a5-bc9b-adb2372b2049',dir='.local/game-parity-20261029/empyrion-native/'+id,[action='inspect',label='initial']=process.argv.slice(2);if(!['boot','inspect','stop','help'].includes(action)||!/^[-a-z0-9]{1,24}$/.test(label))throw Error('Bounded owned command/label required');const s=JSON.parse(fs.readFileSync(dir+'/state.json')),r=await verifyRuntime();activeLease(id,'empyrion_native');if(JSON.parse(fs.readFileSync(runtime+'/queue.json')).activation_pause||s.runtime.binary_sha256!==r.binary_sha256)throw Error('Pause/receipt drift');const row=(await api('/api/application/servers/70')).attributes;if(row.uuid!==s.server.uuid||row.node!==1||row.egg!==58||row.container.installed!==1||row.status!==null)throw Error('Exact installed owned server required');const own=()=>containers().find(c=>c.Name==='/'+s.server.uuid),sleep=ms=>new Promise(r=>setTimeout(r,ms)),persist=(name,data)=>fs.writeFileSync(dir+'/native-'+label+'-'+name+'.json',JSON.stringify(data,null,2)+'\n',{mode:0o600});
const code=String.raw`import pathlib,json,os,base64,time
r=pathlib.Path('/home/container');processes=[];sockets=[];log=None
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit():continue
 try:
  args=(p/'cmdline').read_bytes().split(b'\0');names=[a.replace(b'\\',b'/').rsplit(b'/',1)[-1].lower()for a in args if a]
  if not any(x in names for x in (b'empyriondedicated.exe',b'empyrionplayfieldserver.exe')):continue
  if not names or names[0]in (b'python',b'python3',b'bash',b'sh'):continue
  status=(p/'status').read_text();uid=next(x for x in status.splitlines()if x.startswith('Uid:')).split()[1];exe=os.readlink(p/'exe');ns=os.readlink(p/'ns/pid');start=(p/'stat').read_text().rsplit(')',1)[1].split()[19];fds=[]
  for fd in (p/'fd').iterdir():
   try:target=os.readlink(fd)
   except OSError:continue
   if target.startswith('socket:['):fds.append(target[8:-1])
  processes.append({'pid':int(p.name),'uid':int(uid),'exe':exe,'pid_namespace':ns,'start_ticks':int(start),'argv0':args[0].decode(errors='replace'),'socket_inodes':fds})
 except (OSError,StopIteration,IndexError):continue
for proto in ('tcp','tcp6','udp','udp6'):
 for line in pathlib.Path('/proc/net/'+proto).read_text().splitlines()[1:]:
  f=line.split()
  if len(f)<10:continue
  port=int(f[1].rsplit(':',1)[1],16)
  if port not in (1030,29106,29107,29108,29109,29110):continue
  owners=[p['pid']for p in processes if f[9]in p['socket_inodes']];sockets.append({'protocol':proto,'port':port,'local_address_hex':f[1].rsplit(':',1)[0],'state':f[3],'inode':f[9],'native_owners':owners})
p=r/'Logs/server/server.log'
if p.is_file()and not p.is_symlink():
 b=p.read_bytes();log={'bytes':len(b),'mtime_ns':p.stat().st_mtime_ns,'tail_base64':base64.b64encode(b[-131072:]).decode()}
print(json.dumps({'captured_at':time.time(),'processes':processes,'sockets':sockets,'expected_log':log,'cgroups':{n:pathlib.Path('/sys/fs/cgroup/'+n).read_text().strip()for n in ('memory.max','memory.swap.max','cpu.max')}}))`;
function capture(c){const text=docker(['logs','--since',c.State.StartedAt,'--tail','5000',c.Id]);fs.writeFileSync(dir+'/native-'+label+'-console.log',text,{mode:0o600});let native=null;if(c.State.Running)native=JSON.parse(docker(['exec',c.Id,'python3','-B','-c',code]));return {at:new Date().toISOString(),container:{id:c.Id,state:c.State},native,console:{bytes:Buffer.byteLength(text),sha256:digest(text),private_file:'native-'+label+'-console.log'},bindings:c.HostConfig.PortBindings};}
if(action==='boot'){
 const before=own();if(!before||before.State.Running)throw Error('Existing stopped owned game required');const env=JSON.parse(docker(['inspect','--format','{{json .Config.Env}}',before.Id])),map=Object.fromEntries(env.map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));if((map.VOLTRA_STEAM_AUTO_UPDATE??map.AUTO_UPDATE??'1')!=='0'||Object.keys(before.HostConfig.PortBindings??{}).some(k=>k.startsWith('1030/')))throw Error('Acquisition/private port exposure refused');const started=Date.now();await api('/api/client/servers/'+s.server.uuid+'/power','POST',{signal:'start'});const samples=[];let result;
 while(Date.now()-started<180000){const c=own();if(c&&c.State.StartedAt!==before.State.StartedAt){const p=(await api('/api/client/servers/'+s.server.uuid+'/resources')).attributes;samples.push({at:new Date().toISOString(),state:p.current_state,running:c.State.Running});result=capture(c);persist('boot',{runtime:{pid:r.pid,binary_sha256:r.binary_sha256},samples,result,readiness_proved:false});if(!c.State.Running||result.native?.sockets.some(x=>x.protocol.startsWith('udp')&&x.native_owners.length))break;}await sleep(3000);}
 if(!result)throw Error('No changed owned container observed');console.log(JSON.stringify({running:result.container.state.Running,container_exit:result.container.state.ExitCode,native_processes:result.native?.processes.length??0,owned_udp:result.native?.sockets.filter(x=>x.protocol.startsWith('udp')&&x.native_owners.length)??[],native_log_bytes:result.native?.expected_log?.bytes??0,readiness_proved:false,receipt:'native-'+label+'-boot.json'}));
}else if(action==='inspect'){const c=own();if(!c)throw Error('Owned container absent');const result=capture(c);persist('inspect',result);console.log(JSON.stringify({running:c.State.Running,native_processes:result.native?.processes.length??0,sockets:result.native?.sockets??[],native_log_bytes:result.native?.expected_log?.bytes??0}));}
else if(action==='help'){if(!own()?.State.Running)throw Error('Owned native must be running');await api('/api/client/servers/'+s.server.uuid+'/command','POST',{command:'help'});await sleep(3000);persist('help',capture(own()));console.log(JSON.stringify({read_only_help_requested:true,private_receipt:'native-'+label+'-help.json'}));}
else if(action==='stop'){const c=own();if(!c?.State.Running)throw Error('Owned native must be running');await api('/api/client/servers/'+s.server.uuid+'/power','POST',{signal:'stop'});const samples=[];let result;for(let i=0;i<70;i++){const current=own(),p=(await api('/api/client/servers/'+s.server.uuid+'/resources')).attributes;samples.push({at:new Date().toISOString(),state:p.current_state});if(current&&!current.State.Running){result=capture(current);break;}await sleep(1000);}persist('stop',{samples,result:result??null});if(!result)throw Error('Bounded native stop did not terminate; retain evidence');console.log(JSON.stringify({offline:true,exit:result.container.state.ExitCode,oom:result.container.state.OOMKilled}));}
