import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/virtual-worlds/nwn',{receipt}=await ownedStoppedServer(dir+'/private.json');
const code=`import sys,pathlib,subprocess,os,json,hashlib
sys.path.insert(0,'/home/container/.voltra')
import virtual_worlds_runtime as runtime
r=pathlib.Path('/home/container');env=runtime.nss_environment(r)
assert env and env['LD_PRELOAD'].startswith(str(r))
child=subprocess.run([sys.executable,'-B','-c','import pwd,os,json; p=pwd.getpwuid(os.getuid()); print(json.dumps(dict(uid=p.pw_uid,gid=p.pw_gid,home=p.pw_dir,name=p.pw_name)))'],env={**os.environ,**env},capture_output=True,text=True,timeout=10,check=True)
proof=json.loads(child.stdout);assert proof['uid']==988 and proof['gid']==988 and proof['home']==str(r)
proof['library_sha256']=hashlib.sha256(pathlib.Path(env['LD_PRELOAD']).read_bytes()).hexdigest()
proof['package']=(r/'.voltra/virtual-worlds/nss/package.txt').read_text().strip()
proof['native_game_executed']=False
print(json.dumps(proof))`;
const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cpus','1','--read-only','--user','988:988','--workdir','/home/container','--mount',`type=bind,source=/var/lib/voltra-batch-20261023/volumes/${receipt.uuid},target=/home/container`,'python:3.13-slim','python','-B','-c',code],{windowsHide:true,encoding:'utf8',timeout:30000});
if(result.status)throw Error('Private NSS probe failed '+result.stderr.slice(-1500));
const proof={uuid:receipt.uuid,at:new Date().toISOString(),...JSON.parse(result.stdout)};
fs.writeFileSync(dir+'/nss-real-library-probe.json',JSON.stringify(proof,null,2));console.log(proof);
