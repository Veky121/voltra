import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';import {setTimeout as delay} from 'node:timers/promises';import {ownedStoppedServer} from './cache-owned-server.mjs';import {api} from './openttd-compat-node.mjs';
const dir='.local/romestead-native',tag=process.argv[2];if(tag!=='fifo-repair')throw Error('Only separately approved FIFO diagnostic generation is supported');
const {receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json'),v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(s.owner!=='unreal_survival'||v.egg!==s.egg_id||v.external_id!=='romestead-native-'+s.request_id)throw Error('Foreign trace fixture');
if(fs.existsSync(dir+'/diagnostic-'+tag+'-start.json'))throw Error('Single approved diagnostic start already submitted');
const canonical=JSON.parse(fs.readFileSync(dir+'/source-profile-current.json')).egg.startup;
if(v.container?.startup_command!==canonical||!canonical.endsWith('.voltra/crafting_runtime.py'))throw Error('Canonical fixture startup changed');
const runID=randomUUID(),startup=canonical.replace('.voltra/crafting_runtime.py','.voltra/romestead_diag_wrapper.py '+runID),wrapper=fs.readFileSync('tools/runtime/romestead-diag-wrapper.py'),info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];
const prepare=`from pathlib import Path
import os
r=Path('/fixture');p=r/'.voltra/romestead_diag_wrapper.py';assert not p.exists()and not p.is_symlink();assert not (r/'.voltra').is_symlink();assert not (r/'.voltra/diagnostics').is_symlink()
with os.fdopen(os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb')as out:out.write(Path('/wrapper.py').read_bytes())`;
const staged=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--user',info.Config.User,'--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture`,'--mount',`type=bind,source=${path.resolve('tools/runtime/romestead-diag-wrapper.py')},target=/wrapper.py,readonly`,image,'python3','-B','-'],{windowsHide:true,input:prepare,encoding:'utf8'});if(staged.status)throw Error('Owned diagnostic wrapper staging failed');
fs.writeFileSync(dir+'/diagnostic-wrapper-source.py',wrapper,{flag:'wx'});
fs.writeFileSync(dir+'/diagnostic-'+tag+'-start.json',JSON.stringify({uuid:s.uuid,run_id:runID,diagnostic_only:true,startup_before:canonical,startup_diagnostic:startup,wrapper_sha256:createHash('sha256').update(wrapper).digest('hex'),fresh_world_name:'Voltra diagnostic fifo exception',WORLD_SIZE:'1',at:new Date().toISOString(),max_trace_bytes:128*1024**2,max_duration_seconds:120},null,2)+'\n',{flag:'wx'});
try{
 await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{startup,environment:{WORLD_NAME:'Voltra diagnostic fifo exception',WORLD_SIZE:'1',AUTO_UPDATE:'0'}});
 await api('/api/client/servers/'+s.identifier+'/power','POST',{signal:'start'});
 let running=false;for(let i=0;i<50;i++){const r=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(!r.status&&JSON.parse(r.stdout)[0].State.Running){running=true;break;}await delay(200);}if(!running)throw Error('No exact running fixture after single start');
 const code=`from pathlib import Path
import json,os,subprocess,time,signal,threading
r=Path('/home/container');out=r/'.voltra/diagnostics';trace=out/'romestead-fifo-repair.nettrace';fifo=out/'romestead-fifo-repair.pipe.nettrace';assert not trace.exists()and not fifo.exists(),'Immutable trace already exists'
os.mkfifo(fifo,0o600);cap=128*1024**2;counts={'bytes':0,'cap_hit':False};errors=[]
def drain():
 try:
  with fifo.open('rb',buffering=0)as src,os.fdopen(os.open(trace,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb',buffering=0)as dest:
   while True:
    block=src.read(min(65536,cap-counts['bytes']))
    if not block:break
    dest.write(block);counts['bytes']+=len(block)
    if counts['bytes']==cap:counts['cap_hit']=True;break
 except Exception as e:errors.append(type(e).__name__)
reader=threading.Thread(target=drain,daemon=True);reader.start()
pid=None
for attempt in range(50):
 matches=[]
 for p in Path('/proc').glob('[0-9]*/cmdline'):
  try:args=p.read_bytes().split(b'\\0')
  except FileNotFoundError:continue
  if len(args)>1 and args[0].endswith(b'/dotnet')and args[1]==b'/home/container/Server.dll':matches.append(int(p.parent.name))
 if matches:
  assert len(matches)==1,'Require exact single native';pid=matches[0];break
 time.sleep(.1)
assert pid is not None,'Exact native process unavailable'
assert os.getpgid(pid)==pid,'Unexpected native process group'
child=dict(os.environ)
for key in ['PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH']:child.pop(key,None)
fd=os.open(out/'trace-tool-fifo-private.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb')as log:
 tool=subprocess.Popen(['dotnet',str(r/'.voltra/diagnostic-tool/tools/net8.0/any/dotnet-trace.dll'),'collect','--process-id',str(pid),'--providers','Microsoft-Windows-DotNETRuntime:0x8000:5','--duration','00:01:00','--buffersize','8','--output',str(fifo)],stdout=log,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,env=child)
 samples=[];begin=time.monotonic()
 while tool.poll()is None and time.monotonic()-begin<110:
  rss=None
  try:
   for line in Path('/proc/'+str(pid)+'/status').read_text().splitlines():
    if line.startswith('VmRSS:'):rss=int(line.split()[1])*1024
  except FileNotFoundError:pass
  current=Path('/sys/fs/cgroup/memory.current');samples.append({'elapsed_seconds':round(time.monotonic()-begin,2),'native_rss_bytes':rss,'cgroup_bytes':int(current.read_text())if current.exists()else None})
  if counts['cap_hit']:tool.send_signal(signal.SIGINT);break
  time.sleep(.2)
 if tool.poll()is None:tool.send_signal(signal.SIGINT)
 try:status=tool.wait(timeout=5)
 except subprocess.TimeoutExpired:tool.terminate();status=tool.wait(timeout=3)
 reader.join(timeout=3);assert not reader.is_alive()and not errors,'Bounded FIFO collector incomplete';assert trace.exists()and trace.stat().st_size<=cap,'Trace cap invariant'
 result={'native_pid':pid,'tool_exit_code':status,'duration_seconds':round(time.monotonic()-begin,2),'trace_bytes':trace.stat().st_size,'trace_mode':oct(trace.stat().st_mode&511),'trace_cap_hit':counts['cap_hit'],'native_peak_rss_bytes':max((x['native_rss_bytes']or 0)for x in samples),'cgroup_peak_sampled_bytes':max((x['cgroup_bytes']or 0)for x in samples),'samples':samples}
 with os.fdopen(os.open(out/'collector-${runID}.done',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb')as done:done.write(b'${runID}')
 print(json.dumps(result))`;
 const result=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:120000,maxBuffer:1000000});
 if(result.status)throw Error('Private trace capture failed; inspect same attempt: '+result.stderr);
 const evidence=JSON.parse(result.stdout);fs.writeFileSync(dir+'/diagnostic-'+tag+'-capture.json',JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log({trace_bytes:evidence.trace_bytes,tool_exit_code:evidence.tool_exit_code,duration_seconds:evidence.duration_seconds,native_peak_rss_bytes:evidence.native_peak_rss_bytes,cgroup_peak_sampled_bytes:evidence.cgroup_peak_sampled_bytes});
}finally{
 await api('/api/client/servers/'+s.identifier+'/power','POST',{signal:'stop'});
 fs.writeFileSync(dir+'/diagnostic-'+tag+'-stop-request.json',JSON.stringify({uuid:s.uuid,at:new Date().toISOString(),reason:'Quench desiredstate after single bounded diagnostic'},null,2)+'\n',{flag:'wx'});
 let terminal=false;for(let i=0;i<60;i++){
  const inspected=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}),resources=(await api('/api/client/servers/'+s.identifier+'/resources')).attributes;
  if(!inspected.status&&!JSON.parse(inspected.stdout)[0].State.Running&&resources.current_state==='offline'){terminal=true;break;}await delay(500);
 }
 if(!terminal)throw Error('Diagnostic still active; canonical startup deliberately not restored');
 const current=(await api('/api/application/servers/'+s.internal_id)).attributes;if(current.uuid!==s.uuid||![startup,canonical].includes(current.container?.startup_command))throw Error('Owned diagnostic startup changed before terminal restore');
 if(current.container?.startup_command===startup)await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{startup:canonical,environment:{}});
 const restored=(await api('/api/application/servers/'+s.internal_id)).attributes;if(restored.container?.startup_command!==canonical)throw Error('Canonical startup restore not verified');
 fs.writeFileSync(dir+'/diagnostic-startup-restored.json',JSON.stringify({uuid:s.uuid,terminal_confirmed:true,desired_stop_requested:true,startup_after:restored.container.startup_command,at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
}
