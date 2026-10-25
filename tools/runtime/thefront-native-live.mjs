import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {api} from './openttd-compat-node.mjs';
const d='.local/thefront-native',s=JSON.parse(fs.readFileSync(d+'/private.json')),n=JSON.parse(fs.readFileSync(s.node_receipt)),a=(await api('/api/application/servers/'+s.internal_id)).attributes;
if(a.uuid!==s.uuid||a.node!==n.node||n.node_uuid!==s.node_uuid||a.egg!==s.egg_id||a.external_id!=='thefront-native-'+s.request_id||s.owner!=='unreal_survival')throw Error('Ownedidentity');
const tag=process.argv[2]??'current';if(!/^[a-z0-9_-]+$/.test(tag))throw Error('Tag');const expected=s.intentional_password_clear?'""':s.test_password;
const code=`from pathlib import Path
import json
r=Path('/home/container');secret=${JSON.stringify(s.test_password)};expected=${JSON.stringify(expected)};processes=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  argv=p.read_bytes().decode(errors='replace').split('\\0')[:-1]
  if argv and 'TheFrontServer' in argv[0]:processes.append({'argv':[x.replace(secret,'[OWNED_SECRET]')for x in argv],'server_password_matches_expected':('-ServerPassword='+expected)in argv,'password_is_last':argv[-1]=='-ServerPassword='+expected,'tags_explicit_empty':'-ServerTags=""'in argv,'admins_explicit_empty':'-ServerAdminAccounts=""'in argv,'working_directory':str((p.parent/'cwd').resolve())})
 except FileNotFoundError:pass
saved=r/'TheFrontManager';print(json.dumps({'release':json.loads((r/'.voltra/steam-template-release.json').read_text()),'processes':processes,'native_created_files':[{'name':str(p.relative_to(r)),'bytes':p.stat().st_size}for p in saved.rglob('*')if p.is_file()],'net':{k:Path('/proc/net/'+k).read_text()for k in['udp','udp6','tcp','tcp6']},'cgroup_memory_peak':Path('/sys/fs/cgroup/memory.peak').read_text().strip()if Path('/sys/fs/cgroup/memory.peak').exists()else None}))`;
const c=spawnSync('docker',['exec','-i',s.uuid,'python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8',maxBuffer:5e6});if(c.status)throw Error(c.stderr);const j=JSON.parse(c.stdout);j.resources=(await api('/api/client/servers/'+s.identifier+'/resources')).attributes;const inspected=JSON.parse(spawnSync('docker',['inspect',s.uuid],{windowsHide:true,encoding:'utf8'}).stdout)[0];j.container_memory_limit_bytes=inspected.HostConfig.Memory;j.started_at=inspected.State.StartedAt;fs.writeFileSync(d+'/live-'+tag+'.json',JSON.stringify(j,null,2)+'\n');console.log({processes:j.processes,resources:j.resources,native_files:j.native_created_files.length,cgroup_peak:j.cgroup_memory_peak,configured_memory_limit:j.container_memory_limit_bytes});
