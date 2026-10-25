import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/solace-native',action=process.argv[2],tag=process.argv[3]??'current';
if(!['inspect','prepare','fixtures','snapshot','verify'].includes(action)||!/^[a-z0-9_-]+$/.test(tag))throw Error('Invalid bounded volume operation');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');
if(s.owner!=='game_batch_inventory'||s.path!=='solace_crafting/egg-solace-crafting.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import os,json,hashlib,stat
r=Path('/volume'); cfg=r/'.config/unity3d/Big Kitty Games/Solace Crafting/servercfg.dat'
action=${JSON.stringify(action)}
for p in [cfg,*cfg.parents]:
 if p.is_relative_to(r) and p.is_symlink():raise ValueError('Unreviewed configuration link')
if action=='prepare':
 if cfg.exists():raise ValueError('Existing native config; do not overwrite')
 defaults=json.loads((r/'.voltra/fantasy_worlds_defaults.json').read_text())['solace']
 defaults.update(name='Voltra private Solace',isPrivate=True,password=${JSON.stringify(s.test_password)},allowAdmin=False,allowModerator=False,adminPassword='',moderatorPassword='',maxPlayers=2,port=${s.ports[0]},steamQueryPort=${s.ports[1]},autoRestart=0)
 cfg.parent.mkdir(parents=True,exist_ok=True)
 cfg.write_text(json.dumps(defaults,indent=2)+'\\n');cfg.chmod(0o600);os.chown(cfg,988,988)
 for p in cfg.parents:
  if p.is_relative_to(r) and p!=r:os.chown(p,988,988)
if action=='fixtures':
 for name in ['Mods/voltra-preserve.txt','mods/voltra-preserve.txt']:
  p=r/name
  if p.exists() or p.is_symlink() or p.parent.is_symlink():raise ValueError('Existing operator fixture collision')
  p.parent.mkdir(exist_ok=True);p.write_bytes(('Owned no-gameplay retention fixture '+name+'\\n').encode());p.chmod(0o640);os.chown(p,988,989)
def inventory():
 result={}
 for name in ['.config/unity3d/Big Kitty Games/Solace Crafting','Mods','mods']:
  folder=r/name
  for p in sorted(folder.rglob('*')) if folder.exists() else []:
   if p.is_symlink():raise ValueError('Unexpected operator-state symlink')
   if p.is_file():
    st=p.stat();result[str(p.relative_to(r))]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
 return result
files=inventory()
value={'files':files,'root_files':[p.name for p in r.iterdir()],'release':json.loads((r/'.voltra/steam-template-release.json').read_text())}
if cfg.exists():
 config=json.loads(cfg.read_text());value['config']={k:(bool(v) if 'password' in k.lower() else v) for k,v in config.items()}
print(json.dumps(value))
`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume${['prepare','fixtures'].includes(action)?'':',readonly'}`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:4e6});
if(result.status)throw Error(result.stderr);
const value=JSON.parse(result.stdout);
if(action==='verify'){
 const before=JSON.parse(fs.readFileSync(dir+'/snapshot-'+tag+'.json'));if(JSON.stringify(before.files)!==JSON.stringify(value.files))throw Error('Operator state differs across reinstall');
}
const file=dir+'/'+action+'-'+tag+'.json';fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
console.log({action,tag,files:Object.keys(value.files).length,root_files:value.root_files,config:value.config,release:value.release});
