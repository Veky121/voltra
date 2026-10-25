import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/jc3-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='just_cause/just_cause_3/egg-j-c3-m-p.json')throw Error('Foreign fixture');
const main=`// MIT. Disposable server-only persistence acceptance; no gameplay/client assets.
const fs=require('fs');const path=require('path');
const data=path.join(__dirname,'data');fs.mkdirSync(data,{recursive:true,mode:0o700});
const file=path.join(data,'counter.json');
const previous=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{generation:0};
if(!Number.isSafeInteger(previous.generation)||previous.generation<0)throw Error('Invalid native saved generation');
const value={generation:previous.generation+1,proof:'Native JC3 package VM durable state; no gameplay'};
const temporary=path.join(data,'counter-new.json');const fd=fs.openSync(temporary,'wx',0o640);
try{fs.writeSync(fd,JSON.stringify(value)+'\\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
fs.renameSync(temporary,file);const directory=fs.openSync(data,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
print('VOLTRA_NATIVE_SAVE generation='+value.generation);
`;
const files={'package.json':JSON.stringify({name:'voltra-persistence',version:'1.0.0',main:'main.js',description:'Disposable native persistence fixture; no client package'},null,2)+'\n','main.js':main};
const code=`from pathlib import Path
import json,os,hashlib
r=Path('/volume');parent=r/'packages';package=parent/'voltra-persistence'
if parent.is_symlink() or package.exists() or package.is_symlink():raise ValueError('Unreviewed package collision')
parent.mkdir(exist_ok=True);package.mkdir(mode=0o750);os.chown(package,988,989)
files=json.loads(${JSON.stringify(JSON.stringify(files))});report={}
for name,body in files.items():
 p=package/name
 with p.open('x')as output:output.write(body)
 p.chmod(0o640);os.chown(p,988,989);report[name]=hashlib.sha256(p.read_bytes()).hexdigest()
print(json.dumps({'package':'voltra-persistence','files':report,'server_only':True,'replaces_builtin_package_fallback':True}))
`;
const p=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(p.status)throw Error(p.stderr);fs.writeFileSync(dir+'/test-package-files.json',JSON.stringify(files,null,2)+'\n',{flag:'wx'});fs.writeFileSync(dir+'/test-package-publication.json',p.stdout,{flag:'wx'});console.log(JSON.parse(p.stdout));
