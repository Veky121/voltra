import fs from 'node:fs';import {randomBytes} from 'node:crypto';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';import {api} from './openttd-compat-node.mjs';
const dir='.local/romestead-native',{receipt:s,node,image}=await ownedStoppedServer(dir+'/private.json');if(s.owner!=='unreal_survival')throw Error('Foreign fixture');
const info=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];if(info.State.ExitCode!==0)throw Error('Require last canonical normalstop0');
const code=`from pathlib import Path
import json,os
r=Path('/fixture');saved=r/'saved_worlds';assert (saved/'Voltra canonical eight GiB/game_state').is_file(),'Require actual generated native world'
note=saved/'.voltra-operator-preservation';assert not note.exists();note.write_bytes('Literal operator state ž\\n'.encode());note.chmod(0o640)
c=r/'config.json';v=json.loads(c.read_text());assert 'VoltraUnknown'not in v;v['EnableCheats']=True;v['AutoCreateWorldSeed']='operator seed retained';v['VoltraUnknown']={'unicode':'ž','literal':'$value "quoted"'};c.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\\n');c.chmod(0o640)
print(json.dumps({'native_world_present':True,'operator_seed_and_cheats_set':True,'unknown_json_set':True,'operator_note_mode':'0640'}))`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--user',info.Config.User,'--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/fixture`,image,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(r.status)throw Error(r.stderr);
s.test_password_updated='literal " ž '+randomBytes(12).toString('hex');fs.writeFileSync(dir+'/private.json',JSON.stringify(s,null,2)+'\n',{mode:0o600});
await api('/api/application/servers/'+s.internal_id+'/startup','PATCH',{environment:{MAX_PLAYERS:'3',PASSWORD:s.test_password_updated,CHEATS:'false',AUTO_UPDATE:'0'}});
fs.writeFileSync(dir+'/preservation-prepare.json',r.stdout,{flag:'wx'});console.log(r.stdout);
