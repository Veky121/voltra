// Installs a local native persistence fixture on a stopped, owned test server.
// Usage: node tools/runtime/install-dst-fixture.mjs receipt.json
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const receipt=JSON.parse(fs.readFileSync(process.argv[2]));
const response=await fetch('http://127.0.0.1:8088/api/application/servers/'+receipt.internal_id);
if(!response.ok)throw Error('Owned server unavailable');const server=(await response.json()).attributes;
if(server.uuid!==receipt.uuid||server.node!==147||!/^[a-f0-9-]{36}$/.test(receipt.uuid))throw Error('Owned node/UUID mismatch');
const files=Object.fromEntries(['modinfo.lua','modmain.lua','scripts/components/voltraacceptance.lua'].map(name=>['mods/VoltraAcceptance/'+name,fs.readFileSync('tools/runtime/fixtures/dst-local-mod/'+name,'utf8')]));
for(const shard of ['Master','Caves'])files['DoNotStarveTogether/config/server/'+shard+'/modoverrides.lua']='return { ["VoltraAcceptance"] = { enabled = true } }\n';
const script=`import pathlib,subprocess,json,os
uuid='${receipt.uuid}';info=json.loads(subprocess.check_output(['docker','inspect',uuid],text=True))[0]
assert not info['State']['Running']
root=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes')/uuid
metadata=root.stat();files=json.loads(${JSON.stringify(JSON.stringify(files))})
for name,content in files.items():
 target=root/name
 assert target.resolve().is_relative_to(root.resolve())
 assert not target.exists() or target.read_text()==content, 'Unknown operator fixture target exists'
for name,content in files.items():
 target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text(content);target.chmod(0o644);os.chown(target,metadata.st_uid,metadata.st_gid)
setup=root/'mods/dedicated_server_mods_setup.lua'
assert setup.is_file() and setup.resolve().is_relative_to(root.resolve())
content=setup.read_text();marker='-- VOLTRA_OPERATOR_PRESERVE_517077'
if marker not in content:setup.write_text(content+'\\n'+marker+'\\n')
print(json.dumps({'local_mod_installed':True,'shards':['Master','Caves'],'operator_mod_setup_marker_present':marker in setup.read_text()}))
`;
const result=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','sudo -n python3 -'],{input:script,encoding:'utf8'});if(result.status)throw Error(result.stderr);console.log(result.stdout);
