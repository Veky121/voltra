// Read-only checks of the local GIANTS portal. No game start/stop requests.
import http from 'node:http';
import {mkdirSync,writeFileSync,renameSync,readdirSync,readFileSync,openSync,fstatSync,readSync,closeSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function sessionState(html) {
  const inputs=[...html.matchAll(/<input\b[^>]*>/gi)].map(([tag])=>/\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]);
  const start=inputs.includes('start_server'),stop=inputs.includes('stop_server');
  return start&&!stop?'offline':stop&&!start?'online':'unknown';
}
export function requestPortal(env,method='GET',body='',cookie='') {
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:env.WEB_HOST||'127.0.0.1',port:env.WEB_PORT||7999,path:'/index.html?lang=en',method,agent:false,headers:{'Content-Type':'application/x-www-form-urlencoded',...(body?{'Content-Length':Buffer.byteLength(body)}:{}),...(cookie?{Cookie:cookie}:{})}},res=>{
      let text='';
      res.on('data',chunk=>{text+=chunk;if(Buffer.byteLength(text)>2*1024*1024)req.destroy(Error('Response too large'));});
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:text}));
    });
    req.setTimeout(3000,()=>req.destroy(Error('Portal timeout')));
    req.on('error',reject);req.end(body);
  });
}
export async function checkHealth(env=process.env,request=requestPortal) {
  const result={portal:'unknown',game:'unknown'};
  try {
    const page=await request(env);
    if(page.status!==200)return result;
    // An HTTP response alone does not identify a healthy GIANTS portal.
    if(!/<input\b[^>]*name\s*=\s*["']username["']/i.test(page.body))return result;
    result.portal='online';
    const login=await request(env,'POST',new URLSearchParams({username:env.WEB_USERNAME||'admin',password:env.WEB_PASSWORD||'changeme',login:'Login'}).toString());
    const cookie=(login.headers['set-cookie']||[]).map(value=>/^(SessionID=[^;]+)/i.exec(value)?.[1]).find(Boolean);
    if(!cookie)return result;
    const session=await request(env,'GET','',cookie);
    if(session.status===200)result.game=sessionState(session.body);
  } catch { /* Transport and authentication failures leave unproved states unknown. */ }
  return result;
}
async function watch() {
  const file=resolve(process.env.FS25_LIB,'../health.json');
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  while(true) {
    const health=checkLogHealth();
    const state={...health,checked_at:Date.now(),started_at:Number(process.env.FS25_START_TIME_MS)};
    writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});renameSync(file+'.tmp',file);
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}

// Lifecycle evidence comes from the server log, never recurring portal requests.
export function logGameState(log) {
  let result={state:'unknown',at:0};
  for(const line of log.split('\n')) {
    const match=/^\[(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\]\s+(Game server started|Game server process started|Game server process stopped|Game server stopped)\s*$/.exec(line.trim());
    if(!match)continue;
    const month=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(match[2]);
    if(month<0)continue;
    const at=Date.UTC(+match[3],month,+match[1],+match[4],+match[5],+match[6]);
    result={state:match[7]==='Game server started'?'online':match[7].includes('stopped')?'offline':'unknown',at};
  }
  return result;
}
export function reconcileGameState(marker,processStartedAt) {
  if(processStartedAt===null)return 'offline';
  if(!Number.isFinite(processStartedAt)||marker.at<processStartedAt-10000||marker.at>Date.now()+10000)return 'unknown';
  return marker.state==='online'?'online':'unknown';
}
let ticks;
export function checkLogHealth(env=process.env) {
  const result={portal:'unknown',game:'unknown'};
  try {
    ticks??=Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim());
    if(!Number.isFinite(ticks)||ticks<=0)return result;
    const boot=Date.now()-Number(readFileSync('/proc/uptime','utf8').split(' ')[0])*1000;
    let portal=false,gameStarted=null;
    for(const pid of readdirSync('/proc').filter(name=>/^\d+$/.test(name))) {
      try {
        const comm=readFileSync(`/proc/${pid}/comm`,'utf8').trim();
        if(comm==='dedicatedServer')portal=true;
        if(comm==='FarmingSimulato') {
          const stat=readFileSync(`/proc/${pid}/stat`,'utf8');
          const fields=stat.slice(stat.lastIndexOf(')')+2).split(' ');
          gameStarted=Math.max(gameStarted??0,boot+Number(fields[19])/ticks*1000);
        }
      } catch(error) {if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}
    }
    const port=Number(env.WEB_PORT||7999);
    const listening=readFileSync('/proc/net/tcp','utf8').split('\n').some(line=>{
      const fields=line.trim().split(/\s+/);return fields[3]==='0A'&&parseInt(fields[1]?.split(':')[1],16)===port;
    });
    result.portal=portal&&listening?'online':!portal?'offline':'unknown';
    if(gameStarted===null){result.game='offline';return result;}
    const directory=resolve(env.DEDI_DIR||'/home/container/data/dedicated_server','logs');
    const name=readdirSync(directory).filter(name=>/^server_.*\.log$/.test(name)).sort().at(-1);
    if(!name)return result;
    const fd=openSync(resolve(directory,name),'r');
    try {
      const size=fstatSync(fd).size,offset=Math.max(0,size-256*1024),buffer=Buffer.alloc(size-offset);
      readSync(fd,buffer,0,buffer.length,offset);
      let log=buffer.toString('utf8');if(offset)log=log.slice(log.indexOf('\n')+1);
      result.game=reconcileGameState(logGameState(log),gameStarted);
    } finally {closeSync(fd);}
  } catch { /* Missing process/log evidence remains unknown. */ }
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)watch().catch(()=>process.exitCode=1);
