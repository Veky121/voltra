import fs from 'node:fs';
import assert from 'node:assert/strict';
const output=process.argv[2];
assert(output,'An explicit isolated output directory is required');
fs.mkdirSync(output,{recursive:true});
const original=fs.readFileSync('internal/panel/game_library/overrides.json');
const profiles=JSON.parse(original),staged={};
for(const [recipe,app] of [['fof/egg-fof.json','295230'],['nmrih/egg-nmrih.json','317670']]){
 const current=profiles[recipe],p=structuredClone(current);
 assert(p.egg.startup.endsWith('.voltra/source_variant_runtime.py'));
 p.egg.startup=p.egg.startup.replace(/source_variant_runtime.py$/,'source_variants_wave58.py '+app);
 let script=p.egg.scripts.installation.script;
 const marker="PYTHONPATH=.voltra python3 - <<'VOLTRA_INSTALL'\nfrom pathlib import Path\nfrom source_install import update\nupdate(Path.cwd(),"+app+",required=('srcds_run',))\nVOLTRA_INSTALL\n";
 assert.equal(script.split(marker).length,2,'Exact acquisition stanza required');
 let embed='';
 for(const [file,target] of [['internal/panel/game_library/scripts/source-pair-preflight.py','source_pair_preflight.py'],['tools/runtime/source-variants-wave58.py','source_variants_wave58.py']]){
  const body=fs.readFileSync(file,'utf8').replaceAll('\r\n','\n').trimEnd();
  assert(!body.split('\n').includes('VOLTRA_WAVE58_HELPER'));
  embed+=`cat > .voltra/${target} <<'VOLTRA_WAVE58_HELPER'\n${body}\nVOLTRA_WAVE58_HELPER\n`;
 }
 p.egg.scripts.installation.script=script.replace(marker,embed+`PYTHONPATH=.voltra python3 .voltra/source_variants_wave58.py ${app} --install\n`);
 const check=structuredClone(p);check.egg.startup=current.egg.startup;check.egg.scripts.installation.script=current.egg.scripts.installation.script;
 assert.deepEqual(check,current,'Controls, image, resources, permissions and metadata must remain unchanged');
 staged[recipe]=p;
}
assert(fs.readFileSync('internal/panel/game_library/overrides.json').equals(original));
fs.writeFileSync(output+'/profiles.unapplied.json',JSON.stringify(staged,null,2)+'\n');
console.log('Staged two unapplied recipes; canonical unchanged');
