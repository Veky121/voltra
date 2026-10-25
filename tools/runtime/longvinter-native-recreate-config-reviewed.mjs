import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';const d='.local/longvinter-native',{receipt:s,node}=await ownedStoppedServer(d+'/private.json');const inspected=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(inspected.status)throw Error('Missing owned container');const info=JSON.parse(inspected.stdout)[0];if(info.State.Running||info.State.Pid!==0||info.State.ExitCode!==130||info.State.OOMKilled||info.Config.User!=='988:988')throw Error('Exact terminal identity');
if(!fs.existsSync(d+'/config-recreation-initial-guard-failure.json'))fs.writeFileSync(d+'/config-recreation-initial-guard-failure.json',JSON.stringify({phase:'prewrite combined guard assertion',policy_rejection:false,config_created:false,cause:'Own-read atime update strongly inferred; original pre-read atime not logged',original_driver:'tools/runtime/longvinter-native-recreate-config.mjs'},null,2)+'\n',{flag:'wx'});
const code=`from pathlib import Path
import hashlib,json,os,stat,secrets
r=Path('/volume');p=r/'longvinter-linux-server/Longvinter/Saved/Config/LinuxServer/Game.ini';b=p.with_name('Game.ini.backup');before=json.loads(${JSON.stringify(fs.readFileSync(d+'/backup-source-evidence.json','utf8'))})
def stable(s):return tuple(str(getattr(s,k)) for k in ['st_dev','st_ino','st_size','st_mode','st_uid','st_gid','st_mtime_ns','st_ctime_ns'])
for component in [p,*p.parents]:
 if component==r:break
 assert not component.is_symlink(),'symlink component'
assert not p.exists(),'current config exists'
parent=p.parent.stat();assert parent.st_mtime_ns==before['config_directory_metadata']['mtime_ns'],'parent changed before candidate'
st=b.lstat();assert stat.S_ISREG(st.st_mode),'backup not regular';assert (st.st_uid,st.st_gid)==(988,988),'backup owner changed';assert (os.getuid(),os.getgid())==(988,988),'wrong fixture user';assert st.st_mtime_ns==before['backup_metadata']['mtime_ns'] and st.st_ctime_ns==before['backup_metadata']['ctime_ns'],'backup stable metadata changed'
data=b.read_bytes();assert hashlib.sha256(data).hexdigest()=='bb481582a4c7f96708c684683d7947bae0dd80a4f86c70ff031bca78fb036f6c','backup SHA changed';assert stable(b.lstat())==stable(st),'backup changed while read';assert stable(p.parent.stat())==stable(parent),'parent changed while read'
guard={'config_absent':True,'backup_regular':True,'backup_sha256':hashlib.sha256(data).hexdigest(),'backup_identity':stable(st),'parent_identity':stable(parent),'atime_excluded':True}
g=r/'.voltra/longvinter-prewrite-guard.json';fd=os.open(g,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
with os.fdopen(fd,'w') as out:json.dump(guard,out);out.flush();os.fsync(out.fileno())
content=data+b'\\n; Voltra operator unknown \\xce\\xa9 literal $() retained\\n[VoltraRetention]\\nUnknownOperator=literal \\xce\\xa9 $()\\n';parentfd=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);temporary='.voltra-candidate-'+secrets.token_hex(16);fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parentfd);identity=os.fstat(fd)
try:
 with os.fdopen(os.dup(fd),'wb') as out:out.write(content);out.flush()
 os.fchmod(fd,st.st_mode&511);os.fsync(fd)
 assert stable(b.lstat())==stable(st),'backup changed before publish';assert (p.parent.stat().st_dev,p.parent.stat().st_ino)==(parent.st_dev,parent.st_ino),'parent identity changed'
 os.link(temporary,p.name,src_dir_fd=parentfd,dst_dir_fd=parentfd,follow_symlinks=False);os.fsync(parentfd)
finally:
 os.close(fd)
 latest=os.stat(temporary,dir_fd=parentfd,follow_symlinks=False)
 if (latest.st_dev,latest.st_ino)==(identity.st_dev,identity.st_ino):os.unlink(temporary,dir_fd=parentfd)
 os.close(parentfd)
assert b.read_bytes()==data,'backup changed after publish'
print(json.dumps({'guard':guard,'exclusive_owned_recreation':True,'new_config_sha256':hashlib.sha256(content).hexdigest(),'bytes':len(content),'mode':oct(p.stat().st_mode&511),'uid':p.stat().st_uid,'gid':p.stat().st_gid}))`;
const c=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--user','988:988','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(c.status)throw Error(c.stderr);fs.writeFileSync(d+'/approved-exclusive-config-recreation.json',c.stdout,{flag:'wx'});console.log(c.stdout);
