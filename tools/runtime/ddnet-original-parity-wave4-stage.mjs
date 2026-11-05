import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const recipe='ddnet/egg-d-d-net.json',file='internal/panel/game_library/overrides.json';
const before=fs.readFileSync(file),canonical=JSON.parse(before)[recipe],profile=structuredClone(canonical);
const source=fs.readFileSync('internal/panel/game_library/scripts/ddnet-original-parity.py','utf8').replaceAll('\r\n','\n').replace(/\n$/,'');
const delimiter='VOLTRA_DDNET_ORIGINAL_PARITY';
assert(!source.split('\n').includes(delimiter));
const originalCommand='python3 .voltra/ddnet_install.py\n';
const block=`cat > .voltra/ddnet_original_parity.py <<'${delimiter}'\n${source}\n${delimiter}\n`;
const script=profile.egg.scripts.installation.script;
const marker=`cat > .voltra/ddnet_original_parity.py <<'${delimiter}'\n`;
const index=script.indexOf(marker);
if(index<0){
 assert(script.endsWith(originalCommand),'Review changed installer entrypoint');
 profile.egg.scripts.installation.script=script.slice(0,-originalCommand.length)+block+'python3 .voltra/ddnet_original_parity.py install\n';
}else{
 assert(script.endsWith('python3 .voltra/ddnet_original_parity.py install\n'));
 assert.equal(script.indexOf(marker,index+marker.length),-1,'Duplicate original DDNet parity helper');
 const end=script.indexOf('\n'+delimiter+'\n',index+marker.length);assert(end>=0,'Unterminated original DDNet parity helper');
 profile.egg.scripts.installation.script=script.slice(0,index)+block+script.slice(end+delimiter.length+2);
}
assert(['exec python3 .voltra/ddnet_runtime.py','exec python3 .voltra/ddnet_original_parity.py'].includes(profile.egg.startup));
profile.egg.startup='exec python3 .voltra/ddnet_original_parity.py';
const disclosure='Initial setup seeds /ddnet/autoexec_server.cfg once. Game settings owns native gameplay values afterward; existing base/custom files and credentials are preserved. Resources, release and updates remain Runtime controls.';
profile.setup_steps=[...(profile.setup_steps||[]).filter(step=>step!==disclosure),disclosure];
assert.deepEqual(profile.egg.variables,canonical.egg.variables);
const unchanged=structuredClone(profile);unchanged.egg.startup=canonical.egg.startup;unchanged.egg.scripts.installation.script=canonical.egg.scripts.installation.script;unchanged.setup_steps=canonical.setup_steps;
assert.deepEqual(unchanged,canonical,'Unrelated profile metadata changed');
assert(fs.readFileSync(file).equals(before),'Canonical overrides changed');
const output='artifacts/game-parity-20261029/ddnet-original-wave4-profile.json';fs.writeFileSync(output,JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log(JSON.stringify({output,recipe,controls:profile.egg.variables.length,helper_sha256:createHash('sha256').update(source+'\n').digest('hex'),canonical_overrides_changed:false}));
