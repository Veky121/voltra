import {realpathSync} from 'node:fs';
import {readdirSync,readFileSync,statSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {commit} from './dlc-update.mjs';

export function pendingDLCs(directory) {
  const entries=[];
  for(const name of readdirSync(directory)) {
    if(!/^\.pending-[a-f0-9]{64}$/.test(name))continue;
    const payloads=readFileSync(join(directory,name),'utf8').trim().split('\n');
    if(payloads.length&&payloads.every(file=>/^[A-Za-z0-9_-]+\.dlc$/.test(file))) entries.push({marker:name,payloads});
  }
  return entries;
}

export function verifyPendingDLCs(directory,log,write=line=>console.log(line),docsDir=process.env.DOCS_DIR) {
  if(!/^\d{4}-\d\d-\d\d [\d:.]+\s+Info:\s+Entered Gameplay\s*$/m.test(log))return 0;
  if(/^.*Error.*(?:dlc|activat|licen).*$/im.test(log))return 0;
  let verified=0;
  for(const entry of pendingDLCs(directory)) {
    if(!entry.payloads.every(file=>new RegExp('^\\d{4}-\\d\\d-\\d\\d [\\d:.]+\\s+Load dlc:\\s+pdlc_'+file.slice(0,-4)+'(?:\\s|$)','mi').test(log)))continue;
    const metadata=join(directory,entry.marker+'.json');
    let update;
    try {update=JSON.parse(readFileSync(metadata,'utf8'));}catch(error){if(error.code!=='ENOENT')continue;}
    if(update) {
      if(!/^[A-Za-z0-9]+$/.test(update.product)||!/^\d+\.\d+\.\d+\.\d+$/.test(update.version))continue;
      const available=new RegExp('Available dlc:.*\\(Version: '+update.version.replaceAll('.','\\.')+'\\)\\s+pdlc_'+update.product+'(?:\\s|$)');
      if(!available.test(log))continue;
      // Keep the recovery copy unless this invocation knows the real data path.
      if(!docsDir)continue;
      commit(update.product,docsDir,update.version);
      renameSync(metadata,join(directory,entry.marker.replace('.pending-','.installed-')+'.json'));
    }
    renameSync(join(directory,entry.marker),join(directory,entry.marker.replace('.pending-','.installed-')));
    write('[fs25/install] Verified DLC loaded by the game: '+entry.payloads.join(', ')+'.');verified++;
  }
  return verified;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href) {
  // Started before requesting the session. Previous session logs cannot verify a new install.
  const initial=new Set(readdirSync(process.env.DOCS_DIR).filter(name=>/^log_.*\.txt$/.test(name)));
  const deadline=Date.now()+300000;
  const timer=setInterval(()=>{
    try {
      const names=readdirSync(process.env.DOCS_DIR).filter(name=>/^log_.*\.txt$/.test(name)&&!initial.has(name)).sort();
      if(names.length) {const path=join(process.env.DOCS_DIR,names.at(-1));if(statSync(path).size<32*1024*1024)verifyPendingDLCs(process.env.DLC_DIR,readFileSync(path,'utf8'));}
      if(!pendingDLCs(process.env.DLC_DIR).length){clearInterval(timer);return;}
      if(Date.now()>deadline){console.log('[fs25/install] DLC verification is still pending. Check the game log; no licence verdict is inferred.');clearInterval(timer);}
    }catch{console.log('[fs25/install] DLC verification could not read its status files.');clearInterval(timer);}
  },1000);
  const stop=()=>{clearInterval(timer);process.exit(0);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
