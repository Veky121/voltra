import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const code=`from pathlib import Path
import tempfile,threading,os,json
with tempfile.TemporaryDirectory()as directory:
 fifo=Path(directory)/'input.pipe';trace=Path(directory)/'bounded.nettrace';os.mkfifo(fifo,0o600);cap=1024**2;counts={'bytes':0,'cap_hit':False}
 def drain():
  with fifo.open('rb',buffering=0)as src,os.fdopen(os.open(trace,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb',buffering=0)as dest:
   while True:
    block=src.read(min(65536,cap-counts['bytes']))
    if not block:break
    dest.write(block);counts['bytes']+=len(block)
    if counts['bytes']==cap:counts['cap_hit']=True;break
 reader=threading.Thread(target=drain);reader.start();broken=False
 try:
  with fifo.open('wb',buffering=0)as writer:
   for _ in range(32):writer.write(b'x'*65536)
 except BrokenPipeError:broken=True
 reader.join(timeout=3);assert not reader.is_alive();assert trace.stat().st_size==cap and counts['cap_hit']and broken
 print(json.dumps({'synthetic_only':True,'memory_mib':256,'attempted_bytes':2*1024**2,'cap_bytes':cap,'actual_file_bytes':trace.stat().st_size,'private_mode':oct(trace.stat().st_mode&511),'overflow_writer_broken_pipe':broken}))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--security-opt','no-new-privileges','python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:10000});if(result.status)throw Error(result.stderr);fs.writeFileSync('.local/romestead-native/trace-cap-synthetic-proof.json',result.stdout,{flag:'wx'});console.log(result.stdout);
