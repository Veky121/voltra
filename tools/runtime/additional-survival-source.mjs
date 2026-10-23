import fs from'node:fs';import crypto from'node:crypto';import{remote}from'./openttd-compat-node.mjs';
const dir='.local/additional-survival/barotrauma',s=JSON.parse(fs.readFileSync(dir+'/private.json'));
const names=['steam-template.py','bundle-debian-python.py','native-config.py','native-console.py','additional-survival-install.py','barotrauma-runtime.py'];
const data=remote(`import json,pathlib,hashlib,subprocess
r=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes/${s.uuid}')
i=json.loads(subprocess.check_output(['docker','inspect','${s.uuid}'],text=True))[0]
names=json.loads(${JSON.stringify(JSON.stringify(names))})
print(json.dumps({'uuid':'${s.uuid}','running':i['State']['Running'],'helpers':{n:hashlib.sha256((r/'.voltra'/n.replace('-','_')).read_bytes()).hexdigest() for n in names},'release':json.loads((r/'.voltra/steam-template-release.json').read_text())}))`);
const matches=Object.fromEntries(names.map(name=>[name,data.helpers[name]===crypto.createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8')+'\n').digest('hex')]));
if(Object.values(matches).some(x=>!x))throw Error('Installed source differs: '+JSON.stringify(matches));
fs.writeFileSync(dir+'/source-proof.json',JSON.stringify({...data,matches},null,2));console.log({source_matches:true,release:data.release});
