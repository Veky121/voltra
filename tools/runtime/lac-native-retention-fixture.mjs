import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {ownedStoppedServer} from './cache-owned-server.mjs';
const {receipt:s,node}=await ownedStoppedServer('.local/lac-native/private.json');
if(s.owner!=='unreal_survival')throw Error('Foreign acceptance owner');
const inspect=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];
if(inspect.State.Running||inspect.State.OOMKilled||inspect.State.ExitCode!==0||!inspect.Mounts.some(m=>m.Source===node.volume_root+'/'+s.uuid&&m.Destination==='/home/container'))throw Error('Need exact owned stopped development volume');
const code=`from pathlib import Path
import os,json
root=Path('/volume');config=root/'.config/unity3d/MA/LAC'
assert config.is_dir() and config.resolve().is_relative_to(root)
note=config/'operator-retention-ž.txt';assert not note.exists()
note.write_bytes('LAC retention fixture, Unicode ž, literal $value\\r\\n'.encode());os.chmod(note,0o640);os.chown(note,988,988)
path=config/'ServerConfig.txt';body=path.read_bytes();assert b'operator-retention-marker' not in body
path.write_bytes(body+b'# operator-retention-marker=517077\\n');os.chmod(path,0o640);os.chown(path,988,988)
print(json.dumps({'uuid':'${s.uuid}','operator_note_created':True,'config_comment_added':True}))
`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${node.volume_root}/${s.uuid},target=/volume`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,encoding:'utf8',input:code});
if(r.status)throw Error(r.stderr);fs.writeFileSync('.local/lac-native/retention-fixture.json',r.stdout);console.log(r.stdout);
