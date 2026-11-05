import fs from 'node:fs';
const recipe='squad/egg-squad.json',dir='artifacts/game-parity-20261029/squad-owner';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profile=structuredClone(canonical[recipe]);
const body=fs.readFileSync('internal/panel/game_library/scripts/squad-owner.py','utf8');
profile.egg.scripts.installation.container='python:3.11-slim-bookworm';
const needle='python3 .voltra/bundle_debian_python.py';
let script=profile.egg.scripts.installation.script;
if(script.split(needle).length!==2 || !script.includes('install(Path.cwd(),dict(os.environ))'))throw Error('Unexpected installer');
script=script.replace(needle,`cat > .voltra/squad_owner.py <<'VOLTRA_SQUAD_OWNER'\n${body}\nVOLTRA_SQUAD_OWNER\npython3 .voltra/squad_owner_preflight.py\n${needle}`);
// Preflight runs before apt, mkdir or helper emission. Extracted bootstrap uses
// in-memory compilation of reviewed modules, avoiding writes on invalid inputs.
const modules={};
for(const name of ['steam-template','source-install','source-next-install','native-console','tactical-install','tactical-runtime','squad-owner'])modules[name.replaceAll('-','_')]=fs.readFileSync('internal/panel/game_library/scripts/'+name+'.py','utf8');
const bootstrap=`import sys,types,os\nfrom pathlib import Path\nsources=${JSON.stringify(JSON.stringify(modules))}\nimport json\nfor name,source in json.loads(sources).items():\n m=types.ModuleType(name); m.__file__=str(Path.cwd()/'.voltra'/ (name+'.py')); sys.modules[name]=m; exec(compile(source,m.__file__,'exec'),m.__dict__)\nsys.modules['squad_owner'].plan(Path.cwd(),dict(os.environ))\n`;
// System Python is required by installer container; no apt needed to validate.
script=script.replace('export DEBIAN_FRONTEND=noninteractive',`cd /mnt/server\npython3 - <<'VOLTRA_SQUAD_PREFLIGHT'\n${bootstrap}\nVOLTRA_SQUAD_PREFLIGHT\nexport DEBIAN_FRONTEND=noninteractive`);
script=script.replace('python3 .voltra/squad_owner_preflight.py\n','');
script=script.replace('from tactical_install import install','from squad_owner import acquire as install');
profile.egg.scripts.installation.script=script;
profile.egg.startup=profile.egg.startup.replace('tactical_runtime.py','squad_owner.py');
profile.revision='squad-owner-source-v1';
profile.detail='Source-only seed-once native configuration and prerequisite validation. Native readiness/listeners/stop remain unverified.';
profile.setup_steps.push('Existing Server.cfg keys have authority. Startup controls only seed absent keys. Publisher licensing is separate from installation; no license or consent is generated. Installer image must supply Python before preflight.');
if(JSON.stringify(profile.egg.variables)!==JSON.stringify(canonical[recipe].egg.variables))throw Error('Canonical controls changed');
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/profile-fragment.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log('Staged Squad only; canonical controls unchanged.');


