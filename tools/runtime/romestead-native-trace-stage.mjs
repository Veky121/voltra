import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/romestead-native',{receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json');
const info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0],pin=JSON.parse(fs.readFileSync(dir+'/diagnostic-public-source/receipt.json'));
const code=`from pathlib import Path
import zipfile,json,hashlib,os
r=Path('/fixture');target=r/'.voltra/diagnostic-tool';assert not target.exists();assert hashlib.sha256(Path('/package.nupkg').read_bytes()).hexdigest()==${JSON.stringify(pin.sha256)}
with zipfile.ZipFile('/package.nupkg')as z:
 assert sum(i.file_size for i in z.infolist())<128*1024**2,'Expanded utility bound'
 for item in z.infolist():
  name=Path(item.filename);assert not name.is_absolute()and'..'not in name.parts;assert (item.external_attr>>16)&0o170000!=0o120000,'No tool symlinks'
 z.extractall(target)
for p in [target,*target.rglob('*')]:p.chmod(0o700 if p.is_dir()else 0o600)
entry=target/'tools/net8.0/any/dotnet-trace.dll';assert entry.is_file();assert (entry.parent/'Microsoft.Diagnostics.Tracing.TraceEvent.dll').is_file()
trace=r/'.voltra/diagnostics';trace.mkdir(mode=0o700);print(json.dumps({'entry':str(entry.relative_to(r)),'expanded_bytes':sum(p.stat().st_size for p in target.rglob('*')if p.is_file()),'private_mode':'0700/0600'}))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--user',info.Config.User,'--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture`,'--mount',`type=bind,source=${path.resolve(dir+'/diagnostic-public-source/dotnet-trace.nupkg')},target=/package.nupkg,readonly`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(result.status)throw Error(result.stderr);fs.writeFileSync(dir+'/trace-tool-stage.json',result.stdout);console.log(result.stdout);
