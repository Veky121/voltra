// Bounded public launcher parser probes. Never account credentials or game downloads.
import fs from 'node:fs';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';import {resolve} from 'node:path';
const app90=process.argv.includes('--app90');
const anonymous=process.argv.includes('--anonymous')||app90;
const config=process.argv.includes('--config')||anonymous;
const filenames=process.argv.includes('--filenames');
const literal=process.argv.includes('--literal');
const inspect=process.argv.includes('--inspect');
const help=process.argv.includes('--help')||inspect;
const cvar=process.argv.includes('--cvar');
const scripted=process.argv.includes('--script');
const directory=resolve(app90?'.local/steamcmd-parser-app90':anonymous?'.local/steamcmd-parser-anonymous':filenames?(literal?'.local/steamcmd-parser-filenames-literal':'.local/steamcmd-parser-filenames-v2'):config?'.local/steamcmd-parser-config':inspect?'.local/steamcmd-parser-inspect':help?'.local/steamcmd-parser-help':scripted?'.local/steamcmd-parser-script-v2':cvar?'.local/steamcmd-parser-cvar':'.local/steamcmd-parser');fs.mkdirSync(directory,{recursive:true});
const receipt=directory+'/receipt.json';if(fs.existsSync(receipt))throw Error('Probe already exists; inspect rather than repeat');
const acquired=resolve('.local/cache-steamcmd-updated');const acquisition=JSON.parse(fs.readFileSync(acquired+'/acquisition.json'));
const id=randomUUID(),base='/var/lib/voltra-batch-20261023/utility/steamcmd-parser/'+id;
const report={request_id:id,base,scope:anonymous?'Public anonymous login plus app_set_config '+(app90?'90 mod':'0 voltra_fixture')+' fake fixture only; no account credentials or game downloads':config?'Public app_set_config0 fake fixture only; no account, login or game download':'Public SteamCMD parser fixture only; no account, login, app command or game download',cases:[]};
const save=()=>fs.writeFileSync(receipt,JSON.stringify(report,null,2)+'\n');save();
const quote=value=>'"'+(literal?value:value.replaceAll('\\','\\\\').replaceAll('"','\\"'))+'"';
for(const [name,value,quoted] of (filenames?[['plus','+quit',true],['spaces','  fixture spaces  ',true],['quotes','fixture"quote"',true],['backslash','fixture\\slash',true],['utf8','fixture-\u03bb\u00e9',true],['mixed','  fixture "quote" \\ +quit \u03bb\u00e9  ',true]]:help?[['help','',false]]:[['raw-plus','+quit',false],['raw-mixed','  fixture space "quote" \\ +quit  ',false],['quoted-plus','+quit',true],['quoted-mixed','  fixture space "quote" \\ +quit  ',true]])){
 const root=base+'/'+name,container='voltra-steamcmd-parser-'+id.slice(0,8)+'-'+name;
 const stage=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${resolve('tools/runtime/cache-steamcmd.py')},target=/helper/cache-steamcmd.py,readonly`,'--mount',`type=bind,source=${resolve('tools/runtime/cache-steamcmd-public.py')},target=/helper/cache-steamcmd-public.py,readonly`,'--mount',`type=bind,source=${acquired}/public-manifest.json,target=/manifest.json,readonly`,'--mount',`type=bind,source=/var/lib/voltra-batch-20261023/cache/sha256/${acquisition.sha256},target=/archive.tar.gz,readonly`,'-v',root+':/work','python:3.13-slim','python3','-B','/helper/cache-steamcmd.py','--root','/work','--blob','/archive.tar.gz','--sha256',acquisition.sha256,'--source',acquisition.source,'--acquired-at',acquisition.acquired_at,'--public-manifest','/manifest.json'],{encoding:'utf8',windowsHide:true});
 if(stage.status)throw Error('Fresh public staging failed: '+stage.stderr);
 const marker='VOLTRA_PARSER_AFTER_'+name;const row={name,root,container,fixture:value,argument:quoted?quote(value):value,phase:'running'};report.cases.push(row);save();
 let commands=cvar?['+VOLTRA_PARSER_BEFORE_'+name,'+@sSteamCmdForcePlatformType',row.argument,'+@sSteamCmdForcePlatformType','+'+marker,'+quit']:['+echo','VOLTRA_PARSER_BEFORE_'+name,'+echo',row.argument,'+echo',marker,'+quit'];
 if(help)commands=inspect?['+help','scripts','+help','commandline','+find','config','+quit']:['+help','+quit'];
 if(config)commands=['+app_set_config '+(app90?'90 mod':'0 voltra_fixture')+' '+row.argument,'+quit'];
 if(anonymous)commands=['+login','anonymous',...commands];
 if(filenames){
  const written=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','128m','--mount',`type=bind,source=${root},target=/work`,'python:3.13-slim','python3','-c',"from pathlib import Path;import sys;(Path('/work/.voltra/steamcmd')/sys.argv[1]).write_text(sys.argv[2],encoding='utf-8')",value,'@sSteamCmdForcePlatformType VOLTRA_OPENED_EXACT_'+name+'\nquit\n'],{encoding:'utf8',windowsHide:true});if(written.status)throw Error(written.stderr);
  commands=['+runscript '+row.argument,'+quit'];
 }
 if(scripted){
  const text='@ShutdownOnFailedCommand 0\n@sSteamCmdForcePlatformType '+row.argument+'\n@sSteamCmdForcePlatformType\nquit\n';
  const written=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','128m','--mount',`type=bind,source=${root},target=/work`,'python:3.13-slim','python3','-c',"from pathlib import Path;import sys;Path('/work/probe.txt').write_text(sys.argv[1])",text],{encoding:'utf8',windowsHide:true});if(written.status)throw Error(written.stderr);
  commands=['+runscript','/work/probe.txt','+'+marker,'+quit'];
 }
 const native=spawnSync('docker',['run','--name',container,'--pull','never','--network','bridge','--user','0','--memory','512m','--cpus','1','--read-only','--tmpfs','/tmp:rw,nosuid,size=128m','--cap-drop','ALL','--security-opt','no-new-privileges','--mount',`type=bind,source=${root},target=/work`,'-e','HOME=/work','-w','/work/.voltra/steamcmd','--entrypoint','/bin/bash','ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b','-c','exec ./steamcmd.sh "$@"','voltra-parser',...commands],{encoding:'utf8',windowsHide:true,timeout:45000,maxBuffer:2*1024**2});
 const logs=(native.stdout??'')+'\n'+(native.stderr??'');fs.writeFileSync(directory+'/'+name+'.log',logs);
 Object.assign(row,{phase:'complete',exit_code:native.status,version:logs.match(/version\s+(\d{8,})/)?.[1]??null,after_marker:logs.includes(marker),exact_file_opened:filenames?logs.includes('VOLTRA_OPENED_EXACT_'+name):null,output_lines:logs.split('\n').filter(line=>/VOLTRA_|fixture|Unknown command|Command not found|ForcePlatformType|quit/.test(line)),forbidden_activity:(anonymous?/Logging in user/i:/Connecting anonymously|Logging in user/i).test(logs)});save();
 if(native.error||(row.exit_code!==0&&!(filenames&&row.exit_code===7))||row.forbidden_activity){spawnSync('docker',['rm','-f',container],{encoding:'utf8',windowsHide:true});throw Error('Bounded parser utility failed; inspect receipt');}
 console.log({name,after_marker:row.after_marker,output_lines:row.output_lines});
}
