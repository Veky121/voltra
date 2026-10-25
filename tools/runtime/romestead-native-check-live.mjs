import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const dir='.local/romestead-native',s=JSON.parse(fs.readFileSync(dir+'/private.json')),v=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(v.uuid!==s.uuid||v.external_id!=='romestead-native-'+s.request_id)throw Error('Foreign live fixture');
const code=`from pathlib import Path
import json,os
r=Path('/home/container');log=(r/'logs/latest.log').read_bytes();config=json.loads((r/'config.json').read_text());pid=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:args=p.read_bytes().split(b'\\0')
 except FileNotFoundError:continue
 if len(args)>1 and args[0].endswith(b'/dotnet')and args[1]==b'/home/container/Server.dll':pid.append(p.parent.name)
assert len(pid)==1
public=log.decode(errors='replace');print(json.dumps({'password_exact':config.get('Password')==${JSON.stringify(s.test_password_updated)},'no_private_password_in_log':all(secret.encode()not in log for secret in ${JSON.stringify([s.test_password,s.test_password_updated])}),'log_has_nul':b'\\0'in log,'log_has_cr':b'\\r'in log,'cursor_dsr_absent':b'\\x1b[6n'not in log,'unknown_command_absent':'Unknown command'not in public,'native_stdin':os.readlink('/proc/'+pid[0]+'/fd/0'),'native_stdout':os.readlink('/proc/'+pid[0]+'/fd/1'),'player_status_lines':[line for line in public.splitlines()if'player'in line.lower()or'connected'in line.lower()],'world_loaded_existing':"Loading world 'Voltra canonical eight GiB'"in public and'Generating World:'not in public,'native_save_complete':'Saved'in public,'operator_cheats_retained':config.get('EnableCheats')is True,'operator_seed_retained':config.get('AutoCreateWorldSeed')=='operator seed retained','unknown_json_present_after_native_start':'VoltraUnknown'in config,'max_players':config.get('MaxPlayers')}))`;
const r=spawnSync('docker',['exec','-i','-e','PYTHONHOME=/home/container/.voltra/python','-e','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'.voltra/python/bin/python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(r.status)throw Error('Live native proof read failed');
const out=JSON.parse(r.stdout);fs.writeFileSync(dir+'/pipe-live-proof.json',JSON.stringify(out,null,2)+'\n',{flag:'wx'});console.log(out);
