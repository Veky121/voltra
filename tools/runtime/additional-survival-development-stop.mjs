import fs from'node:fs';import{remote}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/barotrauma',s=JSON.parse(fs.readFileSync(dir+'/private.json'));
const marker=dir+'/development-stop.json';if(fs.existsSync(marker))throw Error('Already sent native SIGTERM; observe');
fs.writeFileSync(marker,JSON.stringify({uuid:s.uuid,native_quit_timeout:true,requested_at:new Date().toISOString()}));
const result=remote(`import json,subprocess,os,signal
u='${s.uuid}'
i=json.loads(subprocess.check_output(['docker','inspect',u],text=True))[0]
assert i['State']['Running'] and any(m['Source']=='/var/lib/voltra-temp-20261022-lan/volumes/'+u for m in i['Mounts'])
rows=subprocess.check_output(['docker','top',u,'-eo','pid,comm'],text=True).splitlines()[1:]
targets=[int(r.split()[0]) for r in rows if r.split()[1]=='DedicatedServer']
assert len(targets)==1
assert os.readlink('/proc/'+str(targets[0])+'/exe').endswith('/DedicatedServer')
os.kill(targets[0],signal.SIGTERM)
print(json.dumps({'owned_native_sigterm_sent':True}))`);console.log(result);
