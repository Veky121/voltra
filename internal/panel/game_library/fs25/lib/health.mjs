// Read-only checks of the local GIANTS portal. No game start/stop requests.
import http from 'node:http';
import {mkdirSync,writeFileSync,renameSync} from 'node:fs';
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
    const health=await checkHealth();
    const state={...health,checked_at:Date.now(),started_at:Number(process.env.FS25_START_TIME_MS)};
    writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});renameSync(file+'.tmp',file);
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)watch().catch(()=>process.exitCode=1);
