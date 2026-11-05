import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runtime,verifyRuntime,profileFromRuntime,digest,activeLease} from './campaign-native-20261029.mjs';
const recipe='openttd/egg-open-t-t-d-server.json',owner='openttd_native_banana',dir=path.join(runtime,'banana-wave4-openttd');
const state=JSON.parse(fs.readFileSync(path.join(dir,'state.json')));activeLease(state.lease.lease_id,owner);
const receipt=await verifyRuntime(),profile=profileFromRuntime(recipe,receipt);
const marker="cat > .voltra/openttd-start.sh <<'VOLTRA_OPENTTD_START'\n";
const privateCandidate=process.argv.includes('--private-candidate');
const launcher=privateCandidate?fs.readFileSync('artifacts/game-parity-20261029/banana-wave4-openttd-start.sh.pending','utf8'):profile.egg.scripts.installation.script.split(marker)[1]?.split('VOLTRA_OPENTTD_START\n')[0];
assert.ok(launcher);if(!privateCandidate)assert.equal(launcher.trimEnd(),fs.readFileSync('internal/panel/game_library/scripts/openttd-start.sh','utf8').trimEnd());
const shell=`set -eu
test "$(cat /sys/fs/cgroup/memory.max)" = 268435456
test "$(cat /sys/fs/cgroup/memory.swap.max)" = 0
test "$(cat /sys/fs/cgroup/cpu.max)" = '100000 100000'
mkdir -p /tmp/ttd
cd /tmp/ttd
cat > start.sh <<'VOLTRA_TEST_LAUNCHER'
${launcher}
VOLTRA_TEST_LAUNCHER
sh -n start.sh
cat > openttd <<'VOLTRA_FAKE_NATIVE'
#!/bin/sh
printf '%s\\n' "$@" > /tmp/ttd/args
test -e private.cfg || printf 'fixture native personal data' > private.cfg
test -e secrets.cfg || printf 'fixture native credentials' > secrets.cfg
VOLTRA_FAKE_NATIVE
chmod +x openttd
for pair in auto:true:public auto:false:local local:true:local public:false:public invite-only:true:invite-only; do
 visibility=\${pair%%:*}; rest=\${pair#*:}; advertise=\${rest%%:*}; expected=\${rest#*:}
 printf '# operator comment\\n[network]\\nserver_game_type = local\\nmax_clients = 12\\n[operator_extra]\\nunknown = keep\\n' > openttd.cfg
 printf 'unknown operator save bytes' > operator.sav
 before=$(sha256sum operator.sav)
 SERVER_VISIBILITY="$visibility" srv_advertise="$advertise" sh start.sh
 grep -q "server_game_type = $expected" openttd.cfg
 grep -q '# operator comment' openttd.cfg
 grep -q 'max_clients = 12' openttd.cfg
 grep -q 'unknown = keep' openttd.cfg
 test "$(grep -c server_game_type openttd.cfg)" = 1
 test "$(sha256sum operator.sav)" = "$before"
done
before=$(sha256sum openttd.cfg)
if SERVER_VISIBILITY=garbage sh start.sh; then exit 1; fi
test "$(sha256sum openttd.cfg)" = "$before"
${privateCandidate?`test "$(stat -c '%a' private.cfg)" = 600
test "$(stat -c '%a' secrets.cfg)" = 600
chmod 644 private.cfg secrets.cfg
SERVER_VISIBILITY=local sh start.sh
test "$(stat -c '%a' private.cfg)" = 600
test "$(stat -c '%a' secrets.cfg)" = 600
before=$(sha256sum openttd.cfg)
mv private.cfg private-real.cfg
ln -s private-real.cfg private.cfg
if SERVER_VISIBILITY=public sh start.sh; then exit 1; fi
test "$(sha256sum openttd.cfg)" = "$before"
rm private.cfg
mv private-real.cfg private.cfg
printf 'stale native temp' > secrets.cfg.new
chmod 644 secrets.cfg.new
SERVER_VISIBILITY=local sh start.sh
test "$(stat -c '%a' secrets.cfg.new)" = 600
before=$(sha256sum openttd.cfg)
mv secrets.cfg.new stale-real.cfg
ln -s stale-real.cfg secrets.cfg.new
if SERVER_VISIBILITY=public sh start.sh; then exit 1; fi
test "$(sha256sum openttd.cfg)" = "$before"
rm secrets.cfg.new
`:''}
if SERVER_VISIBILITY=auto srv_advertise=garbage sh start.sh; then exit 1; fi
test "$(sha256sum openttd.cfg)" = "$before"
mv openttd.cfg original.cfg
ln -s original.cfg openttd.cfg
if SERVER_VISIBILITY=local sh start.sh; then exit 1; fi
test "$(sha256sum original.cfg | cut -d' ' -f1)" = "$(printf '%s' "$before" | cut -d' ' -f1)"
rm openttd.cfg
mv original.cfg openttd.cfg
mkdir -p /home/container/.local/share/openttd/save/autosave
printf 'fixture save' > /home/container/.local/share/openttd/save/autosave/exit.sav
SERVER_VISIBILITY=local sh start.sh
grep -q '/home/container/.local/share/openttd/save/autosave/exit.sav' args
echo 'PASS: five visibility modes, comments/unknown/save preservation, invalid preflight refusal, symlink refusal, saved-world precedence; fake child only.'
`;
const result=spawnSync('docker',['--context','desktop-linux','run','--rm','-i','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,exec,size=16m','--tmpfs','/home/container:rw,size=1m','alpine:latest','sh'],{input:shell,encoding:'utf8',windowsHide:true,timeout:60000});
const log=path.join(dir,privateCandidate?'offline-private-candidate.log':'offline.log');fs.writeFileSync(log,result.stdout+result.stderr);
assert.equal(result.status,0,result.stdout+result.stderr);
const proof={at:new Date().toISOString(),kind:'offline_fixture',private_candidate:privateCandidate,real_game_started:false,launcher_sha256:digest(launcher),exit:result.status,network:'none',container_root_readonly:true,memory_mib:256,extra_swap:0,cpu:1,checks:privateCandidate?15:10,log};
fs.writeFileSync('artifacts/game-parity-20261029/banana-wave4-openttd-'+(privateCandidate?'private-offline':'offline')+'.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
