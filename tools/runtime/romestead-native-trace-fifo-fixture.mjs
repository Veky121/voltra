import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/romestead-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json'),info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];
const common=['run','--rm','--pull','never','--network','none','--memory','256m','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','-e','DOTNET_CLI_TELEMETRY_OPTOUT=1','-e','DOTNET_NOLOGO=1'];
const build=spawnSync('docker',[...common,'--mount',`type=bind,source=${path.resolve(dir+'/trace-dummy')},target=/project`,'--workdir','/project','--entrypoint','dotnet',info.Image,'build','--configuration','Release','--verbosity','quiet','-p:UseSharedCompilation=false'],{windowsHide:true,encoding:'utf8',timeout:60000});if(build.status)throw Error('Offline dummy build failed '+build.stdout+build.stderr);
const code=`from pathlib import Path
import subprocess,os,json,time,threading,signal
r=Path('/fixture');d=Path('/tmp/trace-fixture');d.mkdir(mode=0o700);fifo=d/'bounded.nettrace';trace=d/'result.nettrace';os.mkfifo(fifo,0o600);cap=128*1024**2;counts={'bytes':0,'cap_hit':False};error=[]
def drain():
 try:
  with fifo.open('rb',buffering=0)as src,os.fdopen(os.open(trace,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb',buffering=0)as dest:
   while True:
    block=src.read(min(65536,cap-counts['bytes']))
    if not block:break
    dest.write(block);counts['bytes']+=len(block)
    if counts['bytes']==cap:counts['cap_hit']=True;break
 except Exception as e:error.append(type(e).__name__)
thread=threading.Thread(target=drain,daemon=True);thread.start();env=dict(os.environ)
for key in ['PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH']:env.pop(key,None)
native=subprocess.Popen(['dotnet','/dummy/TraceDummy.dll'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
with (d/'tool.log').open('wb')as log:
 tool=subprocess.Popen(['dotnet',str(r/'.voltra/diagnostic-tool/tools/net8.0/any/dotnet-trace.dll'),'collect','--process-id',str(native.pid),'--providers','Microsoft-Windows-DotNETRuntime:0x8000:5','--duration','00:00:15','--buffersize','8','--output',str(fifo)],stdout=log,stderr=log,stdin=subprocess.DEVNULL,env=env)
 try:status=tool.wait(timeout=25)
 except subprocess.TimeoutExpired:tool.send_signal(signal.SIGINT);status=tool.wait(timeout=3)
 native_status=native.wait(timeout=3);thread.join(timeout=3)
 assert not thread.is_alive()and not error,'FIFO reader failed '+str(error)
 assert status==0,'Synthetic collector failure '+(d/'tool.log').read_text()[-2000:]
 assert trace.is_file()and 0<trace.stat().st_size<=cap
 parsed=subprocess.run(['dotnet','/parser/TraceParser.dll',str(trace)],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
 assert parsed.returncode==0,'Synthetic parser failure '+parsed.stderr[-2000:]
 events=json.loads(parsed.stdout);matched=[x for x in events if x['type']=='System.InvalidOperationException'and x['message']=='VOLTRA_SYNTHETIC_CAUGHT_EXCEPTION'];assert matched,'No actual caught exception proof'
 print(json.dumps({'synthetic_only':True,'network':'none','memory_mib':256,'trace_bytes':trace.stat().st_size,'trace_mode':oct(trace.stat().st_mode&511),'native_exit':native_status,'collector_exit':status,'caught_exception_count':len(matched),'cap_bytes':cap,'bounded_fifo':True,'processwide_file_rlimit':False}))`;
const r=spawnSync('docker',[...common,'-i','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture,readonly`,'--mount',`type=bind,source=${path.resolve(dir+'/trace-dummy/bin/Release/net8.0')},target=/dummy,readonly`,'--mount',`type=bind,source=${path.resolve(dir+'/trace-parser/bin/Release/net8.0')},target=/parser,readonly`,'-e','PYTHONHOME=/fixture/.voltra/python','-e','LD_LIBRARY_PATH=/fixture/.voltra/python/lib','--entrypoint','/fixture/.voltra/python/bin/python3',info.Image,'-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:50000,maxBuffer:1000000});
if(r.status)throw Error('Offline synthetic fixture failed '+r.stdout+r.stderr);fs.writeFileSync(dir+'/trace-fifo-synthetic-proof.json',r.stdout,{flag:'wx'});console.log(r.stdout);
