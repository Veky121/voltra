import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const recipe='counter_strike/counter_strike_1.6_rehlds/egg-cs 1.6-rehlds.json';
const canonical='internal/panel/game_library/overrides.json',before=fs.readFileSync(canonical),all=JSON.parse(before);
const source='internal/panel/game_library/scripts/rehlds-wave10.py.pending',raw=fs.readFileSync(source,'utf8'),body=raw.replace(/\r\n/g,'\n').replace(/\n?$/,'\n');
const delimiter='VOLTRA_REHLDS_PREFLIGHT_WAVE10';assert(!body.split('\n').includes(delimiter));
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
function stage(original){
 const out=structuredClone(original);assert.equal(out.egg.variables.length,21);
 const oldSuffix='.voltra/counterstrike_preflight.py rehlds',newSuffix='.voltra/rehlds_wave10.py run';
 if(out.egg.startup.endsWith(oldSuffix))out.egg.startup=out.egg.startup.slice(0,-oldSuffix.length)+newSuffix;
 else assert(out.egg.startup.endsWith(newSuffix),'Unexpected ReHLDS-only entrypoint');
 let script=out.egg.scripts.installation.script.replace(/\r\n/g,'\n');
 const ownBlock=/\ncat > \.voltra\/rehlds_wave10\.py <<'VOLTRA_REHLDS_PREFLIGHT_WAVE10'\n[\s\S]*?\nVOLTRA_REHLDS_PREFLIGHT_WAVE10\n/g;
 assert((script.match(ownBlock)||[]).length<=1,'Duplicate owned helper block');script=script.replace(ownBlock,'');
 const oldCall='PYTHONPATH=.voltra python3 .voltra/cs16_modules_install.py',newCall='PYTHONPATH=.voltra python3 .voltra/rehlds_wave10.py install';
 const lines=script.split('\n'),calls=lines.filter(line=>line===oldCall||line===newCall);assert.equal(calls.length,1,'Expected exact single module install entrypoint');
 // Publish all shared helpers first. The old wave5 preflight heredoc was
 // appended after the old call, so replacing that call in place is unsafe.
 script=lines.filter(line=>line!==oldCall&&line!==newCall).join('\n').trimEnd();
 script+='\n\n'+`cat > .voltra/rehlds_wave10.py <<'${delimiter}'\n${body}${delimiter}\n${newCall}\n`;
 out.egg.scripts.installation.script=script;out.revision='cs16-modules-preflight-wave10';
 out.setup_steps=[...new Set([...(out.setup_steps||[]),'Original module selections and server controls are validated before the shared installer acquires publisher or module payloads. Existing symlinked or ambiguous registration paths require a file review; they are left unchanged.'])];
 assert.deepEqual(out.egg.variables,original.egg.variables,'Original ordered controls/defaults/rules/permissions changed');
 const restored=structuredClone(out);for(const key of ['revision','setup_steps']){if(original[key]===undefined)delete restored[key];else restored[key]=original[key];}restored.egg.startup=original.egg.startup;restored.egg.scripts.installation.script=original.egg.scripts.installation.script;
 assert.deepEqual(restored,original,'Unowned profile data changed');return out;
}
const original=all[recipe],profile=stage(original);assert.deepEqual(stage(profile),profile,'Stager is not idempotent after integration');
assert(profile.egg.scripts.installation.script.indexOf('VOLTRA_COUNTERSTRIKE_PREFLIGHT_WAVE5\n')<profile.egg.scripts.installation.script.lastIndexOf('PYTHONPATH=.voltra python3 .voltra/rehlds_wave10.py install'),'Shared preflight must exist before installer invocation');
assert(fs.readFileSync(canonical).equals(before),'Canonical overrides changed');
const helper='artifacts/game-parity-20261029/rehlds-wave10-helper.py.pending',fragment='artifacts/game-parity-20261029/rehlds-wave10-profile.json';fs.writeFileSync(helper,body);fs.writeFileSync(fragment,JSON.stringify({[recipe]:profile},null,2)+'\n');
const receipt={at:new Date().toISOString(),recipe,source,source_sha256:digest(Buffer.from(raw)),normalized_helper:helper,normalized_helper_sha256:digest(Buffer.from(body)),fragment,fragment_sha256:digest(fs.readFileSync(fragment)),baseline_overrides_sha256:digest(before),original_profile_sha256:digest(Buffer.from(JSON.stringify(original))),original_ordered_controls:21,resources_preserved:profile.defaults,ports_preserved:profile.required_ports,idempotent:true,only_one_recipe:true,shared_helpers_untouched:true,canonical_overrides_unchanged:true,native_acceptance:false};
fs.writeFileSync('artifacts/game-parity-20261029/rehlds-wave10-stage.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
