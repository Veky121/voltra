import fs from'node:fs';import{resolve,join}from'node:path';import{spawnSync}from'node:child_process';import{createHash}from'node:crypto';import{managedNativeLease}from'./managed-steam-acceptance-lease.mjs';
const r=JSON.parse(fs.readFileSync('.local/managed-steam-native/current.json'));if(r.game!=='palworld-native'||r.root!=='/var/lib/voltra-batch-20261023/managed-bridge/'+r.run_id||resolve(r.directory)!==resolve('.local/managed-steam-native',r.run_id))throw Error('Owned fixture required');managedNativeLease(JSON.parse(fs.readFileSync('.local/game-batch/queue.json')),r.lease_id,r.game);const g=JSON.parse(fs.readFileSync(join(r.directory,'private/game.json')));if(!g.uuid?.startsWith(g.identifier+'-'))throw Error('Owned game identity required');const docker=args=>{let o=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});if(o.status)throw Error('Protected world operation failed '+o.stderr);return o.stdout};const info=JSON.parse(docker(['inspect',g.uuid]))[0];if(info.State.Running||!info.Mounts.some(m=>m.Source===r.root+'/volumes/'+g.uuid&&m.Destination==='/home/container'))throw Error('Owned stopped game mount required');const status=await fetch(r.panel_url+'/api/client/servers/'+g.identifier+'/steam');if(!status.ok||(await status.json()).attributes.current_job)throw Error('No active maintenance required');const[command,old]=process.argv.slice(2);if(!['export','restore'].includes(command))throw Error('export or restore required');if(command==='restore'&&!/^[a-f0-9-]{36}$/.test(old??''))throw Error('Exact source run required');const source=command==='export'?r.directory:resolve('.local/managed-steam-native',old);const archive=join(source,'private/palworld-protected.tar'),manifest=join(source,'private/palworld-protected.json');if(command==='export'&&fs.existsSync(archive))throw Error('Immutable export already exists');if(command==='restore'){const m=JSON.parse(fs.readFileSync(manifest));if(m.archive_sha256!==createHash('sha256').update(fs.readFileSync(archive)).digest('hex')||m.run_id!==old)throw Error('Immutable export provenance mismatch')}
const program=String.raw`
from pathlib import Path
import tarfile,hashlib,json,stat,os,shutil,sys
root=Path('/game');archive=Path('/private/palworld-protected.tar');manifest=Path('/private/palworld-protected.json');command,run=sys.argv[1:]
def snapshot():
 result={}
 for path in (root/'Pal/Saved').rglob('*'):
  st=path.lstat()
  assert stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode),'special protected file'
  if stat.S_ISREG(st.st_mode):result[path.relative_to(root).as_posix()]={'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid,'size':st.st_size}
 return result
if command=='export':
 files=snapshot()
 with tarfile.open(archive,'w') as t:t.add(root/'Pal/Saved',arcname='Pal/Saved',recursive=True)
 os.chmod(archive,0o600);report={'run_id':run,'archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'files':files};manifest.write_text(json.dumps(report,indent=2));os.chmod(manifest,0o600)
else:
 report=json.loads(manifest.read_text());assert report['run_id']==run and hashlib.sha256(archive.read_bytes()).hexdigest()==report['archive_sha256']
 with tarfile.open(archive) as t:
  seen=set()
  for member in t.getmembers():
   path=Path(member.name);assert not path.is_absolute() and '..' not in path.parts and path.parts[:2]==('Pal','Saved') and (member.isfile() or member.isdir()) and member.name not in seen;seen.add(member.name)
  target=root/'Pal/Saved';assert target.resolve()==target and target.is_dir() and not target.is_symlink();shutil.rmtree(target)
  t.extractall(root,filter='fully_trusted')
 assert snapshot()==report['files'],'restored protected metadata mismatch'
print(json.dumps({'operation':command,'source_run':run,'archive_sha256':report['archive_sha256'],'files':len(report['files']),'exact_sha_mode_uid_gid':True}))
`;
let result=JSON.parse(docker(['run','--rm','--pull','never','--network','none','--memory','128m','--cpus','1','--mount',`type=bind,source=${r.root}/volumes/${g.uuid},target=/game${command==='export'?',readonly':''}`,'--mount',`type=bind,source=${join(source,'private')},target=/private${command==='restore'?',readonly':''}`,'python:3.13-slim','python3','-B','-c',program,command,command==='export'?r.run_id:old]));fs.writeFileSync(join(r.directory,'world-'+command+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
