import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='path_of_titans/egg-path-of-titans.json';
const dir='artifacts/game-parity-20261029/pot-owner';
fs.mkdirSync(dir,{recursive:true});
const overrides=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const profile=structuredClone(overrides[recipe]);
if(!profile)throw Error('Existing canonical PoT profile absent');
const sources={};
let script=profile.egg.scripts.installation.script;
// Refresh every existing embedded helper from current source, without editing shared files.
script=script.replace(/cat > \.voltra\/([^ ]+) <<'VOLTRA_SOURCE'\n[\s\S]*?\nVOLTRA_SOURCE\n/g,(block,name)=>{
 const path='internal/panel/game_library/scripts/'+name.replaceAll('_','-');
 const bytes=fs.readFileSync(path);sources[path]=crypto.createHash('sha256').update(bytes).digest('hex');
 return `cat > .voltra/${name} <<'VOLTRA_SOURCE'\n${bytes.toString('utf8')}\nVOLTRA_SOURCE\n`;
});
const path='internal/panel/game_library/scripts/pot-runtime.py';
const source=fs.readFileSync(path,'utf8').replace(/^\uFEFF/,'');
sources[path]=crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const embedded=`cat > .voltra/pot_runtime.py <<'VOLTRA_SOURCE'\n${source}\nVOLTRA_SOURCE\n`;
// Preflight the environment BEFORE apt, mkdir, helper publication or utility download.
const gate=`python3 - <<'POT_PREFLIGHT'\nimport sys, types, os\nfrom pathlib import Path\n`;
let load='';
const order=['steam-template.py','native-config.py','native-console.py','source-install.py','source-next-install.py','tactical-install.py','tactical-runtime.py','publisher-install.py','publisher-runtime.py','pot-runtime.py'];
for(const file of order){const filePath='internal/panel/game_library/scripts/'+file;const code=fs.readFileSync(filePath,'utf8').replace(/^\uFEFF/,'');sources[filePath]=crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');load+=`m=types.ModuleType(${JSON.stringify(file.replaceAll('-','_').replace('.py',''))}); sys.modules[m.__name__]=m; exec(${JSON.stringify(code)},m.__dict__)\n`;}
script=script.replace('apt-get update',`test "\${POT_HOSTING_AGREEMENT:-0}" = 1 || { echo 'PoT hosting agreement acceptance required' >&2; exit 1; }\ncase "\${AG_AUTH_TOKEN:-}" in ''|changeme|token|your_auth_token_here|-*|*[!A-Za-z0-9._~+/=-]*) echo 'Configure a private entitled PoT token' >&2; exit 1;; esac\napt-get update`);
script=script.replace('mkdir -p .voltra',gate+load+`sys.modules['pot_runtime'].preflight(Path('/mnt/server'), dict(os.environ))\nPOT_PREFLIGHT\nmkdir -p .voltra`);
script=script.replace('python3 .voltra/bundle_debian_python.py',embedded+'python3 .voltra/bundle_debian_python.py');
script=script.replace('from publisher_install import install','from pot_runtime import install');
profile.egg.scripts.installation.script=script;
profile.egg.startup=profile.egg.startup.replace('publisher_runtime.py','pot_runtime.py');
profile.revision='pot-owner-preflight-v1';
profile.egg.variables.push({name:'Accept Alderon server hosting agreement',description:'Operator must review https://alderongames.com/legal/server-hosting-agreement. Commercial providers require appropriate publisher permission. No acceptance is assumed.',env_variable:'POT_HOSTING_AGREEMENT',default_value:'0',user_viewable:true,user_editable:true,rules:'required|boolean',field_type:'text'});
profile.setup_steps.push('PoT-only prerequisite gate runs before installer packages, downloader acquisition and startup updates. Explicit hosting-agreement acceptance and a privately supplied entitled token are required. Token syntax checks do not prove publisher authorization. Native acceptance remains blocked.');
fs.writeFileSync(dir+'/profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync(dir+'/source-hashes.json',JSON.stringify(sources,null,2)+'\n');
console.log(JSON.stringify({recipe,helpers:Object.keys(sources).length,output:dir+'/profile.json'}));
