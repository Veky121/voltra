import fs from 'node:fs';import {spawnSync} from 'node:child_process';
export function remote(script){const r=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','sudo -n python3 -'],{input:script,encoding:'utf8',timeout:60000});if(r.status)throw Error(r.stderr);return JSON.parse(r.stdout);}
export const directory='.local/openttd-compat';
export const file=directory+'/private.json';
export const api=async(p,method='GET',body)=>{const r=await fetch('http://127.0.0.1:8088'+p,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});const t=await r.text();if(!r.ok)throw Error(p+' HTTP '+r.status);return t?JSON.parse(t):null;};
export const rows=r=>r.data.map(x=>x.attributes);
export function baseline(){return remote(`import json,subprocess,hashlib
print(json.dumps({'wings_pid':subprocess.check_output(['systemctl','show','wings','--property=MainPID','--value'],text=True).strip(),'config_sha256':hashlib.sha256(open('/etc/pterodactyl/config.yml','rb').read()).hexdigest(),'containers':sorted(subprocess.check_output(['docker','ps','--format','{{.ID}}'],text=True).split())}))`);}
if(process.argv[2]==='baseline'){
 const prior=JSON.parse(fs.readFileSync('.local/dst-final/node-baseline.json'));const current=baseline();
 if(current.wings_pid!==prior.wings_pid||current.config_sha256!==prior.config_sha256||JSON.stringify(current.containers)!==JSON.stringify([...prior.containers].sort()))throw Error('Remote baseline drift before mutation');
 if(fs.existsSync(directory+'/node-baseline.json'))throw Error('Baseline already captured; do not overwrite');
 fs.writeFileSync(directory+'/node-baseline.json',JSON.stringify(current,null,2));console.log({baseline_preserved:true,containers:current.containers.length});
}
