// Exercise only the designated local Mindustry server through the real panel.
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'../..');
const credential=JSON.parse(await readFile(resolve(root,'.local/dev/tooling-key.json'),'utf8'));
const seed=JSON.parse(await readFile(resolve(root,'.local/dev/seed.json'),'utf8'));
if(seed.version!=='voltra.local-dev.v1')throw new Error('Missing local workspace marker');
const server=seed.servers.find(s=>s.external_id==='local-dev:mindustry/egg-mindustry.json');
if(!server)throw new Error('Missing local Mindustry server');
const base='http://127.0.0.1:18089';
async function api(path,body){
 const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${credential.token}`},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
 const text=await response.text();let data;try{data=JSON.parse(text)}catch{data=text}
 if(!response.ok)throw new Error(`Local API ${path}: ${response.status} ${JSON.stringify(data)}`);
 return data;
}
const action=process.argv[2]??'status';
if(!['status','install','start','stop','backup','command'].includes(action))throw new Error('Use status, install, start, stop, backup or command');
const prefix=`/api/client/servers/${server.uuid}`;
const result={at:new Date().toISOString(),action,server:server.uuid};
{
 if(action==='install')result.response=await api(prefix+'/settings/reinstall',{});
 if(action==='start'||action==='stop')result.response=await api(prefix+'/power',{signal:action});
 if(action==='backup')result.response=await api(prefix+'/backups',{name:'Local Mindustry verified files',ignored:'',is_locked:false});
 if(action==='command'){
  const command=process.argv[3];if(!['status','help','save local-dev'].includes(command))throw new Error('Only status, help or save local-dev commands are supported');
  result.response=await api(prefix+'/command',{command});
 }
 if(action==='status'){
  result.details=await api(prefix);
  for(const [name,path]of [['resources','/resources'],['files','/files/list?directory=%2F'],['backups','/backups'],['console','/console-history?limit=500']]){
   try{result[name]=await api(prefix+path)}catch(error){result[name]={error:String(error.message)}}
  }
 }
 const directory=resolve(root,'.local/dev/evidence');await mkdir(directory,{recursive:true});
 const file=resolve(directory,`${result.at.replace(/[:.]/g,'-')}-mindustry-${action}.json`);
 await writeFile(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({action,evidence:file,...(result.resources?{resources:result.resources}:{}),...(result.response?.attributes?{response:result.response.attributes}:{})}));
}
