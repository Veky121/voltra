import fs from 'node:fs';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const path='foundry_vtt/egg-FoundryVTT.json',entry=catalog.entries.find(x=>x.path===path),egg=structuredClone(entry.egg);
egg.docker_images={'Pinned Node 24 Trixie (V13/V14 minimum satisfied)':'ghcr.io/ptero-eggs/yolks@sha256:5c5a3e74fb39f25c2dc65851ca7255d7e739af54d94c6df46cdb91a496ee51f4'};
egg.startup='exec python3 .voltra/foundry-native.py run';
egg.config={...egg.config,files:'{}',stop:'^SIGTERM'};
egg.variables.push({name:'Optional archive SHA256',description:'Optional SHA256 obtained independently for your licensed Node ZIP. Empty permits the fresh account-signed download. The installer records only its resulting checksum, never the timed URL.',env_variable:'FOUNDRY_SHA256',default_value:'',user_viewable:true,user_editable:true,rules:'nullable|string|regex:/^[a-fA-F0-9]{64}$/',field_type:'text'});
let script='#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates\nmkdir -p .voltra\n';
for(const source of ['foundry-native.py','native-console.py','steam-template.py'])script+=`cat > .voltra/${source==='steam-template.py'?'steam_template.py':source} <<'VOLTRA_FOUNDRY_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/'+source,'utf8')}\nVOLTRA_FOUNDRY_SOURCE\n`;
script+='python3 .voltra/foundry-native.py install\n';
egg.scripts.installation={container:'debian:bookworm-slim',entrypoint:'bash',script};
const profile={upstream_sha256:entry.sha256,revision:'foundry-licensed-node-v1',platforms:['linux/amd64','linux/arm64'],required_ports:1,defaults:{memory:2048,disk:4096},verification:'not_verified',detail:'Source and synthetic archive fixtures only. Licensed download, activation, native startup/stop, persistence and client use remain unverified; no licensed archive acquired.',egg,setup_steps:[
'Requires your purchased Foundry VTT license and a fresh Node distribution TIMED_URL from your account. This proprietary application is not supplied or publicly cached. Activation and EULA acceptance remain the operator’s responsibility; no fake credentials or automatic license acceptance.',
'Preserves all three original controls: timed URL, language and update channel. Optional independently obtained SHA256 pins the licensed archive. Timed URLs are read only from installer environment, omitted from receipts and command arguments, redacted from runtime output and removed from the Node child environment.',
'Pinned public Node 24 Trixie Wings-compatible runtime includes Python and satisfies current publisher minimums (V13:22, V14:24). Detects main.mjs/main.js and legacy resources/app entry points. Native compatibility of any licensed build, add-on or architecture is not yet proven.',
'User data, Config/options.json, admin.txt, worlds, systems and modules survive reinstall. Existing options are never overwritten during installation; startup updates only port, language and updateChannel with typed atomic JSON while retaining unknown operator options. Back up user data before version upgrades.',
'Application ZIP contents replace app atomically; app-local modifications are replaced, so keep operator content in data. Unsafe archive paths, links, special files and oversized archives are rejected before extraction. Interrupted swaps retain a backup and require explicit operator recovery.',
'Uses the shared React configuration form and native console supervisor. Stop forwards Ctrl-C through a private terminal; graceful native stop is not claimed until a licensed runtime is tested. One allocated TCP web port; reverse proxy and TLS remain operator options in options.json.'
]};
fs.mkdirSync('.local/foundry-vtt',{recursive:true});fs.writeFileSync('.local/foundry-vtt/profiles.json',JSON.stringify({[path]:profile},null,2)+'\n');console.log('Staged Foundry VTT licensed source profile.');
