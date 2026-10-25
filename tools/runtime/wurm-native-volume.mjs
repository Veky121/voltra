import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/wurm-native',action=process.argv[2],tag=process.argv[3];if(!['inspect','snapshot','verify'].includes(action)||!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid bounded read');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='wurm_unlimited/egg-wurm-unlimited.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,hashlib,stat
r=Path('/volume');files={};sizes={}
for name in ['dist/Adventure','dist/Creative','LaunchConfig.ini']:
 parent=r/name;size=0
 for p in [parent,*parent.rglob('*')]if parent.exists()else[]:
  if p.is_symlink():raise ValueError('Unreviewed operator link')
  if p.is_file():
   st=p.stat();size+=st.st_size;files[str(p.relative_to(r))]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
 sizes[name]=size
b=r/'WurmServerLauncher';total=sum(p.stat().st_size for p in r.rglob('*')if p.is_file()and not p.is_symlink());backup=sum(p.stat().st_size for p in(r/'backup').rglob('*')if p.is_file()and not p.is_symlink())
print(json.dumps({'files':files,'world_bytes':sizes,'backup_bytes':backup,'actual_volume_bytes':total,'root_files':[p.name for p in r.iterdir()],'binary':{'size':b.stat().st_size,'elf':b.open('rb').read(20).hex(),'sha256':hashlib.sha256(b.read_bytes()).hexdigest()},'release':json.loads((r/'.voltra/steam-template-release.json').read_text())}))
`;
const p=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:6e6});if(p.status)throw Error(p.stderr);const result=JSON.parse(p.stdout);
if(action==='verify'&&JSON.stringify(JSON.parse(fs.readFileSync(dir+'/snapshot-'+tag+'.json')).files)!==JSON.stringify(result.files))throw Error('Strict world metadata retention mismatch');
fs.writeFileSync(dir+'/'+action+'-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log({...result,files:Object.keys(result.files).length});
