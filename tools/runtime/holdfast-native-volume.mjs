import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const {receipt:s,node,image}=await ownedStoppedServer('.local/holdfast-native/private.json');if(s.owner!=='racing_games'||s.path!=='holdfast/egg-holdfast-na-w.json')throw Error('Foreign fixture');
const tag=process.argv[2];if(!['first','before-reinstall','after-reinstall','final','final-marker'].includes(tag))throw Error('Unknown read phase');
const code=`from pathlib import Path
import hashlib,json,stat
r=Path('/volume');base=r/'holdfastnaw-dedicated';items={};docs={}
for p in base.rglob('*'):
 if p.is_symlink()or not p.is_file():continue
 rel=str(p.relative_to(r));st=p.stat()
 if ('/configs/'in rel or '/logs_'in rel or p.name in ['bannedplayers.txt','mutedplayerschat.txt','mutedplayersvoip.txt','micspammers.txt','operator-unknown.txt']or 'appmanifest' in p.name):
  data=p.read_bytes();items[rel]={'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
 if (p.name.lower().startswith(('readme','serverconfig','dedicated'))and st.st_size<200000 and p.suffix in ('.txt','.md')):
  data=p.read_text(errors='replace');docs[rel]=data
binary=base/'Holdfast NaW';data=binary.read_bytes()
print(json.dumps({'files':items,'docs':docs,'binary':{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'elf_header':data[:20].hex()}}))`;
const p=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:3e6});if(p.status)throw Error(p.stderr);let v=JSON.parse(p.stdout);for(const key of Object.keys(v.docs))v.docs[key]=v.docs[key].replaceAll(s.test_password,'[REDACTED]');fs.writeFileSync('.local/holdfast-native/volume-'+tag+'.json',JSON.stringify(v,null,2)+'\n',{flag:'wx'});console.log({files:Object.keys(v.files).length,docs:Object.keys(v.docs),binary:v.binary});
