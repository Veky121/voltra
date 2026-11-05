import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath}from 'node:url';
export const recipe='factorio/factorio/egg-factorio.json',sourcePath='internal/panel/game_library/scripts/factorio-settings-seed.py';
export function stageProfile(current,helperSource){
 const p=structuredClone(current),helper=helperSource.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').trimEnd();let s=p.egg.scripts.installation.script;
 const embedded=/(cat > "\$stage\/factorio-settings-seed\.py" <<'VOLTRA_FACTORIO_SETTINGS_SEED'\n)[\s\S]*?(\nVOLTRA_FACTORIO_SETTINGS_SEED\n)/;
 if(embedded.test(s))s=s.replace(embedded,(_,a,b)=>a+helper+b);
 else{
 const command='python3 "$stage/factorio-install.py" --root /mnt/server --version "$FACTORIO_VERSION" --architecture x64';assert.equal(s.split(command).length,2);
 s=s.replace(command,`cat > "$stage/factorio-settings-seed.py" <<'VOLTRA_FACTORIO_SETTINGS_SEED'\n${helper}\nVOLTRA_FACTORIO_SETTINGS_SEED\npython3 "$stage/factorio-settings-seed.py" --root /mnt/server\n${command}`);
 assert(s.includes('for kind in map-gen-settings map-settings server-settings; do'));s=s.replace('for kind in map-gen-settings map-settings server-settings; do','for kind in map-gen-settings map-settings; do');
 const reset=/if \[ ! -f \.voltra\/factorio-initialized \]; then\n[\s\S]*?touch \.voltra\/factorio-initialized\nfi/;assert(reset.test(s));s=s.replace(reset,'python3 "$stage/factorio-settings-seed.py" --root /mnt/server --seed');
 const oldGate='if [ "$PUBLIC_SERVER" = 1 ] && { [ -z "$SERVER_USERNAME" ] || [ -z "$SERVER_TOKEN" ]; }; then echo \'Public listing requires a Factorio username and token.\'; exit 2; fi';assert(s.includes(oldGate));s=s.replace(oldGate,'');
 const writes=/temp=\$\(mktemp data\/\.server-settings\.XXXXXX\)\ntrap 'rm -f -- "\$temp"' EXIT\n[\s\S]*?mv "\$temp" data\/server-settings.json/;assert(writes.test(s));
 s=s.replace(writes,`# Native settings are authoritative after installation; validation never rewrites them.\n[ ! -L data ] && [ ! -L data/server-settings.json ] || { echo 'Unsafe native settings path.'; exit 2; }\n.voltra/jq -e 'type == "object" and ((.visibility // {}) | type == "object") and ([.visibility.public // false,.visibility.lan // false] | all(type == "boolean")) and ((.username // "") | type == "string") and ((.token // "") | type == "string") and ((.password // "") | type == "string") and (if .visibility.public then ((.username // "") != "" and ((.token // "") != "" or (.password // "") != "")) else true end)' data/server-settings.json >/dev/null || { echo 'Native settings invalid or public listing credentials absent.'; exit 2; }\ncase "$SERVER_PORT" in ''|*[!0-9]*) echo 'Invalid allocated game port.'; exit 2 ;; esac\n[ "$SERVER_PORT" -ge 1 ] && [ "$SERVER_PORT" -le 65535 ] || { echo 'Invalid allocated game port.'; exit 2; }`);
 }
 // Keep native-authority discovery separate from the older shared launchers,
 // which still overwrite native settings in the other Factorio variants.
 assert(['exec bash .voltra/factorio-start.sh','exec bash .voltra/factorio-native-start.sh'].includes(p.egg.startup));
 s=s.replaceAll('.voltra/factorio-start.sh','.voltra/factorio-native-start.sh');
 p.egg.startup='exec bash .voltra/factorio-native-start.sh';
 p.egg.scripts.installation.script=s;p.settings_documents=['data/server-settings.json','data/map-gen-settings.json','data/map-settings.json'];
 p.revision=p.revision.replace(/-native-authority-v\d+$/,'')+'-native-authority-v2';
 p.verification='not_verified';p.detail='Native settings authority correction source tested; historical pinned2.0.77 runtime receipts remain historical. Current-campaign native and browser acceptance pending.';
 p.egg.description=p.egg.description.replace('Name, player limit, join password, visibility and autosave settings are managed through Startup.','Creation controls seed name, player limit, join password, visibility and autosave values once; later use Game settings. Existing native values and credentials survive startup and reinstall.');
 const instruction='Use Game settings after creation for server identity, join password, visibility and autosave values. Map generation controls apply only when creating a new save.';
 p.setup_steps=[...p.setup_steps.filter(x=>x!==instruction),instruction];assert.deepEqual(p.egg.variables,current.egg.variables);assert.deepEqual(p.defaults,current.defaults);assert.deepEqual(p.egg.docker_images,current.egg.docker_images);return p;
}
export function stageOverrides(profiles,helperSource){assert(profiles[recipe]);return {...profiles,[recipe]:stageProfile(profiles[recipe],helperSource)};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file='internal/panel/game_library/overrides.json',before=fs.readFileSync(file),profiles=JSON.parse(before),next=stageOverrides(profiles,fs.readFileSync(sourcePath,'utf8'));
 assert.deepEqual(stageOverrides(next,fs.readFileSync(sourcePath,'utf8')),next,'Canonical stager must be idempotent');
 if(process.argv.includes('--apply')){assert(fs.readFileSync(file).equals(before),'Concurrent profile change');fs.writeFileSync(file,JSON.stringify(next,null,2)+'\n');}
 fs.writeFileSync('artifacts/game-parity-20261029/factorio-native-profile.json',JSON.stringify({[recipe]:next[recipe]},null,2)+'\n');console.log(JSON.stringify({recipe,applied:process.argv.includes('--apply'),revision:next[recipe].revision,rows:next[recipe].egg.variables.length,idempotent:true}));
}
