import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {
  emptyInstallProgress,
  installProgressDetail,
  installStages,
  isInstallMarker,
  readInstallHistory,
  readInstallOutput,
  readInstallRuntime,
} from '../src/features/console/installProgress.ts';

const parse = (...lines) => lines.reduce(readInstallOutput, emptyInstallProgress);
const ids = model => model.stages.map(stage => stage.id);
const active = model => model.stages.at(-1);

const fixtures = JSON.parse(
  readFileSync(new URL('../../internal/panel/testdata/console-install-progress.json', import.meta.url), 'utf8')
);
for (const {name, events, phase, runtime, stages} of fixtures) {
  test(`shared installer fixture: ${name}`, () => {
    const model = events.reduce((state, {event, line}) => readInstallHistory(state, event, line), emptyInstallProgress);
    assert.deepEqual(installStages(model, phase, runtime), stages);
  });
}
test('installer byte and item counts format locally', () => {
  assert.equal(installProgressDetail({value: 37, completed: 1048576, total: 3145728, unit: 'bytes'}), '1.0 of 3.0 MB');
  assert.equal(installProgressDetail({value: 37, completed: 0, total: 10}), '0 of 10');
  assert.equal(installProgressDetail({value: 37}), undefined);
});

test('SteamCMD preallocates, downloads, and verifies using measured progress', () => {
  const steam = parse(
    'Connecting anonymously to Steam Public...OK',
    'Update state (0x5) preallocating, progress: 25.10 (263192 / 1048576)',
    'Update state (0x61) downloading, progress: 52.30 (548405 / 1048576)'
  );
  assert.deepEqual(ids(steam), ['prepare', 'download']);
  assert.equal(active(steam).progress.value, 52.3);
  const verify = readInstallOutput(steam, 'Update state (0x81) verifying update, progress: 91.72 (961754 / 1048576)');
  assert.deepEqual(ids(verify), ['prepare', 'download', 'verify']);
  assert.equal(active(verify).progress.value, 91.72);
  const downloaded = readInstallOutput(verify, "Success! App '258550' fully installed.");
  assert.equal(downloaded.outcome, undefined);
  assert.equal(active(downloaded).progress.value, 100);
});

test('Forge library downloads remain in the loader stage', () => {
  const forge = parse(
    'Downloading Minecraft server',
    'java -jar forge-1.20.1-47.4.0-installer.jar --installServer',
    'Downloading library net.minecraftforge:installertools:1.4.1',
    'Installing mods for the server',
    'Writing server.properties',
    'Installation complete.'
  );
  assert.deepEqual(ids(forge), ['download', 'loader', 'content', 'configure']);
  assert.equal(forge.outcome, 'complete');
  assert.deepEqual(
    installStages(forge, 'installed', 'offline').map(stage => stage.state),
    ['done', 'done', 'done', 'done', 'waiting']
  );
});

test('curl, checksum, and unzip produce three stages and use curl received percent', () => {
  const curl = parse(
    'curl -fL https://github.com/example/game/releases/download/v1/server.zip',
    '% Total    % Received % Xferd  Average Speed   Time    Time     Time  Current',
    '100  127M   47 60.3M    0     0  8231k      0  0:00:15  0:00:07  0:00:08 8153k',
    'sha256sum --check checksums.txt',
    'Archive:  server.zip',
    '  inflating: bin/server'
  );
  assert.deepEqual(ids(curl), ['download', 'verify', 'extract']);
  assert.equal(curl.stages[0].progress.value, 47);
});

test('apt, apk, dnf, pip, npm, dotnet, and Wine output can identify environment setup', () => {
  const lines = [
    'Get:1 http://deb.debian.org/debian bookworm InRelease [151 kB]',
    'Reading package lists...',
    'Setting up ca-certificates (20230311+deb12u1) ...',
    '(2/8) Installing libcurl (8.5.0-r0)',
    'Dependencies resolved.',
    'pip install -r requirements.txt',
    'Downloading requests-2.32.4-py3-none-any.whl (64 kB)',
    'npm ci',
    'dotnet restore',
    'Creating Wine prefix',
  ];
  for (const line of lines) assert.deepEqual(ids(parse(line)), ['prepare'], line);
  assert.deepEqual(ids(parse(...lines, 'Downloading server archive')), ['prepare', 'download']);
});

test('progress redraws update one stage across carriage returns and separate events', () => {
  const frames = [
    '###                         14.1%',
    '########                    43.8%',
    '8192K .......... .......... 71%  29.0M 1s',
    'server.zip  85%[================>   ]  12.7M/s',
    'server.zip 100%[===================>]  13.0M/s',
  ];
  const batch = parse(frames.join('\r') + '\r');
  assert.deepEqual(batch, parse(...frames));
  assert.deepEqual(ids(batch), ['download']);
  assert.equal(active(batch).progress.value, 100);
  assert.equal(active(parse('━━━━━━━━━━╸━━━━━━ 1.4/2.8 MB 1.0 MB/s eta 0:00:01')).progress.value, 50);
  assert.equal(active(parse('[========>   ] 62% npm reify')).progress.value, 62);
});

test('explicit phases and counts take precedence over nested commands and invalid markers', () => {
  const marked = parse(
    '[voltra:install] begin',
    '\x1b[32m[voltra:stage] loader-download\x1b[0m',
    'curl -fL https://example.org/forge-installer.jar',
    '[voltra:stage] loader',
    'unzip loader.jar',
    '[voltra:stage] pack-extract',
    '[voltra:progress] 44 12/27',
    '[voltra:progress] 90 50/27',
    '[voltra:progress] 672',
    '[voltra:stage] https://example.org/secret'
  );
  assert.deepEqual(ids(marked), ['loader-download', 'loader', 'pack-extract']);
  assert.deepEqual(active(marked).progress, {value: 44, completed: 12, total: 27});
  assert.equal(isInstallMarker('\x1b[32m[voltra:stage] prepare\x1b[0m'), true);
  assert.equal(isInstallMarker('echo "[voltra:stage] prepare"'), false);
  assert.equal(readInstallOutput(marked, '[voltra:install] complete').outcome, 'complete');
});

test('failed installs leave the current stage failed', () => {
  const failed = parse(
    'Downloading server bundle',
    'curl: (23) Failure writing output to destination',
    'A cleanup hook removed the partial archive.',
    'No space left on device',
    'Minecraft installation failed: output could not be written'
  );
  assert.equal(failed.outcome, 'failed');
  assert.deepEqual(
    installStages(failed, 'failed', 'offline').map(stage => stage.state),
    ['failed']
  );
  const transient = parse('Downloading server archive', 'curl: (28) Transfer timed out. Retrying.');
  assert.equal(transient.outcome, undefined);
  assert.equal(installStages(transient, 'failed', 'offline')[0].state, 'failed');
});

test('unknown noise leaves the current stage unchanged and never starts a stage', () => {
  assert.equal(parse('hello world', 'Dependency vendor reports 77% uptime'), emptyInstallProgress);
  const started = parse('Installing BepInEx');
  assert.equal(readInstallOutput(started, 'Loading build metadata\r\n...'), started);
  assert.equal(readInstallHistory(started, 'console output', 'Downloading server assets'), started);
});

test('saved installer entries rebuild a first start and a new attempt clears old stages', () => {
  const stage = readInstallHistory(emptyInstallProgress, 'install output', 'Saving to: server.zip');
  const starting = readInstallHistory(
    stage,
    'panel message',
    '\x1b[94m[Voltra]: Server is starting. Preparing the container and launching the process.\x1b[0m'
  );
  assert.equal(active({stages: installStages(starting, 'installed', 'starting')}).state, 'running');
  const crashed = readInstallRuntime(starting, 'offline');
  assert.equal(installStages(crashed, 'installed', 'offline').at(-1).state, 'failed');
  const running = readInstallHistory(starting, 'panel message', '[Voltra]: Server entered the running state.');
  assert.equal(running.runtime, 'running');
  assert.deepEqual(ids(readInstallHistory(running, 'install output', 'Installing Oxide')), ['loader']);
  assert.deepEqual(ids(readInstallOutput(starting, '[voltra:install] begin')), []);
});
