import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {ownedStoppedServer} from './cache-owned-server.mjs';
const {receipt:s,node,image}=await ownedStoppedServer('.local/holdfast-native/private.json');if(s.owner!=='racing_games')throw Error('Foreign fixture');
const code=`from pathlib import Path
import json,os
r=Path('/volume/holdfastnaw-dedicated');p=r/'configs/serverconfig_default.txt';assert p.is_file();data=p.read_bytes();assert b'Voltra operator unknown'not in data;p.write_bytes(b'# Voltra operator unknown literal $value \\"quoted\\"\\n'+data);p.chmod(0o640)
n=r/'configs/operator-unknown.txt';assert not n.exists();n.write_bytes(b'operator literal $value \\"quoted\\"\\n');n.chmod(0o640)
print(json.dumps({'operator_comment_added':True,'unknown_file_added':True,'mode':416}))`;
const p=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--user','988:988','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume`,image,'python3','-B','-c',code],{windowsHide:true,encoding:'utf8'});if(p.status)throw Error(p.stderr);fs.writeFileSync('.local/holdfast-native/operator-fixture.json',p.stdout,{flag:'wx'});console.log(p.stdout);
