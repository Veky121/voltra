import {readdirSync,openSync,readSync,fstatSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export function formatLogSourceLine(line,color=true) {
  if(!color) return line;
  const colors={Game:32,Server:36,WebPanel:35,Wine:90};
  return line.replace(/^\[(Game|Server|WebPanel|Wine)\]/,(_,source)=>`\x1b[${colors[source]}m[${source}]\x1b[0m`);
}

export function logRedactor(environment) {
  const secrets=new Set();
  const fields=Object.entries(environment);
  try {const entries=JSON.parse(environment.DLC_PRODUCT_KEY||'null');if(Array.isArray(entries))for(const entry of entries)if(typeof entry?.key==='string')fields.push(['DLC_PRODUCT_KEY',entry.key]);}catch{}
  for(const [name,value] of fields) {
    if(!/(?:SERIAL|PASSWORD|PRODUCT_KEY|TOKEN|SECRET)/i.test(name) || !value) continue;
    secrets.add(value);secrets.add(encodeURIComponent(value));
    secrets.add(value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])));
    if(/SERIAL|PRODUCT_KEY/i.test(name)) secrets.add(value.replace(/[\s-]/g,''));
  }
  const values=[...secrets].filter(Boolean).sort((a,b)=>b.length-a.length);
  return line=>{
    for(const value of values) line=line.split(value).join('[redacted]');
    line=line.replace(/(authorization\s*[:=]\s*)(?:Bearer|Basic)\s+\S+/gi,'$1[redacted]');
    return line.replace(/((?:password|passphrase|activationKey|productKey|token|authorization)\s*[=:]\s*)[^\s&<>]+/gi,'$1[redacted]');
  };
}

// Complete, masked lines only. Follow new sessions and late-created log files.
export function createLogFollower({docsDir,dediDir,environment={},write=line=>console.log(formatLogSourceLine(line,!Object.hasOwn(process.env,'NO_COLOR'))),fromEnd=false,historyBytes=0,now=Date.now}) {
  const redact=logRedactor(environment),maximumLine=64*1024,chunkSize=256*1024;
  const startedAt=Number(environment.FS25_START_TIME_MS);
  let announcedReady=false;
  const streams=[
    {label:'Game',directory:docsDir,pattern:/^log(?:_.*)?\.txt$/},
    {label:'Server',directory:join(dediDir,'logs'),pattern:/^server_.*\.log$/},
    {label:'WebPanel',directory:join(dediDir,'logs'),pattern:/^webserver_.*\.log$/},
    {label:'Wine',directory:dediDir,pattern:/^dedicatedServer\.log$/},
  ].map(s=>({...s,path:null,identity:null,offset:0,pending:'',discarding:false,first:true,decoder:new TextDecoder()}));
  function latest(s) {
    try {const names=readdirSync(s.directory).filter(n=>s.pattern.test(n)).sort();return names.length?join(s.directory,names.at(-1)):null;} catch {return null;}
  }
  function emit(s,text,historical=false) {
    const parts=text.split('\n');
    for(let i=0;i<parts.length;i++) {
      if(!s.discarding) {
        s.pending+=parts[i];
        if(s.pending.length>maximumLine) {s.pending='';s.discarding=true;write(`[${s.label}] [Oversized log line omitted]`);}
      }
      if(i<parts.length-1) {
        if(!s.discarding) {
          const line=s.pending.replace(/\r$/,'');
          write(`[${s.label}] ${redact(line)}`);
          if(!historical && !announcedReady && s.label==='Server' && /^\[\d{2}\/[A-Za-z]{3}\/\d{4}:\d{2}:\d{2}:\d{2}\]\s+Game server started\s*$/.test(line)) {
            announcedReady=true;
            const elapsed=now()-startedAt;
            const duration=Number.isFinite(startedAt)&&startedAt>0&&elapsed>=0?` in ${(elapsed/1000).toFixed(1)}s`:'';
            write(`[Voltra]: Server marked as started${duration}.`);
          }
        }
        s.pending='';s.discarding=false;
      }
    }
  }
  function read(s,path,skipExisting=false) {
    let fd;
    try {
      fd=openSync(path,'r');const stat=fstatSync(fd);if(!stat.isFile()) return false;
      const identity=String(stat.dev)+':'+String(stat.ino);
      if(s.path!==path || s.identity!==identity || stat.size<s.offset) {
        s.path=path;s.identity=identity;s.offset=skipExisting?Math.max(0,stat.size-historyBytes):0;
        s.pending='';s.discarding=false;s.decoder=new TextDecoder();
        if(skipExisting && s.offset>0) {
          const last=Buffer.alloc(1);readSync(fd,last,0,1,s.offset-1);
          s.discarding=last[0]!==10;
        }
      }
      const count=Math.min(chunkSize,stat.size-s.offset);
      if(count>0) {
        const buffer=Buffer.allocUnsafe(count),bytes=readSync(fd,buffer,0,count,s.offset);
        s.offset+=bytes;emit(s,s.decoder.decode(buffer.subarray(0,bytes),{stream:true}),skipExisting);
      }
      return s.offset<stat.size;
    } catch {return false;} finally {if(fd!==undefined) closeSync(fd);}
  }
  return {poll() {
    for(const s of streams) {
      const path=latest(s);if(!path) {s.first=false;continue;}
      if(s.path && s.path!==path && read(s,s.path)) continue;
      read(s,path,s.first && fromEnd);s.first=false;
    }
  }};
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const recent=process.argv.includes('--recent');
  const follower=createLogFollower({docsDir:process.env.DOCS_DIR,dediDir:process.env.DEDI_DIR,environment:process.env,fromEnd:recent||process.argv.includes('--from-now'),historyBytes:recent?64*1024:0});
  follower.poll();const timer=setInterval(()=>follower.poll(),1000);
  const stop=()=>{clearInterval(timer);process.exit(0);};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
