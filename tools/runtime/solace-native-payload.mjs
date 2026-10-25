import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/solace-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='game_batch_inventory'||s.path!=='solace_crafting/egg-solace-crafting.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,hashlib
r=Path('/volume');files=[];docs={};total=0
for p in r.rglob('*'):
 if p.is_symlink() or not p.is_file():continue
 rel=str(p.relative_to(r))
 if rel.startswith(('.voltra/','Steam/','.steam/','.config/','steamapps/')):continue
 size=p.stat().st_size;total+=size
 if p.name.lower().startswith(('readme','dedicated','serverhelp')) and p.suffix.lower() in ('.txt','.md','.html') and size<=131072:
  data=p.read_bytes();docs[rel]={'sha256':hashlib.sha256(data).hexdigest(),'text':data.decode('utf-8',errors='replace')}
 if '/Managed/' in rel and p.suffix.lower()=='.dll':files.append(rel)
binary=r/'Solace Crafting.x86_64';header=binary.open('rb').read(20)
print(json.dumps({'publisher_payload_bytes':total,'native_executable':{'name':binary.name,'size':binary.stat().st_size,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'elf_header':header.hex()},'shipped_documentation':docs,'managed_assembly_names':files}))
`;
const p=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:2e6});if(p.status)throw Error(p.stderr);const result=JSON.parse(p.stdout);fs.writeFileSync(dir+'/payload-review.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log({...result,managed_assembly_names:result.managed_assembly_names.length});
