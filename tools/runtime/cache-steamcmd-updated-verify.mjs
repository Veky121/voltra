#!/usr/bin/env node
import fs from 'node:fs';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';import {resolve,join} from 'node:path';import {fileURLToPath} from 'node:url';
const directory=resolve('.local/cache-steamcmd-updated'),file=join(directory,'verification.json');
if(fs.existsSync(file))throw Error('Existing verification; inspect it instead of repeating native runs');
const acquisition=JSON.parse(fs.readFileSync(join(directory,'acquisition.json')));
const requestId=randomUUID(),base='/var/lib/voltra-batch-20261023/cache/steamcmd-verify/'+requestId;
const report={request_id:requestId,base,archive_sha256:acquisition.sha256,started_at:new Date().toISOString(),cases:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
const stage=fileURLToPath(new URL('./cache-steamcmd.py',import.meta.url));
const publicHelper=fileURLToPath(new URL('./cache-steamcmd-public.py',import.meta.url));
const image='ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b';
for(const name of ['one','two']){
 const root=base+'/'+name,container='voltra-steamcmd-cache-verify-'+requestId.slice(0,8)+'-'+name;
 const staged=spawnSync('docker',['run','--rm','--network','none','--memory','256m','--mount',`type=bind,source=${stage},target=/helper/cache-steamcmd.py,readonly`,'--mount',`type=bind,source=${publicHelper},target=/helper/cache-steamcmd-public.py,readonly`,
  '--mount',`type=bind,source=${directory}/public-manifest.json,target=/manifest.json,readonly`,'--mount',`type=bind,source=/var/lib/voltra-batch-20261023/cache/sha256/${acquisition.sha256},target=/archive.tar.gz,readonly`,'-v',root+':/work',
  'python:3.13-slim','python3','-B','/helper/cache-steamcmd.py','--root','/work','--blob','/archive.tar.gz','--sha256',acquisition.sha256,'--source',acquisition.source,'--acquired-at',acquisition.acquired_at,'--public-manifest','/manifest.json'],{encoding:'utf8',maxBuffer:1024*1024});
 if(staged.status)throw Error('Independent public staging failed: '+staged.stderr);
 const row={name,root,container,stage:JSON.parse(staged.stdout),phase:'running'};
 report.cases.push(row);save();
 const start=Date.now();
 const native=spawnSync('docker',['run','--name',container,'--pull','never','--network','bridge','--user','0','--memory','512m','--cpus','1','--read-only','--tmpfs','/tmp:rw,nosuid,size=128m','--security-opt','no-new-privileges','--cap-drop','ALL','--mount',`type=bind,source=${root},target=/work`,'-e','HOME=/work','-w','/work/.voltra/steamcmd','--entrypoint','/bin/bash',image,'-c','exec ./steamcmd.sh +quit'],{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:4*1024*1024});
 const logs=(native.stdout??'')+'\n'+(native.stderr??'');fs.writeFileSync(join(directory,'verify-'+name+'.log'),logs);
 Object.assign(row,{phase:'complete',exit_code:native.status,elapsed_ms:Date.now()-start,version:logs.match(/Steam Console Client[^\n]*version\s+(\d+)/)?.[1]??null,
  update_check_observed:logs.includes('Checking for available updates'),reported_update_kib:[...new Set([...logs.matchAll(/Downloading update \([^\n]*of (\d+) KB\)/g)].map(match=>Number(match[1])))],
  forbidden_login_output:/Connecting (?:anonymously|to Steam)|Logging in user|Waiting for user info|app_update/i.test(logs)});save();
 if(native.error||native.status!==0||!row.version||!row.update_check_observed||row.forbidden_login_output)throw Error('Native public-only verification failed; inspect receipt');
 console.log(row);
}
const independent=spawnSync('docker',['run','--rm','--network','none','--mount',`type=bind,source=${base},target=/copies,readonly`,'--mount',`type=bind,source=/var/lib/voltra-batch-20261023/cache/sha256/${acquisition.sha256},target=/archive.tar.gz,readonly`,'python:3.13-slim','python3','-c',
 "from pathlib import Path;import hashlib,json;a=Path('/copies/one/.voltra/steamcmd/linux64/steamcmd');b=Path('/copies/two/.voltra/steamcmd/linux64/steamcmd');print(json.dumps({'separate_inodes':a.stat().st_ino!=b.stat().st_ino,'archive_sha256':hashlib.sha256(Path('/archive.tar.gz').read_bytes()).hexdigest()}))"],{encoding:'utf8'});
if(independent.status)throw Error('Independent copy observation failed');
report.independence=JSON.parse(independent.stdout);save();
if(!report.independence.separate_inodes||report.independence.archive_sha256!==acquisition.sha256)throw Error('Copies are not independent or cache changed');
console.log({two_fresh_native_runs_passed:true,cases:report.cases.map(({name,elapsed_ms,reported_update_kib})=>({name,elapsed_ms,reported_update_kib})),independence:report.independence});
