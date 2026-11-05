import fs from 'node:fs';import assert from 'node:assert/strict';import {digest} from './campaign-native-20261029.mjs';
const recipe='counter_strike/counter_strike_source/egg-counter--strike--source.json',before=fs.readFileSync('internal/panel/game_library/overrides.json'),all=JSON.parse(before),original=all[recipe],profile=structuredClone(original),source=fs.readFileSync('internal/panel/game_library/scripts/css-native-settings.py.pending','utf8').replaceAll('\r\n','\n');
assert(profile.egg.startup.endsWith('.voltra/counterstrike_preflight.py css')||profile.egg.startup.endsWith('.voltra/css_native_settings.py'));
profile.egg.startup=profile.egg.startup.replace('.voltra/counterstrike_preflight.py css','.voltra/css_native_settings.py');
const delimiter='VOLTRA_CSS_NATIVE_SETTINGS_WAVE7';assert(!source.includes(delimiter));
const embed=`cat > .voltra/css_native_settings.py <<'${delimiter}'\n${source}${source.endsWith('\n')?'':'\n'}${delimiter}`;
const marker="cat > .voltra/css_native_settings.py <<'"+delimiter+"'\n",script=profile.egg.scripts.installation.script;
if(script.includes(marker)){
 const start=script.indexOf(marker),end=script.indexOf('\n'+delimiter,start+marker.length);assert(end>start);assert.equal(script.indexOf(marker,start+1),-1);
 profile.egg.scripts.installation.script=script.slice(0,start)+embed+script.slice(end+delimiter.length+1);
}else profile.egg.scripts.installation.script+='\n'+embed+'\n';
assert.deepEqual(profile.egg.variables,original.egg.variables);const restored=structuredClone(profile);restored.egg.startup=original.egg.startup;restored.egg.scripts.installation.script=original.egg.scripts.installation.script;assert.deepEqual(restored,original);
assert(fs.readFileSync('internal/panel/game_library/overrides.json').equals(before));
fs.writeFileSync('artifacts/game-parity-20261029/css-wave7-seed-profile.json',JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync('artifacts/game-parity-20261029/css-wave7-seed-stage.json',JSON.stringify({recipe,controls:profile.egg.variables.length,canonical_counterstrike_sha256:digest(fs.readFileSync('internal/panel/game_library/scripts/counterstrike-preflight.py')),candidate_sha256:digest(source),fragment:'CSS-only; neither GoldSrc profile nor shared helper was edited',canonical_overrides_changed:false},null,2)+'\n');console.log('CSS-only seed fragment staged; original seventeen controls and both GoldSrc profiles unchanged');
