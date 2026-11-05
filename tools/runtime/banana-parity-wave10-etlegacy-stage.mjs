import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe='wolfenstein_enemy_territory/etlegacy/egg-e-t-legacy.json';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const profile=structuredClone(current),before=JSON.stringify(current.egg.variables);
const canonical='internal/panel/game_library/scripts/etlegacy-authority.py';
const candidate='tools/runtime/banana-parity-wave10-etlegacy-authority.py';
const helper=fs.existsSync(canonical)?canonical:candidate;
const sources=[['native_config.py','internal/panel/game_library/scripts/native-config.py'],['etlegacy_authority.py',helper]];
const tail='python3 .voltra/etlegacy_install.py\n',script=profile.egg.scripts.installation.script;
if(!script.endsWith(tail)||script.split(tail).length!==2)throw Error('Unique terminal publisher installer required');
if(script.includes('cat > .voltra/etlegacy_authority.py'))throw Error('Already-integrated wrapper; review current baseline');
const embeds=sources.map(([target,file])=>`cat > .voltra/${target} <<'VOLTRA_ETLEGACY_WAVE10'\n${fs.readFileSync(file,'utf8')}\nVOLTRA_ETLEGACY_WAVE10\n`).join('');
profile.egg.scripts.installation.script=script.slice(0,-tail.length)+embeds+tail;
const old='.voltra/quake_family_runtime.py etlegacy';
if(!profile.egg.startup.endsWith(old))throw Error('Unexpected startup authority');
profile.egg.startup=profile.egg.startup.slice(0,-old.length)+'.voltra/etlegacy_authority.py';
profile.settings_documents=[...new Set([...(profile.settings_documents||[]),'etlegacy/userdata/legacy/voltra-native.cfg'])];
profile.revision='etlegacy-native-authority-wave10';
profile.setup_steps=[...profile.setup_steps,
 'Server name, player limits and passwords seed etlegacy/userdata/legacy/voltra-native.cfg once. Later native edits remain authoritative; map, architecture, Omni-Bot, public listing and allocated listeners remain runtime controls.',
 'The typed editor supports reviewed scalar settings. Unknown native commands and operator files remain preserved. Advanced commands can make the document read-only; edit such files through the existing file workspace.',
];
if(JSON.stringify(profile.egg.variables)!==before||JSON.stringify(profile.defaults)!==JSON.stringify(current.defaults))throw Error('Controls/defaults changed');
const output='artifacts/game-parity-20261029/banana-wave10-etlegacy-profile.json';
fs.writeFileSync(output,JSON.stringify({[recipe]:profile},null,2)+'\n');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
console.log(JSON.stringify({output,sha256:sha(fs.readFileSync(output)),helper,helper_sha256:sha(fs.readFileSync(helper)),preserved_controls:profile.egg.variables.length,defaults:profile.defaults,canonical_modified:false}));
