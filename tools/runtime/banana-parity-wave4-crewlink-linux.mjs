import fs from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const helper='internal/panel/game_library/scripts/crewlink-controls.py',before=hash(helper);
const context=JSON.parse(execFileSync('docker',['context','inspect','desktop-linux'],{encoding:'utf8',windowsHide:true}))[0];
if(context.Endpoints.docker.Host!=='npipe:////./pipe/dockerDesktopLinuxEngine')throw Error('Windows Docker Desktop engine required');
const image='sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704';
const suites=[{label:'original',file:'tools/runtime/crewlink-parity-wave4-test.py'},{label:'seed',file:'tools/runtime/banana-parity-wave4-crewlink-test.py'}];
const report={scope:'Offline source fixtures only; no game payload, acquisition or native execution',source:{path:helper,sha256:before},docker_context:'desktop-linux',engine:context.Endpoints.docker.Host,image,network:'none',source_mount:'read-only /work',container_root:'read-only',memory_mib:256,memory_plus_swap_mib:256,cpus:1,tmpfs:'/tmp rw,size64m',suites:[]};
for(const suite of suites){
 const args=['--context','desktop-linux','run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,size=64m','-v',process.cwd().replaceAll('\\','/')+':/work:ro','-w','/work',image,'python','-B',suite.file];
 const result=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:2*1024**2});
 const output=(result.stdout||'')+(result.stderr||''),log='artifacts/game-parity-20261029/banana-wave4-crewlink-'+suite.label+'.log';fs.writeFileSync(log,output);
 const count=+(output.match(/Ran (\d+) tests?/)?.[1]||0);
 report.suites.push({file:suite.file,sha256:hash(suite.file),log,command:['docker',...args],exit_code:result.status,passed:result.status===0?count:0,executed:count,skipped:+(output.match(/skipped=(\d+)/)?.[1]||0),error:result.error?.message||null});
 console.log(JSON.stringify({suite:suite.label,executed:count,exit_code:result.status}));
}
report.source_after=hash(helper);report.source_frozen=before===report.source_after;
fs.writeFileSync('artifacts/game-parity-20261029/banana-wave4-crewlink-offline.json',JSON.stringify(report,null,2)+'\n');
if(!report.source_frozen||report.suites.some(s=>s.exit_code!==0))throw Error('Offline fixture checks failed; preserve logs');
