import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';const d='.local/abiotic-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');const code=`from pathlib import Path
import os,stat,json,hashlib
r=Path('/v');p=r/'AbioticFactor/Saved/SaveGames/Server/Admin.ini';marker=b'\\n; Voltra isolated operator retention comment\\n[VoltraAcceptanceUnknown]\\nLiteral=retain-this-only-test-fixture\\n';parent=p.parent
for part in [r/'AbioticFactor',r/'AbioticFactor/Saved',r/'AbioticFactor/Saved/SaveGames',parent]:assert part.is_dir() and not part.is_symlink()
fd=os.open(p,os.O_RDWR|os.O_NOFOLLOW)
try:
 st=os.fstat(fd);assert stat.S_ISREG(st.st_mode)and(st.st_uid,st.st_gid)==(988,988);old=os.read(fd,65536);assert b'VoltraAcceptanceUnknown' not in old;os.lseek(fd,0,os.SEEK_END);os.write(fd,marker);os.fchmod(fd,0o640)
finally:os.close(fd)
folder=r/'AbioticFactor/Saved/VoltraAcceptance';folder.mkdir();os.chown(folder,988,988);p2=folder/'operator-retention.txt';f=os.open(p2,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o640);os.write(f,b'Explicit synthetic operator fixture, not game world state.\\n');os.fchown(f,988,988);os.close(f)
print(json.dumps([{'path':str(v.relative_to(r)),'sha256':hashlib.sha256(v.read_bytes()).hexdigest(),'bytes':v.stat().st_size,'mode':oct(v.stat().st_mode&0o777),'uid':v.stat().st_uid,'gid':v.stat().st_gid}for v in(p,p2)]))`;const c=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:1e6});if(c.status)throw Error(c.stderr);fs.writeFileSync(d+'/operator-fixtures.json',c.stdout,{flag:'wx'});console.log(c.stdout);
