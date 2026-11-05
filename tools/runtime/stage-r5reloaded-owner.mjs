import fs from 'node:fs';
import crypto from 'node:crypto';
const dir='artifacts/game-parity-20261029/r5reloaded-owner';
const recipe='r5reloaded/egg-r5-reloaded.json';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const overrides=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const original=catalog.entries.find(e=>e.path===recipe);
// Rebase on the integrated exact variant whenever available. Never import a
// stale private-stage snapshot over root's integration changes.
const base=overrides[recipe];
if(!base?.egg) throw Error('Integrated R5 profile missing; root must supply its exact profile before staging');
if(base.egg.scripts.installation.container!=='debian:bookworm-slim' || base.egg.scripts.installation.entrypoint!=='bash')
 throw Error('R5 bootstrap requires the reviewed Debian Bookworm/Bash installer');
const profile=structuredClone(base);
const files={};
for(const name of ['arena-native.py','melee-native.py','native-config.py','native-console.py','steam-template.py','source-install.py','bundle-debian-python.py'])
 files[name==='steam-template.py'?'steam_template.py':name]=fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8');
files['r5reloaded-owner.py']=fs.readFileSync('tools/runtime/r5reloaded-owner.py','utf8');
const emit=Object.entries(files).map(([name,body])=>`cat > .voltra/${name} <<'VOLTRA_R5_SOURCE'\n${body}\nVOLTRA_R5_SOURCE\n`).join('');
profile.egg.scripts.installation.script='#!/bin/bash\nset -euo pipefail\ncd /mnt/server\n# Existing operator payload only. No acquisition or uploaded binary execution.\nexport DEBIAN_FRONTEND=noninteractive\n# Tooling bootstrap can mutate the installer system before game validation.\nif ! command -v python3 >/dev/null 2>&1; then\n  apt-get update\n  apt-get install -y --no-install-recommends python3 ca-certificates\nfi\ncommand -v python3 >/dev/null\npython3 - <<\'VOLTRA_R5_PREFLIGHT\'\n'+
 Object.entries(files).map(([name,body])=>`# ${name}\n`).join('')+
 // Preflight from a temporary module directory before touching the server.
 'import tempfile, pathlib, subprocess, sys, os, json\nwith tempfile.TemporaryDirectory(prefix="voltra-r5-preflight-") as d:\n    files=json.loads('+JSON.stringify(JSON.stringify(files))+')\n    for name,body in files.items(): pathlib.Path(d,name).write_text(body,encoding="utf-8")\n    subprocess.run([sys.executable,"-B",str(pathlib.Path(d,"r5reloaded-owner.py")),"install"],check=True)\nVOLTRA_R5_PREFLIGHT\nmkdir -p .voltra\n'+emit+'python3 .voltra/bundle-debian-python.py\npython3 -B .voltra/r5reloaded-owner.py install\n';
profile.egg.startup='exec env PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 -B .voltra/r5reloaded-owner.py run';
for(const v of original.egg.variables) {
 const actual=profile.egg.variables.find(x=>x.env_variable===v.env_variable);
 if(JSON.stringify(actual)!==JSON.stringify(v)) throw Error('Canonical variable changed: '+v.env_variable);
}
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(dir+'/emitted-modules.json',JSON.stringify(files,null,2)+'\n');
fs.writeFileSync(dir+'/source-hashes.json',JSON.stringify(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,crypto.createHash('sha256').update(v).digest('hex')])),null,2)+'\n');
console.log('Staged R5-only install/start integration proposal; no canonical mutation.');
