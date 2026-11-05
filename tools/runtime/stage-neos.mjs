import fs from 'node:fs';
const recipe = 'neosvr/egg-neos-v-r.json';
const profile = structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe]);
profile.revision = 'neos-operator-preflight-v3';
profile.egg.startup = 'exec python3 .voltra/neos_runtime.py';
const emitted = {};
for (const source of ['neos-runtime.py','native-console.py','steam-template.py']) {
  emitted[source.replaceAll('-','_')] = fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8');
}
// Validate in memory before touching the server volume. No acquisition or bootstrap.
const install = `import json, os, sys, types
from pathlib import Path
sys.dont_write_bytecode = True
payload = json.loads(${JSON.stringify(JSON.stringify(emitted))})
for name in ('steam_template.py', 'native_console.py', 'neos_runtime.py'):
    module = types.ModuleType(name[:-3])
    sys.modules[name[:-3]] = module
    exec(compile(payload[name], name, 'exec'), module.__dict__)
root = Path.cwd().resolve()
sys.modules['neos_runtime'].plan(root, dict(os.environ))
target = sys.modules['neos_runtime'].path(root, '.voltra')
if target.exists() and not target.is_dir():
    raise ValueError('Invalid runtime directory')
for name in payload:
    dest = sys.modules['neos_runtime'].path(root, '.voltra/' + name)
    if dest.exists() and not dest.is_file():
        raise ValueError('Invalid runtime file')
target.mkdir(exist_ok=True)
for name, content in payload.items():
    (target / name).write_bytes(content.encode('utf-8'))
`;
profile.egg.scripts.installation.script = '#!/bin/bash\nset -euo pipefail\ncd /mnt/server\npython3 -B - <<\'VOLTRA_NEOS\'\n' + install + 'VOLTRA_NEOS\n';
const out = 'artifacts/game-parity-20261029/neos-installer-followup';
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/profile.pending.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(out+'/emitted.pending.json',JSON.stringify(emitted,null,2)+'\n');

