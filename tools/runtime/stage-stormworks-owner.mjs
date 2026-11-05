import fs from 'node:fs';
const recipe='stormworks/egg-stormworks--build-and-rescue.json';
const dir='artifacts/game-parity-20261029/stormworks-owner';
const current=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
if(!current)throw Error('Missing reviewed Stormworks profile');
const profile=structuredClone(current);
const source=fs.readFileSync('internal/panel/game_library/scripts/stormworks-owner.py','utf8').replaceAll('\r\n','\n');
const old='python3 .voltra/vehicle-sims.py install stormworks';
if(!profile.egg.scripts.installation.script.includes(old))throw Error('Reviewed installer entry changed');
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(old,`cat > .voltra/stormworks-owner.py <<'VOLTRA_STORMWORKS_OWNER'\n${source}\nVOLTRA_STORMWORKS_OWNER\npython3 .voltra/stormworks-owner.py install`);
profile.egg.startup='exec /usr/bin/python3 .voltra/stormworks-owner.py run';
profile.revision='stormworks-owner-source-v2';
profile.verification='not_verified';
profile.detail='Unintegrated source candidate. Seed-once native XML; prerequisite validation before game acquisition. Native acceptance blocked.';
profile.setup_steps=[
 'Retain original variables, order, defaults and permissions. Steam mode fails before game acquisition because private transport is unsupported. Upload legally obtained Windows x64 server64.exe and rom content using operator_files.',
 'Two consecutive allocations remain required. Native XML port must match the primary allocation. Existing server_data/server_config.xml owns name, password, players, administrators and gameplay after first seed. Startup environment values seed a missing file only. Edit the stopped native file for later changes.',
 'Original resource defaults are retained as unmeasured estimates, not publisher dedicated recommendations. No new consent or credentials are fabricated.',
 'Shared PTY supervision forwards native stdout/stderr and Ctrl-C and preserves raw exit status. No new readiness marker or guessed log path is supplied. Native readiness, stop/save semantics and file logging remain unverified.'
];
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/profile-fragment.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log('Staged Stormworks-only fragment; canonical profiles untouched.');
