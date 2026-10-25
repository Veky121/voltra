import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/fortress-native',action=process.argv[2],tag=process.argv[3];if(!['inspect','snapshot','verify'].includes(action)||!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Invalid bounded volume read');
const {receipt:s,node}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='game_batch_inventory'||s.path!=='fortresscraft_evolved/egg-fortresscraft-evolved.json')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,stat,hashlib,re
r=Path('/volume');files={};configs={};world_files=[]
for p in r.rglob('*'):
 if p.is_symlink() or not p.is_file():continue
 relative=p.relative_to(r);parts=[v.lower()for v in relative.parts]
 if parts[0]in('.voltra','.steam','steamapps','steam'):continue
 world=any(v in('worlds','saves','savegames','mods','plugins')for v in parts[:-1])
 config=relative.as_posix()in('Default/firstrun.ini','Default/serveroverrides.ini')
 if world or config:
  st=p.stat();files[str(relative)]={'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':st.st_size,'mode':stat.S_IMODE(st.st_mode),'uid':st.st_uid,'gid':st.st_gid}
  if world:world_files.append(str(relative))
 if config:configs[str(relative)]=re.sub(r'(?im)^(\\s*RCONPassword\\s*=)[^\\r\\n]*',r'\\1[redacted]',p.read_text(errors='replace'))
b=r/'FC_Linux_Universal.x86_64'
print(json.dumps({'files':files,'world_files':world_files,'configs':configs,'root_files':[p.name for p in r.iterdir()],'binary':{'bytes':b.stat().st_size,'elf':b.open('rb').read(20).hex(),'sha256':hashlib.sha256(b.read_bytes()).hexdigest()},'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'volume_bytes':sum(p.stat().st_size for p in r.rglob('*')if p.is_file()and not p.is_symlink())}))
`;
const p=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--cpus','1','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:10e6});if(p.status)throw Error(p.stderr);const value=JSON.parse(p.stdout);
if(action==='verify'&&JSON.stringify(JSON.parse(fs.readFileSync(dir+'/snapshot-'+tag+'.json')).files)!==JSON.stringify(value.files))throw Error('Strict world/config metadata differs');
fs.writeFileSync(dir+'/'+action+'-'+tag+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});console.log({...value,files:Object.keys(value.files).length,world_files:value.world_files.length});
