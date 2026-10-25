import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/citadel-native',tag=process.argv[2];if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid tag');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='game_batch_inventory'||s.path!=='citadel/egg-citadel-forged-with-fire.json')throw Error('Foreign fixture');
const snapshot=JSON.parse(fs.readFileSync(dir+'/snapshot-'+tag+'.json'));
const out=dir+'/archives';fs.mkdirSync(out,{recursive:true});if(fs.existsSync(out+'/'+tag+'.tar.gz'))throw Error('Existing archive');
const code=`from pathlib import Path
import json,tarfile,hashlib
r=Path('/volume');names=json.loads(${JSON.stringify(JSON.stringify([...Object.keys(snapshot.files),...Object.keys(snapshot.links)]))})
p=Path('/evidence/${tag}.tar.gz')
with tarfile.open(p,'w:gz',dereference=False)as archive:
 for name in sorted(names):
  path=r/name
  if not path.resolve().is_relative_to(r):raise ValueError('Archive path escape')
  archive.add(path,arcname=name,recursive=False)
with p.open('rb')as source:digest=hashlib.file_digest(source,'sha256').hexdigest()
print(json.dumps({'files':len(names),'bytes':p.stat().st_size,'sha256':digest}))
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--user','988:988','--cap-drop','ALL','--security-opt','no-new-privileges','--read-only','--memory','256m','--cpus','1','--pids-limit','32','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'--mount',`type=bind,source=${path.resolve(out)},target=/evidence`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:60000,maxBuffer:2e6});
if(result.status)throw Error(result.stderr);const metadata=JSON.parse(result.stdout);
fs.writeFileSync(out+'/'+tag+'.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});console.log(metadata);
