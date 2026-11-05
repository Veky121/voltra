import {realpathSync} from 'node:fs';
// Update transactions are kept beside the payload, on the same filesystem.
// A failed or interrupted installer must not destroy the last working DLC.
import {readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, lstatSync, createReadStream} from 'node:fs';
import {join, basename} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function installerInfo(file) {
  const match=/^FarmingSimulator25_([A-Za-z0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)_([0-9]+)_ESD\.exe$/.exec(basename(file));
  return match ? {file:basename(file), product:match[1], version:match.slice(2).map(Number)} : null;
}
export function latestInstallers(files) {
  const products=new Map();
  for(const file of files) {
    const info=installerInfo(file); if(!info)continue;
    const old=products.get(info.product);
    const difference=old ? info.version.map((v,i)=>v-old.version[i]).find(v=>v!==0)||0 : 1;
    if(difference>0)products.set(info.product,info);
  }
  return [...products.values()].sort((a,b)=>a.product.localeCompare(b.product));
}
const regular=path=>{try {const s=lstatSync(path);return s.isFile()&&!s.isSymbolicLink()?s:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export function preventDowngrades(items,directory) {
  const versions=new Map();
  for(const name of readdirSync(directory)) {
    if(!/^\.(installed|pending)-[a-f0-9]{64}\.json$/.test(name))continue;
    const data=JSON.parse(readFileSync(join(directory,name),'utf8'));
    if(!/^[A-Za-z0-9]+$/.test(data.product)||!/^\d+\.\d+\.\d+\.\d+$/.test(data.version))continue;
    const version=data.version.split('.').map(Number),old=versions.get(data.product);
    if(!old||(version.map((v,i)=>v-old[i]).find(v=>v!==0)||0)>0)versions.set(data.product,version);
  }
  return items.filter(item=>{
    const known=versions.get(item.product);
    if(known&&(item.version.map((v,i)=>v-known[i]).find(v=>v!==0)||0)<0) {
      console.error('[fs25/install] Skipping older installer for '+item.product+'; a newer version was already staged.');
      return false;
    }
    return true;
  });
}
export async function digest(path) {
  if(!regular(path))throw Error('Expected a regular file');
  const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');
}
function paths(info,env) {
  if(!info)throw Error('Unsupported installer filename');
  const root=join(env.DOCS_DIR,'pdlc');
  return {root,payload:join(root,info.product+'.dlc'),backup:join(root,'.voltra-update',info.product+'.dlc'),transaction:join(root,'.voltra-update',info.product+'.json')};
}
function atomicJSON(path,data) {writeFileSync(path+'.tmp',JSON.stringify(data),{mode:0o600});renameSync(path+'.tmp',path);}
export function rollback(info,env=process.env) {
  const p=paths(info,env);
  if(!regular(p.transaction))return;
  const record=JSON.parse(readFileSync(p.transaction,'utf8'));
  if(record.product!==info.product)throw Error('Invalid update transaction');
  if(regular(p.backup)) {
    rmSync(p.payload,{force:true});renameSync(p.backup,p.payload);
  } else if(!record.hadPayload)rmSync(p.payload,{force:true});
  // If a crash occurred before the backup rename, the original is still in place.
  rmSync(p.transaction,{force:true});
}
export async function begin(info,env=process.env) {
  const p=paths(info,env);mkdirSync(join(p.root,'.voltra-update'),{recursive:true,mode:0o700});
  rollback(info,env);
  if(lstatSync(p.payload,{throwIfNoEntry:false})&&!regular(p.payload))throw Error('Unsafe payload path');
  if(lstatSync(p.backup,{throwIfNoEntry:false}))throw Error('Unresolved backup');
  const hadPayload=!!regular(p.payload);
  atomicJSON(p.transaction,{product:info.product,hadPayload,version:info.version.join('.')});
  if(hadPayload)renameSync(p.payload,p.backup);
}
export async function complete(info,hash,env=process.env) {
  const p=paths(info,env);
  if(!regular(p.payload)?.size)throw Error('No nonempty replacement payload');
  const payloadHash=await digest(p.payload);
  const marker=join(env.DLC_DIR,'.pending-'+hash);
  atomicJSON(marker+'.json',{product:info.product,version:info.version.join('.'),payloadHash});
  writeFileSync(marker+'.tmp',info.product+'.dlc\n',{mode:0o600});renameSync(marker+'.tmp',marker);
  const transaction=JSON.parse(readFileSync(p.transaction,'utf8'));
  atomicJSON(p.transaction,{...transaction,hash,phase:'pending'});
}
export async function recover(env=process.env) {
  const root=join(env.DOCS_DIR,'pdlc/.voltra-update');
  if(!lstatSync(root,{throwIfNoEntry:false}))return;
  for(const name of readdirSync(root)) {
    if(!/^[A-Za-z0-9]+\.json$/.test(name))continue;
    const record=JSON.parse(readFileSync(join(root,name),'utf8'));
    if(record.product!==name.slice(0,-5)||!/^\d+\.\d+\.\d+\.\d+$/.test(record.version))throw Error('Invalid recovery record');
    const info={product:record.product,version:record.version.split('.').map(Number)};
    if(record.phase==='pending'&&/^[a-f0-9]{64}$/.test(record.hash)&&await markerValid(info,record.hash,env))continue;
    rollback(info,env);
    console.error('[fs25/install] Recovered interrupted update for '+record.product+'.');
  }
}
export async function markerValid(info,hash,env=process.env) {
  const p=paths(info,env);
  for(const kind of ['installed','pending']) {
    const marker=join(env.DLC_DIR,'.'+kind+'-'+hash);
    if(!regular(marker)||!regular(marker+'.json')||!regular(p.payload)?.size)continue;
    const data=JSON.parse(readFileSync(marker+'.json','utf8'));
    if(data.product===info.product&&data.version===info.version.join('.')&&data.payloadHash===await digest(p.payload))return true;
  }
  return false;
}
export function commit(product,docsDir,version) {
  if(!/^[A-Za-z0-9]+$/.test(product))throw Error('Invalid product');
  const p=paths({product},{DOCS_DIR:docsDir});
  if(regular(p.transaction)&&JSON.parse(readFileSync(p.transaction,'utf8')).version!==version)throw Error('Different update is pending');
  rmSync(p.backup,{force:true});rmSync(p.transaction,{force:true});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const [command,file,hash]=process.argv.slice(2),info=installerInfo(file||'');
    if(command==='plan') {
      await recover();
      const files=readdirSync(process.env.DLC_DIR);
      if(files.some(file=>/^FarmingSimulator25_.*\.exe$/.test(file)&&!installerInfo(file)))console.error('[fs25/install] Unsupported DLC filename skipped; use the original versioned GIANTS filename.');
      for(const item of preventDowngrades(latestInstallers(files),process.env.DLC_DIR))console.log(item.file);
    }
    else if(command==='recover')await recover();
    else if(command==='begin')await begin(info);
    else if(command==='complete')await complete(info,hash);
    else if(command==='rollback')rollback(info);
    else if(command==='valid')process.exitCode=await markerValid(info,hash)?0:1;
    else throw Error('Unknown operation');
  } catch {console.error('[fs25/install] DLC state check failed; preserving recovery files.');process.exitCode=1;}
}
