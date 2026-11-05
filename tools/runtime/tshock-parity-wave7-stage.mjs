import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const recipe='terraria/tshock/egg-tshock.json',file='internal/panel/game_library/overrides.json',before=fs.readFileSync(file),current=JSON.parse(before)[recipe],profile=structuredClone(current);
const source='tools/runtime/tshock-parity-wave7.py',body=fs.readFileSync(source,'utf8').replaceAll('\r\n','\n'),publication=fs.readFileSync('internal/panel/game_library/scripts/steam-template.py','utf8').replaceAll('\r\n','\n');
assert.equal(profile.egg.startup,'exec python3 .voltra/tshock_runtime.py');profile.egg.startup='exec python3 .voltra/tshock_parity_native.py run';
const install="python3 - <<'VOLTRA_INSTALL'\nimport os,sys\nfrom pathlib import Path\nsys.path.insert(0,'.voltra')\nfrom terraria_release_install import install\ninstall(Path.cwd(),dict(os.environ))\nVOLTRA_INSTALL";
assert.equal(profile.egg.scripts.installation.script.split(install).length,2);
const publishTag='VOLTRA_TSHOCK_WAVE7_PUBLICATION',helperTag='VOLTRA_TSHOCK_WAVE7_NATIVE';for(const[tag,text]of[[publishTag,publication],[helperTag,body]])assert(!text.split('\n').includes(tag));
const prefix=`cat > .voltra/steam_template.py <<'${publishTag}'\n${publication}\n${publishTag}\ncat > .voltra/tshock_parity_native.py <<'${helperTag}'\n${body}\n${helperTag}\n`;
profile.egg.scripts.installation.script=profile.egg.scripts.installation.script.replace(install,()=>prefix+install.replace('from terraria_release_install import install','from tshock_parity_native import install'));
const config=JSON.parse(profile.egg.config.files);assert(config['serverconfig.txt']&&config['tshock/config.json']);
config['serverconfig.txt'].find={worldpath:'/home/container/saves/Worlds',port:'{{server.build.default.port}}',upnp:'0'};
config['tshock/config.json'].find={'Settings.ServerPort':'{{server.build.default.port}}','Settings.LogPath':'/home/container/logs'};
profile.egg.config.files=JSON.stringify(config);profile.settings_documents=['serverconfig.txt','tshock/config.json'];
profile.revision+='-native-authority-wave7';profile.detail+=' TShock-only seed-once native configuration candidate; exact shared publisher/runtime remain unchanged. Native acceptance pending.';
profile.setup_steps=[...new Set([...profile.setup_steps,'Creation controls seed native files once. Later edit serverconfig.txt and tshock/config.json through Game settings; existing native values survive boots and reinstalls. World creation settings affect newly generated worlds. Vanilla maxplayers is a hard limit; TShock MaxSlots is an admission limit if lower. Allocated ports, the native world folder, log folder and disabled UPnP remain managed.'])];
assert.deepEqual(profile.egg.variables,current.egg.variables);assert.deepEqual(profile.egg.docker_images,current.egg.docker_images);
for(const key of['defaults','required_ports','port_rules','verification','upstream_sha256'])assert.deepEqual(profile[key],current[key]);
for(const name of['terraria_release_install.py','tshock_runtime.py']){
 const pattern=new RegExp("^cat > \\.voltra/"+name.replaceAll('.','\\.')+" <<'([^']+)'\\n[\\s\\S]*?\\n\\1\\n",'m');
 const candidate=profile.egg.scripts.installation.script.match(pattern),original=current.egg.scripts.installation.script.match(pattern);assert(candidate&&original,'Expected original helper block missing');assert.equal(candidate[0],original[0],'Original shared helper changed');
}
assert(fs.readFileSync(file).equals(before));const output='artifacts/game-parity-20261029/tshock-wave7-profile.json';fs.writeFileSync(output,JSON.stringify({[recipe]:profile},null,2)+'\n');console.log(JSON.stringify({output,controls:profile.egg.variables.length,helper_sha256:crypto.createHash('sha256').update(body).digest('hex'),canonical_applied:false}));
