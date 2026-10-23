import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const profile=JSON.parse(fs.readFileSync('.local/openttd-compat/profiles.json'))['openttd/egg-open-t-t-d-server.json'];
const names=profile.egg.variables.map(v=>v.env_variable);
for(const name of ['srv_name','srv_advertise','OPENTTD_VERSION','OPENGFX_VERSION','SERVER_VISIBILITY']) assert.ok(names.includes(name),name);
assert.equal(profile.egg.variables.find(v=>v.env_variable==='OPENTTD_VERSION').default_value,'15.3');
assert.equal(profile.egg.variables.find(v=>v.env_variable==='OPENGFX_VERSION').default_value,'8.0');
assert.ok(profile.egg.scripts.installation.script.includes('"$TTD_SHA"'));
assert.ok(profile.egg.scripts.installation.script.includes('"$GFX_SHA"'));
assert.ok(!profile.egg.config.files.includes('SERVER_VISIBILITY'));
const start=fs.readFileSync('internal/panel/game_library/scripts/openttd-start.sh','utf8');
const resolve=fs.readFileSync('internal/panel/game_library/scripts/openttd-resolve.sh','utf8');
const syntax=spawnSync('docker',['run','--rm','-i','--network','none','--memory','128m','alpine:3.23','sh','-n'],{input:profile.egg.scripts.installation.script,encoding:'utf8',timeout:60000});
assert.equal(syntax.status,0,syntax.stderr);
let publisherFixtures='';
if(process.argv.includes('--publisher-metadata')) {
 for(const [category,version,file,expected] of [
  ['openttd','15.3','openttd-15.3-linux-generic-amd64.tar.xz','f49eb25d61b00f8f4d332fee02b530ad75552d1efb8f2bb01e7ca5e6540fe059'],
  ['openttd','13.0-RC2','openttd-13.0-RC2-linux-generic-amd64.tar.xz','d558ee5008e1365be80cda0f6930afbe951ee51e789190fd8063bf8b1bf06021'],
  ['opengfx','8.0','opengfx-8.0-all.zip','43a0c1dabf39cb865394f3a6cc36d4da5c10ecfaaf55652043104806810903be'],
  ['opengfx','7.1','opengfx-7.1-all.zip','928fcf34efd0719a3560cbab6821d71ce686b6315e8825360fba87a7a94d7846'],
 ]) {
  const response=await fetch(`https://cdn.openttd.org/${category}-releases/${version}/manifest.yaml`);
  assert.ok(response.ok); const manifest=await response.text(); assert.ok(manifest.length<1048576);
  publisherFixtures+=`\ncurl() { for manifest; do :; done; cat > "$manifest" <<'PUBLISHER_MANIFEST'\n${manifest}\nPUBLISHER_MANIFEST\n}\ntest "$(resolve_release ${category} ${version} ${file} force-manifest ignored)" = ${expected}\n`;
 }
}
const shell=`set -eu
mkdir -p /tmp/ttd
cd /tmp/ttd
cat > start.sh <<'START'
${start}
START
cat > openttd <<'NATIVE'
#!/bin/sh
printf '%s\\n' "$@" > args
NATIVE
chmod +x openttd
for pair in auto:true:public auto:false:local local:true:local public:false:public invite-only:true:invite-only; do
  visibility=\${pair%%:*}; rest=\${pair#*:}; advertise=\${rest%%:*}; expected=\${rest#*:}
  printf '# operator comment\\n[network]\\nserver_game_type = local\\nmax_clients = 12\\n[gui]\\nautosave_on_exit = true\\n' > openttd.cfg
  SERVER_VISIBILITY="$visibility" srv_advertise="$advertise" sh start.sh
  grep -q "server_game_type = $expected" openttd.cfg
  grep -q '# operator comment' openttd.cfg
  grep -q 'max_clients = 12' openttd.cfg
  test "$(grep -c server_game_type openttd.cfg)" -eq 1
done
if SERVER_VISIBILITY=garbage sh start.sh 2>/dev/null; then exit 1; fi
if SERVER_VISIBILITY=auto srv_advertise=garbage sh start.sh 2>/dev/null; then exit 1; fi
unset SERVER_VISIBILITY srv_advertise
SRV_ADVERTISE=true sh start.sh
grep -q 'server_game_type = public' openttd.cfg
${resolve}
curl() { for manifest; do :; done; printf '%s\\n' '- id: test.tar.xz' '  sha256sum: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$manifest"; }
test "$(resolve_release openttd 15.3 ignored 15.3 pinned)" = pinned
test "$(resolve_release openttd 13.0-RC2 test.tar.xz 15.3 pinned)" = aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
if resolve_release openttd '../escape' test.tar.xz 15.3 pinned; then exit 1; fi
if resolve_release openttd 13.0 missing.tar.xz 15.3 pinned; then exit 1; fi
curl() { for manifest; do :; done; printf '%s\\n' '- id: test.tar.xz' '  sha256sum: bad' > "$manifest"; }
if resolve_release openttd 13.0 test.tar.xz 15.3 pinned; then exit 1; fi
${publisherFixtures}
echo 'OpenTTD compatibility fixtures passed: visibility precedence, legacy case alias, preservation, validation, pinned defaults, manifest exact match and malformed checksum rejection.'
`;
const result=spawnSync('docker',['run','--rm','-i','--network','none','--memory','128m','--cpus','1','alpine:3.23','sh'],{input:shell,encoding:'utf8',timeout:60000});
process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
if(result.error) throw result.error;
assert.equal(result.status,0);
