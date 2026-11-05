import fs from 'node:fs';
const recipe='pixark/egg-pix-a-r-k.json', out='artifacts/pixark-installer-followup/profiles.json';
const catalog=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const original=catalog.entries.find(e=>e.path===recipe);
const profile=structuredClone(JSON.parse(fs.readFileSync('.local/ark-family/profiles.json'))[recipe]);
// Preserve original ordered controls/defaults/permissions exactly; append only new controls.
const added=profile.egg.variables.filter(v=>!original.egg.variables.some(o=>o.env_variable===v.env_variable));
profile.egg.variables=[...structuredClone(original.egg.variables),...added];
profile.revision='pixark-owner-next-source-v1';profile.verification='not_verified';
profile.detail='Source-only PixARK preflight and seed-only native-file adapter. No activation or native acceptance.';
profile.egg.startup=profile.egg.startup.replace('.voltra/ark_family.py run pixark','.voltra/pixark_owner_next.py run');
// Stage current helper sources outside the server volume. Missing Python is an explicit
// prerequisite failure, never a reason to acquire packages before validation.
const base='internal/panel/game_library/scripts/';
const sources=['ark-family.py','native-config.py','steam-template.py','bundle-debian-python.py','pixark-owner-next.py'];
let script=`#!/bin/bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
cd /mnt/server
command -v python3 >/dev/null || { echo 'PixARK preflight requires provisioned Python 3; no packages acquired' >&2; exit 1; }
helper_stage=$(mktemp -d)
trap 'rm -rf -- "$helper_stage"' EXIT
`;
for(const name of sources){
 let source=fs.readFileSync(base+name,'utf8').replaceAll('\r\n','\n');
 if(name==='pixark-owner-next.py')source=source.replace("with_name('ark-family.py')","with_name('ark_family.py')");
 script+=`cat > "$helper_stage/${name.replaceAll('-','_')}" <<'VOLTRA_PIXARK_SOURCE'\n${source}\nVOLTRA_PIXARK_SOURCE\n`;
}
script+=`python3 "$helper_stage/pixark_owner_next.py" preflight
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6
mkdir -p .voltra
`;
for(const name of sources)script+=`cp -- "$helper_stage/${name.replaceAll('-','_')}" .voltra/${name.replaceAll('-','_')}\n`;
script+=`python3 .voltra/bundle_debian_python.py
python3 .voltra/pixark_owner_next.py install
`;
profile.egg.scripts.installation.script=script;
profile.revision='pixark-installer-preflight-source-v2';
profile.setup_steps.push('Native file identity/password/player values take precedence when present; ambiguous case-variant duplicates fail without writes. Runtime owns listener roles. Wine readiness is an explicit operator assertion, not dependency attestation. Installer requires Python and Wine already provisioned; no package or game acquisition occurs before read-only preflight.');
fs.mkdirSync('artifacts/pixark-installer-followup',{recursive:true});
fs.writeFileSync(out,JSON.stringify({[recipe]:profile},null,2)+'\n');
console.log(out);
