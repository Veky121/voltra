import fs from'node:fs';import{spawnSync}from'node:child_process';import{api}from'./openttd-compat-node.mjs';import{ownedStoppedServer}from'./cache-owned-server.mjs';
const d='.local/craftopia-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Tag');if((await api('/api/application/servers/'+s.internal_id)).attributes.uuid!==s.uuid)throw Error('Identity');
const code=`from pathlib import Path
import json,os,stat,base64,hashlib
r=Path('/home/container/.config/unity3d/PocketPair/Craftopia/Logs_DS');out={};total=0
if r.exists():
 assert not r.is_symlink()
 for p in r.glob('*.log'):
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  with os.fdopen(fd,'rb')as h:
   a=os.fstat(h.fileno());assert stat.S_ISREG(a.st_mode)and a.st_size<=4*1024**2;b=h.read(4*1024**2+1);z=os.fstat(h.fileno());assert a.st_ino==z.st_ino and len(b)<=4*1024**2
  total+=len(b);assert total<=16*1024**2;out[p.name]={'body':base64.b64encode(b).decode(),'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'mtime_ns':z.st_mtime_ns,'mode':oct(z.st_mode&0o777),'uid':z.st_uid,'gid':z.st_gid}
print(json.dumps(out))`;
const inspected=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(inspected.status)throw Error('Container missing');let args;
if(JSON.parse(inspected.stdout)[0].State.Running)args=['exec','--env','PYTHONHOME=/home/container/.voltra/python','--env','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'/home/container/.voltra/python/bin/python3','-B','-c',code];
else{const{node,image}=await ownedStoppedServer(d+'/private.json');args=['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/home/container,readonly`,image,'python3','-B','-c',code];}
const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',maxBuffer:24e6});if(r.status)throw Error(r.stderr||r.stdout);const j=JSON.parse(r.stdout),out=d+'/native-file-logs-'+tag;if(fs.existsSync(out))throw Error('Immutable log archive');fs.mkdirSync(out);let lines=[];for(const[n,v]of Object.entries(j)){if(n.includes('/')||n.includes('..'))throw Error('Name');const b=Buffer.from(v.body,'base64');fs.writeFileSync(out+'/'+n,b);delete v.body;lines.push(...b.toString(b[0]===255&&b[1]===254?'utf16le':'utf8').split(/\r?\n/).filter(x=>/World is loaded|Load SaveData|save|database|Host|port|Server start|world.*load/i.test(x)));}fs.writeFileSync(out+'/manifest.json',JSON.stringify(j,null,2));console.log({files:Object.keys(j).length,markers:lines.slice(-25)});
