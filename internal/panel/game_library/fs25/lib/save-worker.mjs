import {mkdir, readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {saveGame} from './save-game.mjs';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const runFile=promisify(execFile);

const dir=join(process.env.DOCS_DIR,'modSettings','VoltraSave');
await mkdir(dir,{recursive:true});
const atomic=async(name,value)=>{const temporary=join(dir,name+'.'+randomUUID()+'.tmp');try{await writeFile(temporary,JSON.stringify(value),{mode:0o600});await rename(temporary,join(dir,name));}finally{await unlink(temporary).catch(()=>{});}};
// A request is valid for this worker session only; panel must read its heartbeat.
const session=randomUUID();
let busy=false;
await unlink(join(dir,'control.json')).catch(()=>{});
const heartbeat=()=>atomic('state.json',{protocol:1,session,updated_at:Date.now(),busy});
await heartbeat();
const timer=setInterval(()=>heartbeat().catch(e=>console.error('[VoltraSave] heartbeat failed:',e.message)),2000);
for(;;) {
  try {
    const request=JSON.parse(await readFile(join(dir,'control.json'),'utf8'));
    await unlink(join(dir,'control.json'));
    if(!/^[a-f0-9]{32}$/.test(request.id)||request.session!==session||!['save','save-and-stop'].includes(request.action)||!Number.isFinite(request.expires_at)||request.expires_at<Date.now()) throw Error('Invalid or expired control request');
    busy=true;await heartbeat();
    try {
      const result=await saveGame();
      const stopped=request.action==='save-and-stop';
      if(stopped) await runFile(process.execPath,[fileURLToPath(new URL('./start-game.mjs',import.meta.url)),'--stop'],{timeout:35000,maxBuffer:65536});
      await atomic('result.json',{session,success:true,stopped,confirmation:result.confirmation,id:request.id});
      console.log(`[VoltraSave] panel request ${request.id} confirmed`);
    } catch(error) {await atomic('result.json',{id:request.id,session,success:false,error:error.message});}
    finally {busy=false;await heartbeat();}
  } catch(error) {if(error.code!=='ENOENT')console.error('[VoltraSave] control:',error.message);}
  await new Promise(r=>setTimeout(r,250));
}
