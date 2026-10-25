import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/romestead-native',{receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json');
const info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];
const net=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--security-opt','no-new-privileges','--entrypoint','dotnet',info.Image,'--list-runtimes'],{windowsHide:true,encoding:'utf8'});if(net.status)throw Error('Runtime inspection failed '+net.stderr);
const code=`from pathlib import Path
import json,hashlib
r=Path('/fixture');c=json.loads((r/'config.json').read_text());c['Password_set']=bool(c.pop('Password',''))
print(json.dumps({'config':c,'root_files':[p.name for p in r.iterdir()],'server_runtimeconfig':json.loads((r/'Server.runtimeconfig.json').read_text()),'receipt':json.loads((r/'.voltra/steam-template-release.json').read_text()),'server_dll_sha256':hashlib.sha256((r/'Server.dll').read_bytes()).hexdigest()}))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:1000000});if(result.status)throw Error(result.stderr);
const out={...JSON.parse(result.stdout),runtime_image:info.Image,dotnet_runtimes:net.stdout},tag=process.argv[2]??'current';if(!/^[a-z0-9_-]+$/.test(tag))throw Error('Invalid phase tag');fs.writeFileSync(dir+'/payload-inspection-'+tag+'.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(out);
