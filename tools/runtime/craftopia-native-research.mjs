import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/craftopia-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json'),sdk='mcr.microsoft.com/dotnet/sdk@sha256:8dd1a57fe6b7b8b1b357635db67e272c2f9e9d76d1dd0a32711c4c33c57d7b43';
if(spawnSync('docker',['image','inspect',sdk],{windowsHide:true,stdio:'pipe'}).status)throw Error('Existing SDK missing; no pull');
fs.mkdirSync(d+'/research',{recursive:true});
const code=`from pathlib import Path
import json,hashlib
r=Path('/volume/Craftopia_Data/Managed');out=[]
for p in r.glob('*.dll'):
 if True:
  assert not p.is_symlink();b=p.read_bytes();out.append({'name':p.name,'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()})
print(json.dumps(out))`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8'});if(r.status)throw Error(r.stderr);const j=JSON.parse(r.stdout);fs.writeFileSync(d+'/research/assemblies.json',JSON.stringify(j,null,2));console.log({inventoried_assemblies:j.length});
const file=process.argv[2],type=process.argv[3];if(!file)process.exit(0);if(!j.some(x=>x.name===file)||type&&!/^[\w.+`]+$/.test(type))throw Error('Exact assembly/type guard');
const toolDir=process.cwd().replaceAll('\\','/')+'/.local/light-games-next/puck/ilspy';
const args=['run','--rm','--pull','never','--network','none','--memory','512m','--cpus','1','--read-only','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--env','DOTNET_ROLL_FORWARD=Major','--env','DOTNET_CLI_TELEMETRY_OPTOUT=1','--env','DOTNET_NOLOGO=1','--env','DOTNET_GCHeapHardLimit=0x18000000','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'--mount',`type=bind,source=${toolDir},target=/tools,readonly`,sdk,'/tools/ilspycmd','--disable-updatecheck','-r','/volume/Craftopia_Data/Managed',...(type?['-t',type]:['-l','c']),'/volume/Craftopia_Data/Managed/'+file];
const q=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',maxBuffer:12e6,timeout:120000});
const name=(type??file+'-classes').replaceAll('.','_');fs.writeFileSync(d+'/research/'+name+'.txt',q.stdout??'');fs.writeFileSync(d+'/research/'+name+'-stderr.txt',q.stderr??'');
fs.writeFileSync(d+'/research/'+name+'-provenance.json',JSON.stringify({uuid:s.uuid,sdk,tool_version:'ILSpy9.1.0.7988',tool_apphost_sha256:createHash('sha256').update(fs.readFileSync(toolDir+'/ilspycmd')).digest('hex'),tool_major_rollforward_only:true,assembly:j.find(x=>x.name===file),type:type??null,exit:q.status,signal:q.signal,error:q.error?.code??null,output_sha256:createHash('sha256').update(q.stdout??'').digest('hex'),output_bytes:Buffer.byteLength(q.stdout??''),game_executed:false,network:'none',memory_mib:512},null,2));
if(q.status)throw Error('Readonly inspection failed: '+q.stderr?.slice(-1000));console.log({output:d+'/research/'+name+'.txt',bytes:Buffer.byteLength(q.stdout)});
