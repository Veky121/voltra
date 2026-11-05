import fs from 'node:fs';
import path from 'node:path';
import {runtime,verifyRuntime,api,activeLease,profileFromRuntime,docker,digest} from './campaign-native-20261029.mjs';
const dir=path.join(runtime,'cubicodyssey-wave5'),s=JSON.parse(fs.readFileSync(path.join(dir,'state.json'))),r=await verifyRuntime();activeLease(s.lease.lease_id,'cubicodyssey_native');const a=(await api('/api/application/servers/'+s.server.id)).attributes;if(a.uuid!==s.server.uuid||a.egg!==s.egg.id)throw Error('Owned fixture required');
const profile=profileFromRuntime(s.recipe,r),script=profile.egg.scripts.installation.script,expected={};for(const m of script.matchAll(/^cat > \.voltra\/([^ ]+) <<'([^']+)'\n/gm)){const start=m.index+m[0].length,end=script.indexOf('\n'+m[2]+'\n',start);if(end<0)throw Error('Helper delimiter');expected[m[1]]=digest(script.slice(start,end)+'\n');}
const code=`from pathlib import Path
import json,hashlib,os
r=Path('/home/container');expected=json.loads(${JSON.stringify(JSON.stringify(expected))});helpers={n:hashlib.sha256((r/'.voltra'/n).read_bytes()).hexdigest() for n in expected};processes=[];ports=[]
for p in Path('/proc').iterdir():
 if not p.name.isdecimal():continue
 try:
  args=(p/'cmdline').read_bytes().split(bytes([0]))
  if any(a.lower().replace(bytes([92]),b'/').endswith(b'cubicodysseyserver.exe') for a in args[:2]):processes.append({'pid':int(p.name),'executable':args[0].decode(errors='replace'),'cwd':os.readlink(p/'cwd')})
 except (OSError,PermissionError):pass
for proto in ('tcp','tcp6','udp','udp6'):
 for line in Path('/proc/net/'+proto).read_text().splitlines()[1:]:
  row=line.split();port=int(row[1].split(':')[1],16)
  if port==${s.lease.ports[0]}:ports.append({'protocol':proto,'port':port,'state':row[3]})
print(json.dumps({'uid':os.geteuid(),'helpers':helpers,'helpers_exact':helpers==expected,'processes':processes,'allocated_port_sockets':ports,'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'memory_current':int(Path('/sys/fs/cgroup/memory.current').read_text()),'memory_peak':int(Path('/sys/fs/cgroup/memory.peak').read_text())}))`;
const result=JSON.parse(docker(['exec',s.server.uuid,'python3','-B','-c',code]));result.at=new Date().toISOString();result.backend_pid=r.pid;fs.writeFileSync(path.join(dir,'native-verify-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(!result.helpers_exact||result.processes.length!==1)throw Error('Helper/native process verification failed');
