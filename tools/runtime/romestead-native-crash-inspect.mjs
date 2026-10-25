import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/romestead-native',{receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json');
const code=`from pathlib import Path
import json,os
r=Path('/fixture');out=[];logs={};secret=${JSON.stringify(s.test_password)}
for parent,dirs,files in os.walk(r):
 dirs[:]=[d for d in dirs if d not in ['.voltra','.steam','Steam','steamapps','Content','runtimes','linux64']]
 for name in files:
  p=Path(parent)/name;relative=str(p.relative_to(r));out.append({'path':relative,'bytes':p.stat().st_size})
  if (p.suffix in ['.log','.txt']or'crash'in name.lower())and p.stat().st_size<2*1024**2:logs[relative]=p.read_text(errors='replace')[-65536:].replace(secret,'[REDACTED]')
print(json.dumps({'files':out,'logs':logs,'volume_stat':{'block_size':os.statvfs(r).f_frsize,'free_blocks':os.statvfs(r).f_bavail}}))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:2000000});if(result.status)throw Error(result.stderr);fs.writeFileSync(dir+'/world-generation-crash-inspection.json',result.stdout,{flag:'wx'});console.log(result.stdout.slice(-22000));
