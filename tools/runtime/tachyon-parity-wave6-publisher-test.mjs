// Offline publisher-bytecode fixture, never starts the server constructor.
import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {digest} from './campaign-native-20261029.mjs';
const base=path.resolve('.local/game-parity-20261029/runtime/tachyon-native'),source=path.join(base,'source/TachyonsCEServer.jar'),klass=path.join(base,'probe-classes/TachyonConfigProbe.class');
if(digest(fs.readFileSync(source))!=='37a9ba0349ec7f300449c18aa277e9747bd8c580c1567d79b50058a07fcacc70')throw Error('Unverified publisher JAR');
const image='ghcr.io/pterodactyl/yolks:java_8',results=[];
const cases=[
 {name:'typed-scalars-crcrlf',config:'-- publisher syntax\r\r\nSERVER_PORT=29107\r\r\nAUTOSAVE_TIME=600\r\r\nALLOW_SERVER_RESET=0\r\r\nRESPAWN_TIME=+20\r\r\n',expect:{SERVER_PORT:'29107',AUTOSAVE_TIME:'600',ALLOW_SERVER_RESET:'0',RESPAWN_TIME:'20'}},
 {name:'duplicate-last-wins-native',config:'SERVER_PORT=29107\nAUTOSAVE_TIME=400\nAUTOSAVE_TIME=600\n',expect:{SERVER_PORT:'29107',AUTOSAVE_TIME:'600'}},
 {name:'inner-key-whitespace-is-distinct',config:'SERVER_PORT=29107\nAUTOSAVE_TIME =600\n',expect:{SERVER_PORT:'29107',AUTOSAVE_TIME:'300'}},
];
for(const entry of cases){
 const dir=path.join(base,'publisher-parser-fixture',entry.name);fs.mkdirSync(dir,{recursive:true});fs.copyFileSync(source,path.join(dir,'TachyonsCEServer.jar'));fs.copyFileSync(klass,path.join(dir,'TachyonConfigProbe.class'));fs.writeFileSync(path.join(dir,'config.cfg'),entry.config);
 const args=['--context','desktop-linux','run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,size=32m','--mount',`type=bind,source=${dir},target=/probe,readonly`,'-w','/probe','--entrypoint','java',image,'-Xmx128M','-Djava.awt.headless=true','-cp','/probe/TachyonsCEServer.jar:/probe','TachyonConfigProbe'];
 const r=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',timeout:30000});
 const values=Object.fromEntries((r.stdout||'').split(/\r?\n/).filter(x=>x.startsWith('PUBLISHER_CONFIG_READBACK\t')).map(x=>x.split('\t').slice(1)));
 const passed=r.status===0&&Object.entries(entry.expect).every(([k,v])=>values[k]===v);
 results.push({name:entry.name,exit:r.status,values,passed,stdout:r.stdout,stderr:r.stderr});
 if(digest(fs.readFileSync(path.join(dir,'TachyonsCEServer.jar')))!==digest(fs.readFileSync(source))||fs.readFileSync(path.join(dir,'config.cfg'),'utf8')!==entry.config)throw Error('Readonly publisher fixture changed');
}
const report={at:new Date().toISOString(),boundary:'Actual unchanged pinned publisher e.bi/e.bj bytecode in standalone Java8 process; no game constructor, server, port, runtime API, acquisition or gameplay.',resources:{context:'desktop-linux',network:'none',source:'readonly',memory_mib:256,swap_mib:0,cpu:1,java_heap_mib:128},jar_sha256:digest(fs.readFileSync(source)),results,pass:results.every(x=>x.passed)};
fs.writeFileSync('artifacts/game-parity-20261029/tachyon-wave6-publisher-parser.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.pass)process.exitCode=1;
