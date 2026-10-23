// One-shot reinstall request followed by read-only observation. Never retries POST.
// Usage: node tools/runtime/unturned-reinstall.mjs receipt.json [--observe]
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {setTimeout} from 'node:timers/promises';
const receiptPath=process.argv[2],receipt=JSON.parse(fs.readFileSync(receiptPath)),directory=path.dirname(receiptPath);
const marker=path.join(directory,'reinstall-request.json'),beforePath=path.join(directory,'before-reinstall.json'),afterPath=path.join(directory,'after-reinstall.json');
const base='http://127.0.0.1:8088/api/client/servers/'+receipt.identifier;
const api=async(suffix,method='GET',body)=>{const response=await fetch(base+suffix,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const text=await response.text();if(!response.ok)throw Error('Owned API HTTP '+response.status);return text?JSON.parse(text):null;};
if((await api('')).attributes.uuid!==receipt.uuid)throw Error('Owned UUID mismatch');
if(!process.argv.includes('--observe')){
 if(fs.existsSync(marker))throw Error('Reinstall already requested. Use --observe.');
 if((await api('/resources')).attributes.current_state!=='offline')throw Error('Stop owned engine first');
 execFileSync(process.execPath,['tools/runtime/unturned-snapshot.mjs',receiptPath,beforePath],{stdio:'inherit'});
 fs.writeFileSync(marker,JSON.stringify({uuid:receipt.uuid,requested_at:new Date().toISOString()}));
 await api('/settings/reinstall','POST',{});console.log('Owned reinstall requested once.');
}
if(!fs.existsSync(marker)||JSON.parse(fs.readFileSync(marker)).uuid!==receipt.uuid)throw Error('Missing owned reinstall request');
const deadline=Date.now()+45000;let status;
while(Date.now()<deadline){status=(await api('')).attributes.status;if(status===null)break;if(status!=='installing')throw Error('Installer state '+status);await setTimeout(1000);}
if(status!==null)throw Error('Installation still pending. Observe this same request.');
execFileSync(process.execPath,['tools/runtime/unturned-snapshot.mjs',receiptPath,afterPath],{stdio:'inherit'});
const before=JSON.parse(fs.readFileSync(beforePath)),after=JSON.parse(fs.readFileSync(afterPath));
const checks=Object.entries(before.files).map(([name,file])=>({path:name,preserved:after.files[name]?.sha256===file.sha256}));
const result={uuid:receipt.uuid,build_unchanged:before.release.buildid===after.release.buildid,files:checks,observed_at:new Date().toISOString()};
fs.writeFileSync(path.join(directory,'reinstall-preservation.json'),JSON.stringify(result,null,2)+'\n');
if(!result.build_unchanged||checks.some(check=>!check.preserved))throw Error('Inspect native release or persistent-file differences');
console.log({protected_files_preserved:checks.length,build:after.release.buildid});
