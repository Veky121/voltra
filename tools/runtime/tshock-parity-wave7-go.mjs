import fs from 'node:fs';
import path from 'node:path';
const source='internal/panel/game_tshock_test.go',pending=source+'.pending';let text=fs.readFileSync(source,'utf8');
text=text.replace('entry.Profile != "tshock-6.2.1-v1-exact-release-v1"','entry.Profile != "tshock-6.2.1-v1-exact-release-v1-native-authority-wave7"');
text=text.replace('settings["Settings.ServerPassword"] != "{{server.build.env.SERVER_PASSWORD}}"','settings["Settings.ServerPassword"] != nil');
text=text.replace('startup != "exec python3 .voltra/tshock_runtime.py"','startup != "exec python3 .voltra/tshock_parity_native.py run"');
fs.writeFileSync(pending,text);
const recipe='terraria/tshock/egg-tshock.json',base='internal/panel/game_library/overrides.json',all=JSON.parse(fs.readFileSync(base)),fragment=JSON.parse(fs.readFileSync('artifacts/game-parity-20261029/tshock-wave7-profile.json'));all[recipe]=fragment[recipe];
const merged='artifacts/game-parity-20261029/tshock-wave7-overrides-merged.json',overlay='artifacts/game-parity-20261029/tshock-wave7-go-overlay.json';fs.writeFileSync(merged,JSON.stringify(all,null,2)+'\n');fs.writeFileSync(overlay,JSON.stringify({Replace:{[path.resolve(source)]:path.resolve(pending),[path.resolve(base)]:path.resolve(merged)}},null,2)+'\n');console.log(JSON.stringify({pending,overlay,canonical_applied:false}));
