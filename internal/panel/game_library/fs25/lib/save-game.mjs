import {open, mkdir, readFile, readdir, stat, writeFile, rename, unlink} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function hasConfirmedStop({docsDir=process.env.DOCS_DIR,now=Date.now()}={}) {
  if(!docsDir)return false;
  const dir=join(docsDir,'modSettings','VoltraSave');
  try {
    const [state,result,info]=await Promise.all([readFile(join(dir,'state.json'),'utf8').then(JSON.parse),readFile(join(dir,'result.json'),'utf8').then(JSON.parse),stat(join(dir,'result.json'))]);
    const age=now-info.mtimeMs;
    return state.protocol===1 && typeof state.session==='string' && state.session.length>0 && result.session===state.session && result.success===true && result.stopped===true && /^[a-f0-9]{32}$/.test(result.id) && age>=0 && age<=15000;
  } catch {return false;}
}

// A fresh request marker followed by the engine's own success message is required.
// Old saves, an accepted request, and modified files alone never mean success.
export async function saveGame({docsDir=process.env.DOCS_DIR, timeoutMs=60000}={}) {
  if (!docsDir) throw Error('DOCS_DIR is required');
  const dir=join(docsDir,'modSettings','VoltraSave');
  await mkdir(dir,{recursive:true});
  const lock=join(dir,'save.lock');
  const handle=await open(lock,'wx',0o600).catch(()=>{throw Error('Another save request is running; inspect save.lock if its process has died');});
  const id=randomBytes(16).toString('hex');
  const request=join(dir,'request.xml'), temporary=join(dir,`request-${id}.tmp`);
  try {
    const names=(await readdir(docsDir)).filter(n=>/^log(?:_.*)?\.txt$/.test(n));
    if (!names.length) throw Error('No active game log; start the game session first');
    const logs=await Promise.all(names.map(async name=>({path:join(docsDir,name),info:await stat(join(docsDir,name))})));
    logs.sort((a,b)=>a.info.mtimeMs-b.info.mtimeMs);
    const log=logs.at(-1).path;
    const before=await stat(log);
    let offset=before.size, pending='', accepted=false;
    await writeFile(temporary,`<voltraSave id="${id}" action="save"/>\n`,{mode:0o600});
    await rename(temporary,request);
    const end=Date.now()+timeoutMs;
    while (Date.now()<end) {
      const current=await stat(log);
      if(current.ino!==before.ino || current.size<offset) throw Error('Game session changed while saving');
      const file=await open(log,'r');
      try {
        const size=Math.min(current.size-offset,256*1024);
        if(size>0) {
          const buffer=Buffer.alloc(size);
          const {bytesRead}=await file.read(buffer,0,size,offset); offset+=bytesRead;
          pending+=buffer.subarray(0,bytesRead).toString('utf8');
          let newline;
          while((newline=pending.indexOf('\n'))>=0) {
            const line=pending.slice(0,newline).replace(/\r$/,'');pending=pending.slice(newline+1);
            if(line.includes(`[VoltraSave] rejected ${id} `)) throw Error(line.slice(line.indexOf('[VoltraSave]')));
            if(line.endsWith(`[VoltraSave] requested ${id}`)) accepted=true;
            if(accepted && /(?:^|\s)Game saved successfully \(savegame\d+\)\.$/.test(line)) return {id,confirmation:line};
          }
          if(pending.length>65536) throw Error('Oversized game log line');
        }
      } finally {await file.close();}
      await new Promise(r=>setTimeout(r,200));
    }
    throw Error('Save timed out: no fresh engine save confirmation; server must remain running');
  } finally {
    await unlink(request).catch(()=>{}); await unlink(temporary).catch(()=>{});
    await handle.close(); await unlink(lock);
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.includes('--has-confirmed-stop'))process.exitCode=await hasConfirmedStop()?0:2;
  else if(await hasConfirmedStop()) console.log('[VoltraSave] Recent save and stopped-session proof accepted.');
  else saveGame().then(result=>console.log(`[VoltraSave] confirmed ${result.id}: ${result.confirmation}`)).catch(error=>{console.error(`[VoltraSave] ${error.message}`);process.exitCode=1;});
}
