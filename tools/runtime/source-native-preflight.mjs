// Inspect only a stopped Source receipt's real runtime image and volume.
import fs from 'node:fs';import {execFileSync,spawnSync} from 'node:child_process';
const [receiptPath,outputPath]=process.argv.slice(2),r=JSON.parse(fs.readFileSync(receiptPath));
if(r.node!==202||!outputPath)throw Error('Specify a local Source receipt and report path');
const identity=await fetch('http://127.0.0.1:8088/api/application/servers/'+r.internal_id);
if(!identity.ok)throw Error('Owned Source lookup unavailable');
const server=(await identity.json()).attributes;if(server.uuid!==r.uuid||server.node!==202||server.egg!==r.egg_id||server.status!==null)throw Error('Owned installed Source identity mismatch');
const info=JSON.parse(execFileSync('docker',['inspect',r.uuid],{windowsHide:true,encoding:'utf8'}))[0];
const source='/var/lib/voltra-batch-20261023/volumes/'+r.uuid;
if(info.State.Running||!info.Mounts.some(m=>m.Source===source&&m.Destination==='/home/container'))throw Error('Stopped owned Source volume required');
const launcher=r.kind==='iosoccer'?'srcds_run_64':r.kind==='contagion'?'contagion_dedicated':'srcds_run';
const script=`from pathlib import Path
import os,subprocess,json,hashlib
root=Path('/home/container');launcher=root/${JSON.stringify(launcher)}
assert launcher.is_file(),'Publisher launcher missing'
environment=dict(os.environ)
for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):environment.pop(key,None)
environment['LD_LIBRARY_PATH']=str(root/'bin')+':'+str(root/'bin/linux64')
result=[]
for relative in ['contagion_dedicated','srcds_linux','srcds_linux64','srcds_linux_x64','bin/engine_srv.so','bin/engine.so','bin/linux64/engine_srv.so','bin/linux64/engine.so']:
 path=root/relative
 if not path.is_file():continue
 assert path.resolve().is_relative_to(root),'Publisher native file escapes volume'
 with path.open('rb') as binary:header=binary.read(5)
 if not header.startswith(b'\\x7fELF'):continue
 probe=subprocess.run(['ldd',str(path)],env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=20)
 result.append({'path':relative,'elf_bits':32 if header[4]==1 else 64,'ldd_exit_code':probe.returncode,'missing':[line.strip() for line in probe.stdout.splitlines() if 'not found' in line],'libraries':probe.stdout.splitlines()})
assert result,'No publisher ELF candidate found'
with launcher.open('rb') as stream:launcher_header=stream.read(5)
selection=[] if launcher_header.startswith(b'\\x7fELF') else [line.strip() for line in launcher.read_text(errors='replace').splitlines() if 'srcds_linux' in line or 'SRCDS_BINARY' in line]
print(json.dumps({'native_files':result,'binary_selection_lines':selection,'launcher_sha256':hashlib.sha256(launcher.read_bytes()).hexdigest(),'all_observed_elf_dependencies_present':all(not p['missing'] for p in result)}))
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--user',info.Config.User,'--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--mount',`type=bind,source=${source},target=/home/container,readonly`,'-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','--entrypoint','/home/container/.voltra/python/bin/python3',info.Image,'-B','-'],{windowsHide:true,input:script,encoding:'utf8',timeout:60000});
if(result.status)throw Error(result.stderr||'Runtime preflight failed');
const report={uuid:r.uuid,node:r.node,image:info.Config.Image,image_id:info.Image,observed_at:new Date().toISOString(),...JSON.parse(result.stdout)};
fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');console.log({uuid:r.uuid,native_files:report.native_files.map(f=>({path:f.path,elf_bits:f.elf_bits,missing:f.missing})),all_observed_elf_dependencies_present:report.all_observed_elf_dependencies_present});
