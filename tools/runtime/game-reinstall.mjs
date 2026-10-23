// Request one reinstall, then observe that request and compare persistent hashes.
// Usage: node game-reinstall.mjs receipt.json relative-path [...] [--observe]
import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import {setTimeout} from 'node:timers/promises';
const [receiptPath,...args]=process.argv.slice(2),receipt=JSON.parse(fs.readFileSync(receiptPath));
const observe=args.includes('--observe'),paths=args.filter(value=>value!=='--observe'),directory=path.dirname(receiptPath);
const marker=path.join(directory,'reinstall-request.json'),beforePath=path.join(directory,'before-reinstall.json'),afterPath=path.join(directory,'after-reinstall.json');
const base='http://127.0.0.1:8088/api/client/servers/'+receipt.identifier;
const api=async(suffix,method='GET',body)=>{const response=await fetch(base+suffix,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const text=await response.text();if(!response.ok)throw Error('Owned API HTTP '+response.status);return text?JSON.parse(text):null;};
if((await api('')).attributes.uuid!==receipt.uuid)throw Error('Owned UUID mismatch');
let request;
const save=()=>fs.writeFileSync(marker,JSON.stringify(request,null,2));
if(!observe){
 if(!paths.length||fs.existsSync(marker))throw Error('Specify persistent paths for a new request, or use --observe for the existing request.');
 if((await api('/resources')).attributes.current_state!=='offline')throw Error('Stop the owned game first');
 execFileSync(process.execPath,['tools/runtime/game-volume-snapshot.mjs',receiptPath,beforePath,...paths],{stdio:'inherit',windowsHide:true});
 request={uuid:receipt.uuid,paths,phase:'requesting',requested_at:new Date().toISOString()};save();
 await api('/settings/reinstall','POST',{});request.phase='acknowledged';save();console.log('Owned reinstall requested once.');
}else{
 request=JSON.parse(fs.readFileSync(marker));if(request.uuid!==receipt.uuid)throw Error('Owned reinstall identity mismatch');
 if(paths.length&&JSON.stringify(paths)!==JSON.stringify(request.paths))throw Error('Persistent selection changed; inspect the same request');
}
const deadline=Date.now()+45000;let status;
while(Date.now()<deadline){
 status=(await api('')).attributes.status;
 if(status==='installing'&&request.phase==='requesting'){request.phase='observed_installing';save();}
 if(status===null)break;
 if(status!=='installing')throw Error('Installer state '+status);
 await setTimeout(1000);
}
if(status!==null)throw Error('Installation pending. Observe this same request.');
if(request.phase==='requesting')throw Error('Request acknowledgement missing; completion is uncertain. No reinstall retry was issued.');
execFileSync(process.execPath,['tools/runtime/game-volume-snapshot.mjs',receiptPath,afterPath,...request.paths],{stdio:'inherit',windowsHide:true});
const before=JSON.parse(fs.readFileSync(beforePath)),after=JSON.parse(fs.readFileSync(afterPath));
const files=Object.entries(before.files).map(([name,file])=>{
 const current=after.files[name];
 const checked=['mode','uid','gid'].filter(key=>file[key]!==undefined);
 return {path:name,preserved:file.sha256===current?.sha256,metadata_checked:checked,metadata_preserved:checked.every(key=>file[key]===current?.[key])};
});
const buildAvailable=Number.isSafeInteger(before.release?.buildid)&&before.release.buildid>0&&Number.isSafeInteger(after.release?.buildid)&&after.release.buildid>0&&Number.isSafeInteger(before.release?.appid)&&before.release.appid===after.release?.appid;
const result={uuid:receipt.uuid,build_comparison_available:buildAvailable,build_unchanged:buildAvailable?before.release.buildid===after.release.buildid:null,files,observed_at:new Date().toISOString()};
fs.writeFileSync(path.join(directory,'reinstall-preservation.json'),JSON.stringify(result,null,2)+'\n');
if(files.some(file=>!file.preserved||!file.metadata_preserved))throw Error('Protected persistent contents or permissions changed; inspect the recorded differences');
console.log({protected_files_preserved:files.length,build_unchanged:result.build_unchanged});
