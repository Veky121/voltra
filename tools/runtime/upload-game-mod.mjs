// Uploads an owned acceptance mod through the same resumable API as the web UI.
// Usage: node tools/runtime/upload-game-mod.mjs receipt.json file /mods [--pause-after-first-chunk]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [receiptPath,localFile,directory,...flags]=process.argv.slice(2);
const receipt=JSON.parse(await fsp.readFile(receiptPath,'utf8'));
if(!/^[a-f0-9]{8}$/.test(receipt.identifier)||!directory?.startsWith('/')||directory.split('/').includes('..'))throw Error('Specify an owned server receipt, file and destination directory');
const origin='http://127.0.0.1:8088',base=origin+'/api/client/servers/'+receipt.identifier;
const identity=await fetch(base);if(!identity.ok||(await identity.json()).attributes.uuid!==receipt.uuid)throw Error('Server identity mismatch');
const filename=path.basename(localFile),size=(await fsp.stat(localFile)).size;
const hashFile=async()=>{const hash=createHash('sha256');for await(const data of fs.createReadStream(localFile))hash.update(data);return hash.digest('hex');};
const sha256=await hashFile(),statePath=receiptPath+'.mod-upload.json';
let transfer=fs.existsSync(statePath)?JSON.parse(await fsp.readFile(statePath,'utf8')):null;
if(transfer&&(transfer.sha256!==sha256||transfer.directory!==directory||transfer.filename!==filename))throw Error('The transfer receipt belongs to another file or destination');
const save=()=>fsp.writeFile(statePath,JSON.stringify(transfer,null,2));
if(!transfer){
 const metadata=Object.entries({filename,directory}).map(([key,value])=>key+' '+Buffer.from(value).toString('base64')).join(',');
 const r=await fetch(base+'/files/transfers',{method:'POST',headers:{'Tus-Resumable':'1.0.0','Upload-Length':String(size),'Upload-Metadata':metadata}});
 if(r.status!==201)throw Error('Upload creation HTTP '+r.status);
 const url=new URL(r.headers.get('Location'),origin);
 if(url.origin!==origin||!url.pathname.startsWith(new URL(base).pathname+'/files/transfers/'))throw Error('Unexpected upload location');
 transfer={url:url.href,filename,directory,size,sha256,completed:false};await save();
}
let resumedFrom=size;
if(!transfer.completed){
 const head=await fetch(transfer.url,{method:'HEAD',headers:{'Tus-Resumable':'1.0.0'}});if(head.status!==200)throw Error('Upload offset HTTP '+head.status);
 let offset=Number(head.headers.get('Upload-Offset'));if(!Number.isSafeInteger(offset)||offset<0||offset>size)throw Error('Invalid upload offset');resumedFrom=offset;
 const handle=await fsp.open(localFile,'r');
 try{
  while(offset<size){
   const buffer=Buffer.alloc(Math.min(4<<20,size-offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,offset);if(bytesRead!==buffer.length)throw Error('Local file changed during upload');
   const r=await fetch(transfer.url,{method:'PATCH',headers:{'Tus-Resumable':'1.0.0','Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:buffer});
   if(r.status!==204||Number(r.headers.get('Upload-Offset'))!==offset+bytesRead)throw Error('Upload chunk HTTP '+r.status);
   offset+=bytesRead;
   if(flags.includes('--pause-after-first-chunk')&&offset<size){transfer.paused_offset=offset;await save();console.log({file:filename,paused:true,offset,total:size});process.exit(0);}
  }
 }finally{await handle.close();}
 const complete=await fetch(transfer.url+'/complete',{method:'POST'});if(complete.status!==200)throw Error('Upload commit HTTP '+complete.status);
 transfer.completed=true;transfer.resumed_from=resumedFrom;await save();
}
const download=await fetch(base+'/files/download-stream?'+new URLSearchParams({file:directory.replace(/\/$/,'')+'/'+filename}));if(!download.ok)throw Error('Verification download HTTP '+download.status);
const hash=createHash('sha256');let received=0;for await(const data of download.body){received+=data.length;hash.update(data);}
if(received!==size||hash.digest('hex')!==sha256)throw Error('Uploaded mod bytes do not match');
if(!transfer.receipt_removed){const cleanup=await fetch(transfer.url,{method:'DELETE',headers:{'Tus-Resumable':'1.0.0'}});if(cleanup.status!==204)throw Error('Completed receipt cleanup HTTP '+cleanup.status);transfer.receipt_removed=true;}
transfer.verified=true;await save();console.log({file:filename,bytes:size,resumed_from:transfer.resumed_from,sha256_verified:true});
