// Execute only after parent approves resetting this exact failed-menu fixture.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const dir='.local/romestead-native',{receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json');
const baseline=JSON.parse(fs.readFileSync(dir+'/first-menu-state.json')),failed=JSON.parse(fs.readFileSync(dir+'/first-menu-cleaned.json'));
if(s.owner!=='unreal_survival'||failed.state.ExitCode!==143||baseline.uuid!==s.uuid||fs.existsSync(dir+'/first-failed-config-private.json'))throw Error('Not unique failed-menu baseline');
const code=`from pathlib import Path
import json,base64,hashlib
r=Path('/fixture');p=r/'config.json';assert p.is_file()and not p.is_symlink();assert hashlib.sha256(p.read_bytes()).hexdigest()==${JSON.stringify(baseline.files['config.json'].sha256)},'Failed fixture config changed'
for name in ['worlds','saves']:assert not (r/name).exists()and not (r/name).is_symlink(),'Unexpected existing saves'
saved=r/'saved_worlds';assert not saved.is_symlink(),'Saved-world symlink rejected'
if saved.exists():assert saved.is_dir()and not list(saved.iterdir()),'Saved-world directory must be genuinely empty'
original=p.read_bytes();print(json.dumps({'bytes':base64.b64encode(original).decode(),'sha256':hashlib.sha256(original).hexdigest()}))`;
const result=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(result.status)throw Error(result.stderr);
fs.writeFileSync(dir+'/first-failed-config-private.json',result.stdout,{mode:0o600,flag:'wx'});
const remove=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture`,image,'python3','-B','-'],{windowsHide:true,input:code+'\np.unlink()\n',encoding:'utf8'});if(remove.status)throw Error(remove.stderr);
console.log({archived_exact_failed_fixture_config:true,genuine_config_absence_for_corrected_install:true});
