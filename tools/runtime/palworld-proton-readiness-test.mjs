import fs from'node:fs';import{spawnSync}from'node:child_process';
const source=fs.readFileSync('internal/panel/steam_catalog_palworld.go','utf8');
const match=source.match(/return fmt.Sprintf\("(timeout 1 bash[^"\n]+)", port\)/);
if(!match)throw Error('Exact Proton readiness expression absent');
const expression=JSON.parse('"'+match[1]+'"');
const program=String.raw`
import sys,socket,subprocess,tempfile,os,shutil,time,json
from pathlib import Path
expression=sys.stdin.read()
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory)
 for name in ('bash','timeout'):os.symlink(shutil.which(name),root/name)
 env={**os.environ,'PATH':str(root)}
 assert not shutil.which('nc',path=str(root))
 def run(port):
  at=time.monotonic();result=subprocess.run(['/bin/bash','-c',expression%port],env=env,timeout=3)
  return result.returncode,time.monotonic()-at
 with socket.socket() as listener:
  listener.bind(('127.0.0.1',0));listener.listen();port=listener.getsockname()[1]
  opened,elapsed=run(port);assert opened==0 and elapsed<2
 closed,elapsed=run(port);assert closed!=0 and elapsed<2
 (root/'bash').unlink();(root/'bash').write_text('#!/bin/bash\n/bin/sleep 5\n');(root/'bash').chmod(0o700)
 bounded,elapsed=run(port);assert bounded==124 and .8<elapsed<2.5
 print(json.dumps({'open_port':opened,'closed_port_rejected':True,'missing_nc':True,'timeout_exit':bounded,'bounded_seconds':round(elapsed,3)}))
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--tmpfs','/tmp:rw,exec,nosuid,size=8m','--memory','64m','--cpus','1','python:3.13-slim','python3','-B','-c',program],{windowsHide:true,encoding:'utf8',input:expression,timeout:15000,maxBuffer:16384});
if(result.status)throw Error(result.stderr);console.log(result.stdout.trim());
