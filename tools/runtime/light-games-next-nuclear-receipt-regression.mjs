// Restore the originally observed generated receipt ownership solely to test
// the root-installer preservation fix. No content or game process is changed.
import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';import {ownedStoppedServer} from './cache-owned-server.mjs';
const {receipt:s}=await ownedStoppedServer('.local/light-games-next/nuclear/private.json'),profile=JSON.parse(fs.readFileSync('.local/light-games-next/profiles.json'))[s.path];
await api('/api/admin/eggs/'+s.egg_id+'/scripts','PATCH',{script_install:profile.egg.scripts.installation.script,script_entry:'bash',script_container:profile.egg.scripts.installation.container});
const code="import os,pathlib;p=pathlib.Path('/volume/.voltra/steam-template-release.json');assert p.is_file() and not p.is_symlink();os.chown(p,988,988);print('Original observed receipt UID:GID restored for regression check')";
const result=spawnSync('docker',['run','--rm','--network','none','--memory','128m','--mount',`type=bind,source=/var/lib/voltra-batch-20261023/volumes/${s.uuid},target=/volume`,'python:3.13-slim','python','-c',code],{encoding:'utf8',windowsHide:true});if(result.status)throw Error(result.stderr);console.log(result.stdout);
