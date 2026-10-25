import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/romestead-native',{receipt:s,node}=await ownedStoppedServer(dir+'/private.json'),info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];
const common=['run','--rm','--pull','never','--network','none','--memory','256m','--user','0:0','--cap-drop','ALL','--cap-add','DAC_OVERRIDE','--security-opt','no-new-privileges','-e','DOTNET_CLI_TELEMETRY_OPTOUT=1','-e','DOTNET_NOLOGO=1'];
const build=spawnSync('docker',[...common,'--mount',`type=bind,source=${path.resolve(dir+'/dotnet-pipe-fixture')},target=/project`,'--workdir','/project','--entrypoint','dotnet',info.Image,'build','--configuration','Release','--verbosity','quiet','-p:UseSharedCompilation=false'],{windowsHide:true,encoding:'utf8',timeout:60000});if(build.status)throw Error('Offline console fixture build failed '+build.stdout+build.stderr);
const names=['steam-template.py','native-config.py','native-console.py','source-install.py','source-next-install.py','tactical-install.py','tactical-runtime.py','crafting-install.py','crafting-runtime.py'],read=name=>fs.readFileSync(name==='crafting-runtime.py'?'.local/romestead-pipe/crafting-runtime.py':'internal/panel/game_library/scripts/'+name,'utf8');
const code='SOURCES='+JSON.stringify(names.map(name=>[name.slice(0,-3).replaceAll('-','_'),read(name)]))+`\nimport sys,types,io,os,tempfile,json,shutil
from pathlib import Path
for name,source in SOURCES:
 module=types.ModuleType(name);exec(source,module.__dict__);sys.modules[name]=module
class Capture:
 def __init__(self):self.buffer=io.BytesIO()
 def flush(self):pass
with tempfile.TemporaryDirectory()as directory:
 root=Path(directory)
 for source in Path('/dummy').iterdir():
  if source.is_file():shutil.copyfile(source,root/source.name)
 read_fd,write_fd=os.pipe();os.write(write_fd,b'list\\nstop\\n');os.close(write_fd);previous_input,previous_output=sys.stdin,sys.stdout;capture=Capture()
 try:
  sys.stdin=os.fdopen(read_fd,'r');sys.stdout=capture
  code=sys.modules['crafting_runtime'].main(root,{'VOLTRA_CRAFTING':'romestead','SRCDS_APPID':'4763510','SERVER_PORT':'28003','VOLTRA_ALLOCATED_PORTS':'28003','AUTO_UPDATE':'0','PASSWORD':'privatesecret'})
 finally:sys.stdin.close();sys.stdin=previous_input;sys.stdout=previous_output
 output=capture.buffer.getvalue();log=(root/'logs/latest.log').read_bytes()
 assert code==7,'Raw .NET code changed';assert b'REDIRECTED:True:True'in output,'Original pipe semantics missing';assert b'FIRST:list;SECOND:stop'in output,'Literal commands corrupted';assert b'privatesecret'not in output and b'[redacted]'in output;assert b'\\r'not in output and b'\\x00'not in output;assert log==output
 print(json.dumps({'synthetic_actual_dotnet':True,'memory_mib':256,'stdin_redirected':True,'stdout_redirected':True,'literal_commands':['list','stop'],'raw_exit_code':code,'public_log_matches':True,'split_secret_redacted':True,'no_nul_or_cr':True}))`;
const result=spawnSync('docker',[...common,'-i','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture,readonly`,'--mount',`type=bind,source=${path.resolve(dir+'/dotnet-pipe-fixture/bin/Release/net8.0')},target=/dummy,readonly`,'-e','PYTHONHOME=/fixture/.voltra/python','-e','LD_LIBRARY_PATH=/fixture/.voltra/python/lib','--entrypoint','/fixture/.voltra/python/bin/python3',info.Image,'-B','-'],{windowsHide:true,input:code,encoding:'utf8',timeout:15000,maxBuffer:1000000});if(result.status)throw Error('Actual.NET pipe fixture failed '+result.stdout+result.stderr);fs.writeFileSync(dir+'/dotnet-pipe-fixture-proof.json',result.stdout,{flag:'wx'});console.log(result.stdout);
