import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const recipe='openra/openra_red_alert/egg-open-r-a.json',canonical=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe],profile=structuredClone(canonical),terminal='python3 .voltra/openra-family.py ra install\n';
if(!profile.egg.scripts.installation.script.endsWith(terminal)||profile.egg.scripts.installation.script.split(terminal).length!==2)throw Error('Unique canonical terminal family installer required');
const resources=['steam-template.py','native-console.py','openra-ra-runtime.py'],hashes={};let added='';
for(const [index,name]of resources.entries()){
 const bytes=fs.readFileSync('internal/panel/game_library/scripts/'+name,'utf8').replaceAll('\r\n','\n'),marker='OPENRA_RA_RUNTIME_'+index;
 if(bytes.includes('\n'+marker+'\n'))throw Error('Generated heredoc marker collision');
 if(profile.egg.scripts.installation.script.includes('cat > .voltra/'+name+' '))throw Error('Unexpected pre-existing RA runtime embed; review refresh explicitly');
 added+=`cat > .voltra/${name} <<'${marker}'\n${bytes.endsWith('\n')?bytes:bytes+'\n'}${marker}\n`;
 hashes[name]=crypto.createHash('sha256').update(bytes).digest('hex');
}
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.slice(0,-terminal.length)+added+terminal;
profile.egg.startup='exec python3 .voltra/openra-ra-runtime.py';profile.egg.config.startup=JSON.stringify({done:'[INFO] OpenRA Red Alert native server ready.'});
assert.deepEqual(profile.egg.variables,canonical.egg.variables);assert.deepEqual(profile.defaults,canonical.defaults);assert.deepEqual(profile.platforms,canonical.platforms);
const undo=structuredClone(profile);undo.egg.scripts.installation.script=canonical.egg.scripts.installation.script;undo.egg.startup=canonical.egg.startup;undo.egg.config.startup=canonical.egg.config.startup;assert.deepEqual(undo,canonical);
const out='artifacts/game-parity-20261029/openra-wave9-profile.json';fs.writeFileSync(out,JSON.stringify({[recipe]:profile},null,2)+'\n');
fs.writeFileSync('artifacts/game-parity-20261029/openra-wave9-runtime-source.json',JSON.stringify({at:new Date().toISOString(),recipe,profile:out,hashes,controls_preserved:canonical.egg.variables.map(v=>v.env_variable),changed_fields:['egg.startup','egg.config.startup','egg.scripts.installation.script: three added shared/title resources before unchanged terminal installer'],shared_family_unchanged:true,shared_console_unchanged:true,steam_template_unchanged:true,rust_bridge_unchanged:true,verification_not_promoted:true,tests:{windows:{count:7,pass:true},linux_docker:{count:7,pass:true,image:'python:3.12-slim',network:'none',memory_mib:256,swap:0,cpus:1,source_readonly:true,rootfs_readonly:true,temporary_directory:'32MiB private tmpfs'},first_linux_harness_attempt:'Failed because read-only rootfs had no temporary directory; rerun with bounded private tmpfs passed. No source failure hidden.'},native:'Pending root integration/fresh activation and exact native acceptance',publisher_source:['https://raw.githubusercontent.com/OpenRA/OpenRA/release-20250330/OpenRA.Server/Program.cs','https://raw.githubusercontent.com/OpenRA/OpenRA/release-20250330/OpenRA.Game/Server/ProtocolVersion.cs'],evidence_boundary:'Fixture/mocked supervision and greeting parsing only. No native online/power acceptance claimed.'},null,2)+'\n');
console.log(JSON.stringify({profile:out,controls:profile.egg.variables.length,hashes,shared_components_unchanged:true,verification_not_promoted:true}));
