import fs from 'node:fs';import {resolve} from 'node:path';import {spawnSync} from 'node:child_process';
export const helpers=resolve('tools/runtime');
export const node=JSON.parse(fs.readFileSync('.local/batch-node/private.json'));
if(node.node!==202||node.cache_root!=='/var/lib/voltra-batch-20261023/cache')throw Error('Owned local cache boundary mismatch');
export const image='ghcr.io/ptero-eggs/steamcmd@sha256:38380883a880937c6bdfa25a29a50601e8fd010a126157f857539bfd9057ed7b';
export function core(args,extra=[]){
 const result=spawnSync('docker',['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${helpers},target=/helpers,readonly`,'--mount',`type=bind,source=${node.cache_root},target=/cache`,...extra,'python:3.13-slim','python3','-B','/helpers/steam-game-cache.py',...args,'--cache','/cache'],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
 if(result.status)throw Error(result.stderr||result.error?.message);return JSON.parse(result.stdout);
}
export function native(work,container,appid,mod,platform,validationOnly=false,resumePristine=false,cacheObject=''){
 const acquisition=JSON.parse(fs.readFileSync('.local/cache-steamcmd-updated/acquisition.json'));
 if(acquisition.kind!=='public-steamcmd-updated'||!/^[a-f0-9]{64}$/.test(acquisition.sha256))throw Error('Reviewed public updated SteamCMD required');
 const args=['run','--name',container,'--pull','never','--network','bridge','--user','0','--memory','512m','--cpus','1','--read-only','--tmpfs','/tmp:rw,nosuid,size=128m','--cap-drop','ALL','--security-opt','no-new-privileges',
 '--mount',`type=bind,source=${helpers},target=/helpers,readonly`,'--mount',`type=bind,source=${node.cache_root},target=/cache,readonly`,'--mount',`type=bind,source=${node.cache_root}/.capacity.lock,target=/cache/.capacity.lock`,
 '--mount',`type=bind,source=${node.cache_root}/steam-games/work/${work},target=/work`,'--mount',`type=bind,source=${node.cache_root}/sha256/${acquisition.sha256},target=/bootstrap.tar.gz,readonly`,
 '--mount',`type=bind,source=${resolve(acquisition.public_manifest)},target=/public-manifest.json,readonly`,'--entrypoint','python3',image,'-B','/helpers/steam-game-cache-native.py','--work','/work','--cache','/cache','--appid',String(appid),'--mod',mod,'--platform',platform,'--steamcmd','/work/.voltra/steamcmd/steamcmd.sh','--bootstrap-sha256',acquisition.sha256,'--bootstrap-at',acquisition.acquired_at,...(validationOnly?['--validation-only','--cache-object',cacheObject]:[]),...(resumePristine?['--resume-pristine']:[])];
 const result=spawnSync('docker',args,{encoding:'utf8',timeout:960000,maxBuffer:4*1024*1024});
 if(result.status)throw Error(result.stderr||result.error?.message);return JSON.parse(result.stdout);
}
