import fs from'node:fs';import{spawn,spawnSync}from'node:child_process';
const dir='.local/source-third/sven',r=JSON.parse(fs.readFileSync(dir+'/private.json')),node=JSON.parse(fs.readFileSync(r.node_receipt));
if(r.kind!=='sven'||r.node!==node.node||r.node_uuid!==node.node_uuid||r.ports.length!==1)throw Error('Owned Sven receipt mismatch');
const response=await fetch('http://127.0.0.1:8088/api/application/servers/'+r.internal_id);if(!response.ok)throw Error('Owned API lookup failed');const server=(await response.json()).attributes;if(server.uuid!==r.uuid||server.node!==node.node||server.egg!==r.egg_id)throw Error('Owned API identity mismatch');
const action=process.argv[2];
if(action==='saved-install-log'){
 const wings=JSON.parse(fs.readFileSync('.local/batch-node/wings.json'));if(wings.system?.log_directory!==node.root+'/logs')throw Error('Controller log directory scope mismatch');
 const result=spawnSync('docker',['exec',node.container,'cat',wings.system.log_directory+'/install/'+r.uuid+'.log'],{windowsHide:true,encoding:'utf8',timeout:10000});
 fs.writeFileSync(dir+'/saved-install-log-result.json',JSON.stringify({uuid:r.uuid,observed_at:new Date().toISOString(),exit_code:result.status,stderr:result.stderr},null,2));if(result.status)throw Error('Owned saved installer log unavailable; absence retained');fs.writeFileSync(dir+'/installer-first.log',result.stdout,{flag:'wx',mode:0o600});console.log({saved_install_log_captured:true,bytes:Buffer.byteLength(result.stdout)});
}else if(action==='logs'){
 const inspected=spawnSync('docker',['inspect',r.uuid],{windowsHide:true,encoding:'utf8'});if(inspected.status)throw Error('Owned game missing');const container=JSON.parse(inspected.stdout)[0];if(!container.Mounts.some(m=>m.Source===node.volume_root+'/'+r.uuid&&m.Destination==='/home/container'))throw Error('Owned volume differs');
 const result=spawnSync('docker',['logs','--since',container.State.StartedAt,'--tail','2000',r.uuid],{windowsHide:true,encoding:'utf8',timeout:10000});let log=result.stdout+result.stderr;for(const secret of[r.rcon_password,r.join_password].filter(Boolean))log=log.replaceAll(secret,'[redacted]');fs.writeFileSync(dir+'/native-current.log',log,{mode:0o600});console.log(log.slice(-6500));
}else if(action==='manifest'){
 const response=await fetch('http://127.0.0.1:8088/api/client/servers/'+r.identifier+'/files/contents?file='+encodeURIComponent('/.voltra/steam-template-release.json'));if(!response.ok)throw Error('Owned manifest unavailable');const release=await response.json();if(release.appid!==276060||!release.buildid||release.platform!=='linux')throw Error('Actual publisher release identity missing');fs.writeFileSync(dir+'/publisher-release.json',JSON.stringify(release,null,2));console.log({appid:release.appid,buildid:release.buildid,platform:release.platform});
}else if(action==='installer'){
 const output=dir+'/installer-first.log';if(fs.existsSync(output))throw Error('Capture exists; observe it instead');const info=spawnSync('docker',['inspect',r.uuid+'_installer'],{windowsHide:true,encoding:'utf8'});if(info.status)throw Error('Current owned installer is absent; retain that fact instead of recreating it');const container=JSON.parse(info.stdout)[0];if(!container.Mounts.some(m=>m.Source===node.volume_root+'/'+r.uuid&&m.Destination==='/mnt/server'))throw Error('Installer exact owned volume mismatch');
 const fd=fs.openSync(output,'wx',0o600),child=spawn('docker',['logs','--timestamps','--follow',r.uuid+'_installer'],{windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>fs.writeSync(fd,data));child.stderr.on('data',data=>fs.writeSync(fd,data));child.on('close',code=>{fs.closeSync(fd);console.log({installer_capture_terminal:code,output});});
}else if(action==='preflight'){
 if(server.status!==null)throw Error('Real game installer callback must be terminal');const inspected=spawnSync('docker',['inspect',r.uuid],{windowsHide:true,encoding:'utf8'});if(inspected.status)throw Error('Owned native container absent');const container=JSON.parse(inspected.stdout)[0];if(container.State.Running||!container.Mounts.some(m=>m.Source===node.volume_root+'/'+r.uuid&&m.Destination==='/home/container'))throw Error('Preflight requires exact owned stopped volume');
 const script=`from pathlib import Path
import os,json,subprocess,hashlib
root=Path('/home/container');env=dict(os.environ)
for key in('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):env.pop(key,None)
env['LD_LIBRARY_PATH']=str(root)+':'+str(root/'bin')
files=[]
for relative in ['svends_run','svends_linux','svends_i686','svends_amd64','engine_i686.so','engine_i486.so','filesystem_stdio.so','svencoop/dlls/server.so']:
 path=root/relative
 if not path.is_file():continue
 header=path.read_bytes()[:5];record={'path':relative,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'bytes':path.stat().st_size,'elf_bits':(32 if header[4]==1 else 64)if header[:4]==b'\\x7fELF'else None}
 if record['elf_bits']:
  checked=subprocess.run(['ldd',str(path)],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=20);record.update(ldd_exit=checked.returncode,libraries=checked.stdout.splitlines(),missing=[line.strip()for line in checked.stdout.splitlines()if 'not found'in line])
 files.append(record)
maps=sorted(path.stem for path in(root/'svencoop/maps').glob('*.bsp'))
assert(root/'svends_run').is_file(),'Original publisher launcher missing'
assert any(file['elf_bits']for file in files),'Native ELF was not found'
assert 'svencoop1'in maps,'Original default map is absent; retain this publisher mismatch'
print(json.dumps({'native_files':files,'maps':maps,'default_map_present':True,'all_observed_dependencies_present':all(not file.get('missing')for file in files)}))
`;
 const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--read-only','--user',container.Config.User,'--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--mount',`type=bind,source=${node.volume_root+'/'+r.uuid},target=/home/container,readonly`,'-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib','--entrypoint','/home/container/.voltra/python/bin/python3',container.Image,'-B','-'],{windowsHide:true,input:script,encoding:'utf8',timeout:60000});
 fs.writeFileSync(dir+'/preflight-result.json',JSON.stringify({uuid:r.uuid,node:r.node,node_uuid:r.node_uuid,image_id:container.Image,observed_at:new Date().toISOString(),exit_code:result.status,stdout:result.stdout,stderr:result.stderr},null,2));if(result.status)throw Error('Actual Sven preflight failed; full evidence retained');console.log(JSON.parse(result.stdout));
}else throw Error('Choose installer,saved-install-log,preflight,logs,manifest');
