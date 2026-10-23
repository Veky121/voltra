import fs from'node:fs';import{api,remote}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/barotrauma',s=JSON.parse(fs.readFileSync(dir+'/private.json'));
if(!/^[a-f0-9-]{36}$/.test(s.uuid))throw Error('Invalid UUID');
const status=(await api('/api/application/servers/'+s.internal_id)).attributes.status;
const data=remote(`import pathlib,json,subprocess
u='${s.uuid}';r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes')/u
i=subprocess.run(['docker','inspect',u],text=True,capture_output=True);info=json.loads(i.stdout)[0] if i.returncode==0 else None
l=subprocess.run(['docker','logs','--tail','80',u],text=True,capture_output=True) if info else None
p=pathlib.Path('/var/lib/voltra-temp-20261022-lan/logs/install')/(u+'.log')
installer=subprocess.run(['docker','logs','--tail','25',u+'_installer'],text=True,capture_output=True)
print(json.dumps({'container':info['State'] if info else None,'logs':(l.stdout+l.stderr) if l else '', 'install_tail':p.read_text(errors='replace')[-1800:] if p.exists() else '', 'installer_live':installer.stdout[-2000:] if installer.returncode==0 else 'not present','binary_exists':(r/'DedicatedServer').exists()}))`);
fs.writeFileSync(dir+'/observation.json',JSON.stringify({status,...data},null,2));console.log({status,container:data.container,native_ready:data.logs.includes('Server started'),opaque_console_output:data.logs.includes('\ufffd'),install_success:data.install_tail.includes('fully installed.'),installer_live:data.installer_live==='not present'?'not present':data.installer_live.slice(-500),binary_exists:data.binary_exists});
