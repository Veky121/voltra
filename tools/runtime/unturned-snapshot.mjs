// Records hashes, never contents, of the owned Unturned identity and helpers.
// Usage: node tools/runtime/unturned-snapshot.mjs receipt.json output.json
import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const [receiptPath,outputPath]=process.argv.slice(2),receipt=JSON.parse(fs.readFileSync(receiptPath));
if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(receipt.uuid))throw Error('Invalid owned UUID');
const script=`import pathlib,subprocess,json,hashlib,os
uuid='${receipt.uuid}'
root=pathlib.Path('/var/lib/voltra-temp-20261022-lan/volumes')/uuid
info=json.loads(subprocess.check_output(['docker','inspect',uuid],text=True))[0]
assert not info['State']['Running'], 'Snapshot requires stopped native engine'
names=['.voltra/steam_template.py','.voltra/native_console.py','.voltra/unturned_runtime.py','.voltra/bundle_debian_python.py','.voltra/unturned-entry.sh']
names += [str(p.relative_to(root)) for p in (root/'Servers').rglob('*') if p.is_file() and not any(part.lower()=='logs' for part in p.relative_to(root/'Servers').parts)]
files={}
for name in sorted(set(names)):
 path=root/name
 assert path.resolve().is_relative_to(root.resolve()), 'Persistent file leaves owned volume'
 digest=hashlib.sha256()
 with path.open('rb') as source:
  for block in iter(lambda:source.read(1048576),b''):digest.update(block)
 files[name]={'sha256':digest.hexdigest(),'bytes':path.stat().st_size,'mode':oct(path.stat().st_mode&511)}
plugin=root/'Unturned_Headless_Data/Plugins/x86_64/steamclient.so'
print(json.dumps({'uuid':uuid,'exit_code':info['State']['ExitCode'],'oom_killed':info['State']['OOMKilled'],'files':files,'sdk_link_valid':plugin.is_file(),'sdk_link':os.readlink(plugin) if plugin.is_symlink() else None,'release':json.loads((root/'.voltra/steam-template-release.json').read_text())}))
`;
const result=spawnSync('ssh',['-o','BatchMode=yes','home-server-ai','sudo -n python3 -'],{input:script,encoding:'utf8'});
if(result.status)throw Error(result.stderr);const snapshot=JSON.parse(result.stdout);snapshot.observed_at=new Date().toISOString();
fs.writeFileSync(outputPath,JSON.stringify(snapshot,null,2)+'\n');console.log({exit_code:snapshot.exit_code,files:Object.keys(snapshot.files).length,sdk_link_valid:snapshot.sdk_link_valid,release:snapshot.release});
