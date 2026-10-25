import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const d='.local/craftopia-native',{receipt:s,node,image}=await ownedStoppedServer(d+'/private.json');
if(fs.existsSync(d+'/preboot-payload.json'))throw Error('Immutable preboot inventory exists');
const code=`from pathlib import Path
import json,hashlib,stat,base64
r=Path('/v');p=r/'Craftopia.x86_64';st=p.stat();assert stat.S_ISREG(st.st_mode) and not p.is_symlink();docs={}
for q in r.iterdir():
 if q.is_file() and not q.is_symlink() and (q.suffix.lower() in ('.ini','.md','.txt') or 'readme' in q.name.lower()) and q.stat().st_size<2*1024**2:
  b=q.read_bytes();docs[q.name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest(),'body':base64.b64encode(b).decode()}
print(json.dumps({'binary':{'bytes':st.st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':oct(st.st_mode&0o777),'uid':st.st_uid,'gid':st.st_gid},'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'preboot_paths':{n:{'exists':(r/n).exists(),'files':[str(p.relative_to(r)) for p in (r/n).rglob('*') if p.is_file()] if (r/n).is_dir() else []}for n in ['DedicatedServerSave','PPSave','.config','.local/share','BepInEx','mods']},'top_level':[{'name':p.name,'directory':p.is_dir(),'bytes':p.stat().st_size} for p in r.iterdir() if not p.is_symlink()],'documents':docs}))`;
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/v,readonly`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:8e6});
if(r.status)throw Error(r.stderr);const j=JSON.parse(r.stdout);fs.mkdirSync(d+'/publisher-docs');for(const [n,v]of Object.entries(j.documents)){if(n.includes('/')||n.includes('..'))throw Error('Docname');fs.writeFileSync(d+'/publisher-docs/'+n,Buffer.from(v.body,'base64'));delete v.body;}
fs.writeFileSync(d+'/preboot-payload.json',JSON.stringify(j,null,2)+'\n');console.log({binary:j.binary,release:j.release,documents:Object.keys(j.documents),preboot_save_exists:j.preboot_paths.DedicatedServerSave.exists});
