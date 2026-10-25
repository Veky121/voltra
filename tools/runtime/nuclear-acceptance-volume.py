import json,hashlib,base64,os,stat
from pathlib import Path
root=Path('/volume')
fixed=['.voltra/steam_template.py','.voltra/native_config.py','.voltra/native_console.py','.voltra/light_games_next_runtime.py','.voltra/light_games_next_install.py','.voltra/steam-template-release.json','steamapps/appmanifest_3930080.acf','DedicatedServerConfig.json','operator-owned.txt','NuclearOption-Missions/operator-note.txt','ban-owner.txt']
files={};bodies={}
for name in fixed:
 p=root/name
 if not p.exists():continue
 if any(q.is_symlink() for q in [p,*p.parents] if q!=root.parent):raise ValueError('Unsafe archive target')
 info=p.stat()
 if not stat.S_ISREG(info.st_mode) or info.st_size>2*1024*1024:raise ValueError('Unexpected archive file')
 data=p.read_bytes();files[name]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'mode':oct(info.st_mode&0o7777),'uid':info.st_uid,'gid':info.st_gid};bodies[name]=base64.b64encode(data).decode()
p=root/'NuclearOptionServer.x86_64'
if p.is_symlink() or not p.is_file():raise ValueError('Native binary absent')
h=hashlib.sha256()
with p.open('rb') as stream:
 while chunk:=stream.read(1024*1024):h.update(chunk)
print(json.dumps({'files':files,'bodies':bodies,'native_binary':{'sha256':h.hexdigest(),'bytes':p.stat().st_size}}))
