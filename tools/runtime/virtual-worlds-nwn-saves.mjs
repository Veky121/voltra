import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const dir='.local/virtual-worlds/nwn',s=JSON.parse(fs.readFileSync(dir+'/private.json')),phase=process.argv[2];
if(!/^[a-z0-9-]+$/.test(phase||''))throw Error('Named evidence phase required');
const r=spawnSync('docker',['run','--rm','--pull','never','--network','none','--memory','128m','--cpus','1','--read-only','--mount',`type=bind,source=/var/lib/voltra-batch-20261023/volumes/${s.uuid},target=/volume,readonly`,'--mount',`type=bind,source=${process.cwd().replaceAll('\\','/')}/tools/runtime/virtual-worlds-nwn-save-inspect.py,target=/inspect.py,readonly`,'python:3.13-slim','python','-B','/inspect.py'],{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
if(r.status)throw Error('Save metadata inspection failed '+r.stderr.slice(-500));
fs.writeFileSync(dir+'/'+phase+'-save-metadata.json',r.stdout);
console.log(JSON.parse(r.stdout).saves.map(x=>({path:x.path,sha256:x.sha256,bytes:x.bytes,fields:x.resources.find(x=>x.fields)?.fields})));
