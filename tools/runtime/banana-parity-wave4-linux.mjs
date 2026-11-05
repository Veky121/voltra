// Owned Banana/Craftopia offline suites only. Never starts game payloads.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync, execFileSync} from 'node:child_process';

const docker = args => execFileSync('docker', ['--context', 'desktop-linux', ...args], {encoding:'utf8', windowsHide:true}).trim();
const context = JSON.parse(docker(['context', 'inspect', 'desktop-linux']))[0];
if (context.Endpoints.docker.Host !== 'npipe:////./pipe/dockerDesktopLinuxEngine') throw Error('Wrong Docker engine');
const image = 'sha256:a0f57064cbdcd6285fa45f51237ab0b35ea8ebaed06a1f5973e89e19dfb86704';
docker(['image', 'inspect', image]);
const root = process.cwd();
const suites = [
  {prefix:'banana-wave4', file:'tools/runtime/banana-parity-wave4-test.py', canonical:'internal/panel/game_library/scripts/banana-native-authority.py'},
  {prefix:'craftopia-wave5', file:'tools/runtime/craftopia-parity-wave5-test.py', canonical:'internal/panel/game_library/scripts/craftopia-preflight.py'},
];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
for (const suite of suites) {
  const args = ['--context','desktop-linux','run','--rm','--pull','never','--network','none','--read-only',
    '--memory','256m','--memory-swap','256m','--cpus','1','--tmpfs','/tmp:rw,size=64m',
    '-v',root.replaceAll('\\','/')+':/work:ro','-w','/work','-e','PYTHONDONTWRITEBYTECODE=1',image,
    'python','-B',suite.file];
  const started = Date.now();
  const result = spawnSync('docker', args, {encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4*1024**2});
  const output = (result.stdout || '') + (result.stderr || '');
  const folder = 'artifacts/game-parity-20261029/';
  fs.writeFileSync(folder+suite.prefix+'-linux.log', output);
  const report = {scope:'offline fixtures only; no native game or acquisition',command:['docker',...args],
    image,engine:'desktop-linux npipe:////./pipe/dockerDesktopLinuxEngine',exit_code:result.status,
    elapsed_ms:Date.now()-started,passed:+(output.match(/Ran (\d+) tests?/)?.[1] || 0),
    source:{path:suite.canonical,sha256:hash(suite.canonical)},test:{path:suite.file,sha256:hash(suite.file)},
    network:'none',source_mount:'read-only',memory_mib:256,swap_extra_mib:0,cpus:1,
    actual_shared_publication:true,native_acceptance:false,error:result.error?.message || null};
  fs.writeFileSync(folder+suite.prefix+'-linux.json', JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({suite:suite.prefix,tests:report.passed,exit:report.exit_code,source_sha256:report.source.sha256}));
  if (result.status !== 0 || result.error) process.exit(result.status || 1);
}
