import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const {receipt:s,node}=await ownedStoppedServer('.local/scpsl-native-approved/private.json');const r=spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'});if(r.status)throw Error('Exactfixturemissing');const user=JSON.parse(r.stdout)[0].Config.User;if(!/^\d+:\d+$/.test(user))throw Error('Numericownerrequired');
const code=`from pathlib import Path
import json
r=Path('/volume');base=r/'.config/SCP Secret Laboratory/config'/'${s.ports[0]}'
for n in ['config_gameplay.txt','config_remoteadmin.txt']:
 p=base/n;t=p.read_text();p.write_text(t+'\\n# Voltra native acceptance: Unicode \\u03a9 literal $() retention\\n')
p=base/'config_gameplay.txt';t=p.read_text();rows=t.splitlines(keepends=True);matches=[i for i,l in enumerate(rows) if l.startswith('server_name:')];assert len(matches)==1
rows[matches[0]]='server_name: Voltra isolated SCP SL acceptance \\u03a9\\n';p.write_text(''.join(rows))
print(json.dumps({'patched':['config_gameplay.txt','config_remoteadmin.txt'],'ban_files_untouched':True,'mode_uid_gid_unchanged':True}))`;
const c=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--user',user,'--cap-drop','ALL','--security-opt','no-new-privileges','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});if(c.status)throw Error(c.stderr);fs.writeFileSync('.local/scpsl-native-approved/operator-fixtures.json',c.stdout);console.log(c.stdout);
