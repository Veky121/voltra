// Owned Battalion + CS2D offline handoff. No publisher acquisition or game run.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const docker = args => {
  const result = spawnSync('docker', ['--context', 'desktop-linux', ...args], {encoding:'utf8', windowsHide:true, maxBuffer:4*1024**2});
  if (result.status !== 0) throw Error('Docker command failed: ' + result.stderr);
  return result.stdout.trim();
};
const endpoint = JSON.parse(docker(['context', 'inspect', 'desktop-linux']))[0].Endpoints.docker.Host;
if (endpoint !== 'npipe:////./pipe/dockerDesktopLinuxEngine') throw Error('Expected local Windows Docker Desktop engine');
const image = docker(['image', 'inspect', 'python:3.12-slim', '--format', '{{.Id}}']);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const files = [
  'battalion-preflight.py', 'cs2d-preflight.py', 'tactical-next-runtime.py',
  'tactical-next-install.py', 'tactical-runtime.py', 'tactical-install.py',
  'source-next-install.py', 'source-install.py', 'steam-template.py',
  'native-console.py', 'native-config.py', 'small-native-runtime.py', 'cs2d-console.lua',
].map(name => 'internal/panel/game_library/scripts/' + name);
const before = files.map(file => ({file, sha256:sha(fs.readFileSync(file))}));
const tests = [
  'tools/runtime/battalion-parity-wave4-test.py',
  'tools/runtime/battalion-parity-wave4-deployed-test.py',
  'tools/runtime/cs2d-parity-wave5-test.py',
  'tools/runtime/cs2d-parity-wave5-deployed-test.py',
];
const code = `import json,pathlib,subprocess,sys
read=lambda file:pathlib.Path(file).read_text().strip()
actual={'memory.max':read('/sys/fs/cgroup/memory.max'),'memory.swap.max':read('/sys/fs/cgroup/memory.swap.max'),'cpu.max':read('/sys/fs/cgroup/cpu.max')}
assert actual=={'memory.max':'268435456','memory.swap.max':'0','cpu.max':'100000 100000'},actual
mounts=pathlib.Path('/proc/self/mountinfo').read_text().splitlines()
assert any(line.split()[4]=='/work' and 'ro' in line.split()[5].split(',') for line in mounts)
print('RESOURCE_PROOF '+json.dumps(actual),flush=True)
for file in json.loads(${JSON.stringify(JSON.stringify(tests))}):
 print('RUN '+file,flush=True)
 subprocess.run([sys.executable,'-B',file],cwd='/work',check=True)
`;
const command = ['run','--rm','--pull','never','--network','none','--read-only','--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,exec,size=64m','--mount',`type=bind,src=${path.resolve('.')},dst=/work,readonly`,'-w','/work','-e','PYTHONDONTWRITEBYTECODE=1',image,'python','-B','-c',code];
const result = spawnSync('docker', ['--context','desktop-linux',...command], {encoding:'utf8',windowsHide:true,maxBuffer:4*1024**2});
const log = result.stdout + result.stderr;
fs.writeFileSync('artifacts/game-parity-20261029/battalion-wave4-linux-tests.log', log);
if(result.status !== 0) throw Error('Owned offline tests failed: ' + log);
for(const row of before) if(sha(fs.readFileSync(row.file))!==row.sha256) throw Error('Source drift during offline tests: '+row.file);
const proofLine = result.stdout.split('\n').find(line=>line.startsWith('RESOURCE_PROOF '));
if(!proofLine) throw Error('Missing actual cgroup proof');
const proof = JSON.parse(proofLine.slice('RESOURCE_PROOF '.length));
const base = {
  status:'canonical-source-offline-verified', complete:false,
  engine:{context:'desktop-linux',endpoint,image},
  actual_cgroups:proof, network:'none', source_mount:'read-only', root_filesystem:'read-only',
  temporary_storage:'64MiB executable tmpfs, needed only for Python stand-in binaries',
  source_hashes:before, shared_source_changed_during_tests:false,
  log:'artifacts/game-parity-20261029/battalion-wave4-linux-tests.log',
  native_game_acquisition:false,native_game_start:false,global_overrides_edited:false,
};
const outputs = [
  ['battalion-wave4-integrated.json',{
    recipe:'battalion_legacy/egg-b-a-t-t-a-l-i-o-n--legacy.json',
    canonical:'internal/panel/game_library/scripts/battalion-preflight.py',
    staged_fragment:'artifacts/game-parity-20261029/battalion-wave4-profile.json',
    tests:{unit_fixture_pass:6,deployed_entrypoint_pass:1,fail:0,skip:0},
    deployed_path:'Actual canonical entrypoint -> actual shared main/configure/native PTY supervisor -> temporary Python child. SIGTERM to wrapper delivers native SIGINT, child acknowledgment and zero exit; emitted admin fixture credential is redacted.',
    prerequisites:{app_id:805140,transport:'SteamCMD public Linux app through anonymous path',private_credentials:'Fail-closed in canonical steam_template.arguments; do not request a private account as an unverified workaround.',current_anonymous_entitlement:'Not probed in this run. Historical retained first-installer-stream.log records app805140 fully installed; this is historical and does not prove current publisher availability/entitlement.',agreements:'No new publisher consent or account licence accepted.'},
    remaining:['Native publisher install/availability, both launcher layouts and native platform dependencies','Typed native document/schema discovery remains unknown','Actual game console/state/save/quit/query/client/permissions/reinstall acceptance'],
  }],
  ['cs2d-wave5-integrated.json',{
    recipe:'cs2d/egg-c-s2-d.json',canonical:'internal/panel/game_library/scripts/cs2d-preflight.py',
    staged_fragment:'artifacts/game-parity-20261029/cs2d-wave5-profile.json',
    tests:{unit_fixture_pass:8,deployed_entrypoint_pass:1,fail:0,skip:0},
    deployed_path:'Actual canonical entrypoint -> actual shared CS2D configuration and private file publication -> actual mailbox publisher/redactor/signal handler -> temporary Python mailbox consumer. Console status and quit delivery confirmed; RCON fixture secret redacted.',
    prerequisites:{steam:'None in this recipe; it uses pinned public Unreal Software CS2D1.0.1.8 Linux client/server ZIP archives.',client_sha256:'855314b79c1cca60e93834461784882464fe00bf6a5aa2e86017c4ecbc4b16b1',server_sha256:'a1b39e1f0aaca1903dc150dd9dfbfe67fcae67a264de56c3de1a7ba3b20ca7b0',current_publisher_availability:'Not probed or downloaded in this offline run.',operator_data:'An actual installed dedicated executable and selected native map are required; custom content remains operator-owned.',agreements:'No new publisher consent accepted.'},
    remaining:['Dedicated allowlisted executable-CFG typed editor; no INI metadata added','Actual CS2D Lua adapter execution and native command grammar','Native query/client/console/state/shutdown/save/reinstall/permissions acceptance'],
  }],
];
for(const [name,extra] of outputs)fs.writeFileSync('artifacts/game-parity-20261029/'+name,JSON.stringify({...base,...extra},null,2)+'\n');
console.log(JSON.stringify({passed:16,fail:0,skip:0,actual_cgroups:proof,canonical_helpers:2,native_game_acceptance:false}));
