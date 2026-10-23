// Reuse the reviewed vanilla installer/settings, changing only execution platform.
import fs from 'node:fs';
const file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),base=profiles['factorio/factorio/egg-factorio.json'];
const path='factorio/factorio/egg-factorio-a-r-m64.json',entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path);
const profile=structuredClone(base),egg=profile.egg;
profile.upstream_sha256=entry.sha256;profile.revision='factorio-arm64-2.0.77-v1';profile.platforms=['linux/arm64'];profile.verification='not_verified';
profile.detail='Reviewed private setup for Linux ARM64 using Box64. No ARM64 hardware runtime acceptance has been performed.';
egg.name=entry.egg.name;egg.author=entry.egg.author;
egg.docker_images={'Box64 ARM64':'ghcr.io/ptero-eggs/yolks@sha256:518a73019ea5238a5cccdfc494ed4b30c4a08c6a0dbfe5b3584c6817fcde093c'};
egg.description='Factorio 2.0.77 headless through Box64 on Linux ARM64. Requires a real ARM64 node and the pinned ARM64 Box64 image. Uses the reviewed vanilla private defaults, literal JSON passwords and save/mod preservation. This is emulated x64 game software; ARM64 runtime behavior and performance have not been verified.';
egg.variables.push(...structuredClone(entry.egg.variables.filter(v=>v.env_variable.startsWith('BOX64_'))));
let script=egg.scripts.installation.script;
const oldGuard='case "$(uname -m)" in x86_64) ;; *) echo \'This profile requires Linux x64. Use the ARM64 recipe for Box64.\'; exit 2 ;; esac';
if(!script.includes(oldGuard))throw Error('Review changes to the vanilla architecture guard before regenerating ARM64');
script=script.replace(oldGuard,'case "$(uname -m)" in aarch64|arm64) ;; *) echo \'This profile requires a Linux ARM64 node. Use the vanilla recipe on x64.\'; exit 2 ;; esac');
script=script.replaceAll('jq-linux-amd64','jq-linux-arm64').replaceAll('020468de7539ce70ef1bceaf7cde2e8c4f2ca6c3afb84642aabc5c97d9fc2a0d','6bc62f25981328edd3cfcfe6fe51b073f2d7e7710d7ef7fcdac28d4e384fc3d4');
script=script.replace("cd /home/container\n",`cd /home/container
case "$(uname -m)" in aarch64|arm64) ;; *) echo 'This runtime requires Linux ARM64.'; exit 2 ;; esac
command -v box64 >/dev/null || { echo 'The selected runtime must provide Box64.'; exit 2; }
`);
script=script.replaceAll('./bin/x64/factorio --','box64 ./bin/x64/factorio --');
egg.scripts.installation.script=script;
profile.setup_steps.unshift('Choose an online Linux ARM64 node. The standard x64 recipe is the correct choice for x64 nodes. ARM64 game execution and performance still need hardware acceptance.');
profiles[path]=profile;fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('ARM64 Factorio profile generated without inheriting x64 verification.');
