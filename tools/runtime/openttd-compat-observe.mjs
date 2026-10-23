import fs from 'node:fs';import{api,remote,file,directory}from './openttd-compat-node.mjs';
const s=JSON.parse(fs.readFileSync(file));if(!/^[a-f0-9-]{36}$/.test(s.uuid))throw Error('UUID invalid');
const status=(await api('/api/application/servers/'+s.internal_id)).attributes.status;
const evidence=remote(`import json,subprocess,pathlib
u='${s.uuid}';root=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes')/u
r=subprocess.run(['docker','inspect',u],text=True,capture_output=True);info=json.loads(r.stdout)[0] if r.returncode==0 else None
log=subprocess.run(['docker','logs','--tail','100',u],text=True,capture_output=True) if info else None
install=pathlib.Path('/var/lib/voltra-temp-20261022-lan/logs/install')/(u+'.log')
print(json.dumps({'container':info['State'] if info else None,'logs':(log.stdout+log.stderr) if log else '', 'install_tail':install.read_text(errors='replace')[-3500:] if install.exists() else '', 'config':(root/'openttd.cfg').read_text() if (root/'openttd.cfg').exists() else '', 'launcher':(root/'.voltra/openttd-start.sh').exists()}))`);
fs.writeFileSync(directory+'/observation.json',JSON.stringify({status,...evidence},null,2));console.log({status,container:evidence.container,logs:evidence.logs.slice(-3500),install_success:evidence.install_tail.includes('installed with verified checksums.'),launcher:evidence.launcher});
