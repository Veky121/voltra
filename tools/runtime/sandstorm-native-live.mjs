import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {api} from './openttd-compat-node.mjs';
const d='.local/sandstorm-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),tag=process.argv[2];
if(!/^[a-z0-9_-]+$/.test(tag??''))throw Error('Tag');const a=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(a.uuid!==s.uuid||a.egg!==s.egg_id||a.external_id!=='sandstorm-native-'+s.request_id)throw Error('Identity');
const code=`from pathlib import Path
import json,os
r=Path('/home/container');processes=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  argv=p.read_bytes().decode(errors='replace').split('\\0')[:-1]
  if argv and 'InsurgencyServer-Linux-Shipping'in argv[0]:processes.append({'argv':argv,'pid':int(p.parent.name),'cwd':str((p.parent/'cwd').resolve())})
 except FileNotFoundError:pass
files=[]
for n in ['Insurgency/Saved','Insurgency/Config/Server','.config','.local/share','mods']:
 p=r/n
 if p.is_dir():
  for q in p.rglob('*'):
   if q.is_file()and not q.is_symlink():files.append({'name':str(q.relative_to(r)),'bytes':q.stat().st_size})
print(json.dumps({'processes':processes,'files':files,'net':{n:Path('/proc/net/'+n).read_text()for n in ['udp','udp6','tcp','tcp6']},'cgroup_memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text().strip()}))`;
const r=spawnSync('docker',['exec','--env','PYTHONHOME=/home/container/.voltra/python','--env','LD_LIBRARY_PATH=/home/container/.voltra/python/lib',s.uuid,'/home/container/.voltra/python/bin/python3','-B','-c',code],{windowsHide:true,encoding:'utf8',maxBuffer:8e6});if(r.status)throw Error(r.stderr);const j=JSON.parse(r.stdout);j.resources=(await api('/api/client/servers/'+s.identifier+'/resources')).attributes;fs.writeFileSync(d+'/live-'+tag+'.json',JSON.stringify(j,null,2)+'\n');console.log({processes:j.processes,files:j.files.length,resources:j.resources,peak:j.cgroup_memory_peak});
