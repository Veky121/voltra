import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/jc3-native',action=process.argv[2],tag=process.argv[3];if(!['inspect','snapshot','fixtures','verify'].includes(action)||!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid action');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='just_cause/just_cause_3/egg-j-c3-m-p.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,os,stat,hashlib
r=Path('/volume');action=${JSON.stringify(action)};cfg=r/'config.json'
if cfg.is_symlink():raise ValueError('Unsafe config symlink')
if action=='fixtures':
 p=r/'packages/voltra-retention.txt'
 if p.exists() or p.is_symlink() or p.parent.is_symlink():raise ValueError('Existing fixture collision')
 p.parent.mkdir(exist_ok=True);p.write_bytes(b'Owned JC3 no-gameplay persistence fixture\\n');p.chmod(0o640);os.chown(p,988,989)
files={}
for name in ['config.json','packages']:
 parent=r/name
 for p in [parent,*parent.rglob('*')]if parent.exists()else[]:
  if p.is_symlink():raise ValueError('Unreviewed operator-state symlink')
  if p.is_file():
   st=p.stat();files[str(p.relative_to(r))]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
config=json.loads(cfg.read_text());config['password_set']=bool(config.pop('password',''))
docs={}
for p in r.iterdir():
 if p.is_file() and p.name.lower().startswith(('readme','config','license')) and p.suffix.lower() in('.txt','.md') and p.stat().st_size<65536:docs[p.name]=p.read_text(errors='replace')
binary=r/'Server';st=binary.stat()
counter=r/'packages/voltra-persistence/data/counter.json'
print(json.dumps({'config':config,'files':files,'counter':json.loads(counter.read_text())if counter.exists()else None,'root_files':[p.name for p in r.iterdir()],'documentation':docs,'binary':{'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'elf':binary.open('rb').read(20).hex(),'sha256':hashlib.sha256(binary.read_bytes()).hexdigest()},'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'actual_volume_bytes':sum(p.stat().st_size for p in r.rglob('*')if p.is_file()and not p.is_symlink())}))
`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume${action==='fixtures'?'':',readonly'}`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:4e6});if(r.status)throw Error(r.stderr);const result=JSON.parse(r.stdout);
if(action==='verify'&&JSON.stringify(read('snapshot-'+tag).files)!==JSON.stringify(result.files))throw Error('Strict operator retention mismatch');function read(name){return JSON.parse(fs.readFileSync(dir+'/'+name+'.json'));}
fs.writeFileSync(dir+'/'+action+'-'+tag+'.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log({...result,files:Object.keys(result.files).length});
