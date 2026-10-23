import fs from 'node:fs';import crypto from 'node:crypto';
const path='veloren/egg-veloren.json',entry=JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e=>e.path===path),file='internal/panel/game_library/overrides.json',profiles=JSON.parse(fs.readFileSync(file)),egg=structuredClone(entry.egg);
const base='internal/panel/game_library/scripts/';
const runtime=fs.readFileSync(base+'veloren-runtime.py','utf8'),installer=fs.readFileSync(base+'veloren-install.py','utf8'),builds=fs.readFileSync(base+'veloren-builds.json','utf8');
const cargo=fs.readFileSync('tools/ron-config/Cargo.toml','utf8'),lock=fs.readFileSync('tools/ron-config/Cargo.lock','utf8'),rust=fs.readFileSync('tools/ron-config/src/main.rs','utf8'),license=fs.readFileSync('tools/ron-config/LICENSE','utf8');
const helperId=crypto.createHash('sha256').update(cargo).update(lock).update(rust).digest('hex');
egg.description='Veloren dedicated server with publisher-verified pinned builds, native RON settings and a plain console. The default weekly build is c5024ebf, dated 2026-10-21. Reinstall retains userdata and same-build asset overrides. Configuration is validated by the actual server in isolated userdata before live settings change. Matching clients are required.';
egg.docker_images={'Ubuntu 24.04':'ghcr.io/ptero-eggs/yolks@sha256:85cc85e658366d2398288b1f829a4bab4de2d02a3bea4193f8d502db7b2dd29b'};
egg.startup='exec python3 .voltra/veloren-runtime.py';egg.config.files='{}';egg.config.startup=JSON.stringify({done:'Server is ready to accept connections'});egg.config.stop='shutdown graceful 5';
for(const v of egg.variables){
 if(v.env_variable==='VERSION'){v.description='Pinned weekly: 2026-10-21, c5024ebf. The published pinned nightly is older, 2025-09-13, and has not been runtime-reviewed. Weekly is the reviewed default; clients must match the chosen build.';}
 if(v.env_variable==='SERVER_NAME'){v.rules='required|string|max:64|not_regex:/[\\r\\n\\x00]/';v.default_value='Veloren server';v.description='Literal display name. Quotes, punctuation and Unicode are supported through native RON serialization.';}
 if(v.env_variable==='METRICS_PORT'){v.user_viewable=true;v.user_editable=true;v.rules='required|integer|between:1,65535';v.description='CLI/web or legacy metrics TCP port. Private loopback binding by default. Must differ from the TCP game port. Public access requires a real additional allocation.';}
}
for(const [name,key,description,value,rules]of [
 ['Maximum players','MAX_PLAYERS','Maximum simultaneous players.','32','required|integer|between:1,65535'],
 ['Authentication','AUTH_MODE','Official account verification is the default. Offline mode accepts unverified names and is intended for trusted private servers.','official','required|in:official,offline'],
 ['Authentication service','AUTH_SERVER_URL','HTTPS authentication service, used in official mode. Existing player accounts and administrator records are preserved.','https://auth.veloren.net','required|string|url|max:2048'],
 ['Manage network bindings','MANAGE_NETWORK','1 manages the allocated TCP game port, query endpoint and metrics binding. 0 preserves custom native protocol settings, including operator-configured QUIC.','1','required|in:0,1'],
 ['Enable query endpoint','QUERY_ENABLED','Native UDP server queries. By default this shares the allocation with the TCP game listener.','1','required|in:0,1'],
 ['Query port','QUERY_PORT','0 uses the primary allocation. A different port must be additionally allocated.','0','required|integer|between:0,65535'],
 ['Public metrics binding','METRICS_PUBLIC','0 keeps metrics/web on container loopback. 1 binds publicly and requires Metrics port as an additional allocation. Native web API access rules remain in effect.','0','required|in:0,1'],
])egg.variables.push({name,env_variable:key,description,default_value:value,rules,user_viewable:true,user_editable:true,field_type:'text'});
egg.scripts.installation={container:'rust:1.90-slim-bookworm',entrypoint:'bash',script:`#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl python3 gcc libc6-dev
cd /mnt/server
mkdir -p .voltra/ron-config-src/src
cat > .voltra/veloren-runtime.py <<'RUNTIME_SOURCE'
${runtime}
RUNTIME_SOURCE
cat > .voltra/veloren-install.py <<'INSTALL_SOURCE'
${installer}
INSTALL_SOURCE
cat > .voltra/veloren-builds.json <<'BUILD_SOURCE'
${builds}
BUILD_SOURCE
cat > .voltra/ron-config-src/Cargo.toml <<'CARGO_SOURCE'
${cargo}
CARGO_SOURCE
cat > .voltra/ron-config-src/Cargo.lock <<'LOCK_SOURCE'
${lock}
LOCK_SOURCE
cat > .voltra/ron-config-src/src/main.rs <<'RUST_SOURCE'
${rust}
RUST_SOURCE
cat > .voltra/ron-config-src/LICENSE <<'LICENSE_SOURCE'
${license}
LICENSE_SOURCE
case "$(uname -m)" in x86_64|aarch64) ;; *) echo 'This recipe requires Linux x64 or ARM64.'; exit 2 ;; esac
helper_id=${helperId}-$(uname -m)
helper_build=1
if [ -x .voltra/voltra-ron-config ] && [ -f .voltra/ron-config-build-id ] && [ -f .voltra/ron-config-binary.sha256 ] && [ "$(cat .voltra/ron-config-build-id)" = "$helper_id" ]; then
 if [ "$(sha256sum .voltra/voltra-ron-config | cut -d ' ' -f1)" = "$(cat .voltra/ron-config-binary.sha256)" ]; then helper_build=0; fi
fi
if [ "$helper_build" = 1 ]; then
 stage=$(mktemp -d /mnt/server/.veloren-helper.XXXXXX)
 trap 'rm -rf -- "$stage"' EXIT
 export CARGO_TARGET_DIR="$stage/target"
 cargo build --release --locked --manifest-path .voltra/ron-config-src/Cargo.toml
 cargo vendor --locked --manifest-path .voltra/ron-config-src/Cargo.toml /mnt/server/.voltra/ron-config-vendor > /dev/null
 cp "$stage/target/release/voltra-ron-config" .voltra/voltra-ron-config
 chmod 755 .voltra/voltra-ron-config
 printf '%s\\n' "$helper_id" > .voltra/ron-config-build-id
 sha256sum .voltra/voltra-ron-config | cut -d ' ' -f1 > .voltra/ron-config-binary.sha256
else
 echo 'Native RON configuration helper retained.'
fi
python3 .voltra/veloren-install.py
`};
const previous=profiles[path]||{};
profiles[path]={upstream_sha256:entry.sha256,revision:'veloren-weekly-c5024ebf-v1',platforms:['linux/amd64','linux/arm64'],defaults:{memory:4096,disk:8192},setup_steps:[
 'Start from Console after installation. Use a client matching the selected pinned build. Weekly is the reviewed default; the older nightly and ARM64 still need separate runtime acceptance.',
 'Connect to the allocated TCP address. Native UDP queries use the same port by default. Add an allocation before choosing a different query port or public metrics endpoint.',
 'Official authentication remains enabled by default. Offline mode permits unverified identities; use it only on trusted private servers. Native Console admin commands manage administrator roles.',
 'Back up the complete userdata folder. Reinstall preserves worlds, player databases, accounts, administrator lists and native settings. Same-build operator asset overrides are retained; changing build keeps the previous assets/binary under .voltra/veloren-backups.',
 'Normal Stop sends the native shutdown graceful 5 command. Configuration is validated against the actual game in isolated temporary userdata before live files change; invalid native settings stop startup.',
 'Advanced protocol/QUIC settings can be edited through Files. Disable Manage network bindings to keep those operator bindings. Metrics/web are private unless explicitly enabled and allocated.',
],egg,...(previous.verification?{verification:previous.verification,detail:previous.detail}:{})};
fs.writeFileSync(file,JSON.stringify(profiles,null,2)+'\n');console.log('Veloren profile generated; runtime acceptance remains separate.');
