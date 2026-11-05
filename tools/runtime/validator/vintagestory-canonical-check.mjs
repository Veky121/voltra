import { resolve } from 'node:path';
import { campaign as h, receipt } from './campaign-session.mjs';
import { hash } from './runner.mjs';
const build = '2163b02c95bb62f8728e37d5ff2f1c4104cd921028badf6c608c2167c5f5e693';
const recipe = 'vintage_story/egg-vintage-story.json';
const root = 'C:/Users/Veky/.t3/projects/pteroclone/ptero-go/artifacts/game-parity-20261029/validator-20261103-vintagestory';
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
export function verifyVintagePrior(ctx, report, kind, pin, frozen) {
  const profile = h.profileFromRuntime(recipe, receipt);
  if (ctx.game.id !== 'vintagestory-canonical' || ctx.build !== build || receipt?.binary_sha256 !== build
    || report.game !== 'vintagestory' || report.build !== build || report.status !== 'PASS' || report.fixture?.recipe !== recipe
    || resolve(pin.path) !== resolve(root, kind === 'native' ? 'lifecycle.json' : 'report.json')
    || hash(JSON.stringify(sorted(profile))) !== frozen?.profileSHA256 || hash(profile.egg.scripts.installation.script) !== frozen?.scriptSHA256
    || report.fixture.install?.canonicalScriptSha256 !== frozen.scriptSHA256 || report.fixture.install.rawExit !== '0'
    || report.fixture.install.callback?.success !== true || !Array.isArray(report.checks) || report.checks.some(c => c.status !== 'PASS')) throw Error('Exact current Vintage native/source report required');
  const required = kind === 'native' ? ['start-ready','settings','saved','reload'] : ['retention-current-stopped-save','canonical-reinstall','reinstall-retained-bytes','reinstall-native-reload'];
  if (required.some(name => report.checks.filter(c => c.name === name).length !== 1)) throw Error('Vintage native report shape differs');
  const evidence = report.checks.find(c => c.name === (kind === 'native' ? 'saved' : 'reinstall-native-reload')).evidence;
  const process = evidence.nativeProcessProof, stop = evidence.nativeStop, disk = kind === 'native' ? evidence : evidence.disk;
  if (process?.fixture !== report.fixture.server?.uuid || !/^[a-f0-9]{64}$/.test(process.containerId ?? '')
    || process.process?.nativeDotnet !== true || !(process.process.pid > 1) || process.process.maxclientsArg !== 17
    || !Number.isFinite(process.startRequestedAt) || Date.parse(process.startedAt) < process.startRequestedAt
    || stop?.Status !== 'exited' || stop.Running !== false || stop.OOMKilled !== false || stop.Dead !== false
    || stop.Pid !== 0 || stop.ExitCode !== 0 || stop.StartedAt !== process.startedAt
    || !Number.isFinite(Date.parse(stop.FinishedAt)) || Date.parse(stop.FinishedAt) < Date.parse(stop.StartedAt)) throw Error('Vintage direct native .NET/clean stop proof missing');
  if (disk?.database !== '/data/Saves/default.vcdbs' || disk.quickCheck !== 'ok' || !(disk.tables > 0)
    || !/^[a-f0-9]{64}$/.test(disk.schemaSHA256 ?? '') || !Array.isArray(disk.hashes)
    || !String(evidence.scope).includes('not a proven world seed')) throw Error('Vintage initialized database scope differs');
  const native = kind === 'native' ? report.checks.find(c => c.name === 'settings').evidence.native : evidence.native;
  if (native?.maxclients?.value !== 17 || native.maxclients.source !== 'native command-line precedence readback') throw Error('Vintage native argv capacity precedence missing');
  if (kind === 'retention') {
    const retained = report.checks.find(c => c.name === 'reinstall-retained-bytes').evidence;
    if (retained.identical !== true || retained.ownershipAndModes !== true || !(retained.files > 0)
      || evidence.sameInitializedSaveSchema !== true || evidence.freshStoppedBaselineRequiredForRetention !== true) throw Error('Vintage retained initialized database proof differs');
  }
}
