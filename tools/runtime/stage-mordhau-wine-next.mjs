import fs from 'node:fs';
const recipe='mordhau/egg-mordhau-wine.json',dir='artifacts/game-parity-20261029/mordhau-wine-owner-next';
const canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe],profile=structuredClone(canonical);
profile.revision='mordhau-wine-native-authority-next-v2';profile.verification='not_verified';profile.detail='Pending source-only seed-once native authority and preflight; no Wine native acceptance.';
profile.egg.startup=profile.egg.startup.replace('.voltra/melee-native.py','.voltra/mordhau-wine-next.py');
const helper=fs.readFileSync('internal/panel/game_library/scripts/mordhau-wine-next.py','utf8');
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace('python3 .voltra/melee-native.py install mordhau-wine',()=>`cat > .voltra/mordhau-wine-next.py <<'VOLTRA_MORDHAU_WINE_NEXT'\n${helper}\nVOLTRA_MORDHAU_WINE_NEXT\npython3 .voltra/mordhau-wine-next.py install mordhau-wine`);
profile.setup_steps=[
 'Existing ordered egg variables/defaults/permissions retained, including both WINDOWS_INSTALL records and strict Wine validation. Game/query/beacon require distinct allocations; blank query/beacon controls automatically select additional allocations.',
 'Native WindowsServer/Game.ini owns identity, passwords and MaxSlots after missing values are seeded once. Runtime environment edits do not overwrite existing native values. Edit native files while stopped; typed settings integration pending root.',
 'Existing 4 GB memory and 24 GB disk defaults are provisional, not publisher recommendations or measured Wine requirements. No dedicated publisher resource recommendation located; client requirements are not substituted.',
 'Typed configuration and allocation preflight runs before Steam update/preservation mutations. Wine vcrun2022, display availability and actual log/readiness remain native-unverified.'
];
fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(`${dir}/profile.pending.json`,JSON.stringify({[recipe]:profile},null,2)+'\n');
if(JSON.stringify(profile.egg.variables)!==JSON.stringify(canonical.egg.variables))throw Error('Canonical variable fidelity lost');
console.log('Staged exactly one recipe; canonical variables retained.');
