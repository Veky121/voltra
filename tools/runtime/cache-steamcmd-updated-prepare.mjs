#!/usr/bin/env node
// Prepare a public SteamCMD utility tree. Never reads an existing game volume.
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory=resolve('.local/cache-steamcmd-updated');
fs.mkdirSync(directory,{recursive:true});
const file=join(directory,'preparation.json');
if(fs.existsSync(file))throw Error('Existing preparation receipt; inspect it instead of repeating network preparation');
const official=JSON.parse(fs.readFileSync('.local/cache-steamcmd/acquisition.json'));
if(official.source!=='https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz'||!/^[a-f0-9]{64}$/.test(official.sha256))throw Error('Reviewed official acquisition is required');
const requestId=randomUUID(),root='/var/lib/voltra-batch-20261023/cache/steamcmd-prep/'+requestId;
const state={request_id:requestId,root,container:'voltra-steamcmd-cache-prep-'+requestId.slice(0,8),started_at:new Date().toISOString(),phase:'preparing',official,command:['steamcmd.sh','+quit'],no_login_or_game_commands:true};
const save=()=>fs.writeFileSync(file,JSON.stringify(state,null,2)+'\n',{mode:0o600});save();
const helper=fileURLToPath(new URL('./cache-steamcmd.py',import.meta.url));
const staged=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','128m','--mount',`type=bind,source=${helper},target=/helper/cache-steamcmd.py,readonly`,
 '--mount',`type=bind,source=/var/lib/voltra-batch-20261023/cache/sha256/${official.sha256},target=/official.tar.gz,readonly`,'-v',root+':/work',
 'python:3.13-slim','python3','-B','/helper/cache-steamcmd.py','--root','/work','--blob','/official.tar.gz','--sha256',official.sha256,'--source',official.source,'--acquired-at',official.acquired_at],{encoding:'utf8',windowsHide:true});
if(staged.status)throw Error('Fresh official bootstrap staging failed: '+staged.stderr);
state.phase='official_staged';save();
const image='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
const start=Date.now();
const result=spawnSync('docker',['run','--name',state.container,'--pull','never','--network','bridge','--user','0','--memory','512m','--cpus','1','--read-only','--tmpfs','/tmp:rw,nosuid,size=128m',
 '--security-opt','no-new-privileges','--cap-drop','ALL','--mount',`type=bind,source=${root},target=/work`,'-e','HOME=/work','-w','/work/.voltra/steamcmd','--entrypoint','/bin/bash',image,'-c','exec ./steamcmd.sh +quit'],
 {encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
state.elapsed_ms=Date.now()-start;state.exit_code=result.status;state.signal=result.signal;state.phase=result.status===0?'native_quit_complete':'native_quit_failed';
const logs=(result.stdout??'')+'\n'+(result.stderr??'');
fs.writeFileSync(join(directory,'prepare.log'),logs,{mode:0o600});
state.version=logs.match(/Steam Console Client[^\n]*version\s+(\d+)/)?.[1]??null;
state.reported_update_kib=[...logs.matchAll(/Downloading update \([^\n]*of (\d+) KB\)/g)].map(match=>Number(match[1]));
state.forbidden_login_output=/Connecting (?:anonymously|to Steam)|Logging in user|Waiting for user info|app_update/i.test(logs);
const inspect=spawnSync('docker',['inspect',state.container],{encoding:'utf8'});
if(inspect.status===0){const info=JSON.parse(inspect.stdout)[0];state.container_state=info.State;state.runtime_image=info.Image;}
save();
if(result.error||result.status!==0||!state.version||state.forbidden_login_output)throw Error('Public SteamCMD preparation did not finish with a verified version and +quit only; inspect preparation receipt/log');
const inventory=spawnSync('docker',['run','--rm','--network','none','--memory','128m','--mount',`type=bind,source=${root},target=/work,readonly`,'python:3.13-slim','python3','-B','-c',
 "from pathlib import Path;import json;root=Path('/work');print(json.dumps([{'path':str(p.relative_to(root)),'bytes':p.stat().st_size,'symlink':p.is_symlink()}for p in sorted(root.rglob('*'))if p.is_file() or p.is_symlink()],indent=2))"],{encoding:'utf8'});
if(inventory.status)throw Error('Fresh utility inventory failed');
fs.writeFileSync(join(directory,'inventory.json'),inventory.stdout);
console.log(JSON.stringify({request_id:requestId,phase:state.phase,version:state.version,elapsed_ms:state.elapsed_ms,reported_update_kib:state.reported_update_kib,forbidden_login_output:state.forbidden_login_output,inventory:join(directory,'inventory.json')}));
