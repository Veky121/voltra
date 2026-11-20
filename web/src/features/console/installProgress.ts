import {stripConsoleControls} from './consoleOutput.ts';
import type {TerminalProgressState} from '../../ui/terminalProgressModel.ts';

const labels = {
  prepare: 'Setting up environment',
  download: 'Downloading server',
  'loader-download': 'Downloading loader',
  'pack-download': 'Downloading modpack',
  'pack-extract': 'Extracting modpack files',
  verify: 'Verifying files',
  extract: 'Extracting files',
  loader: 'Installing loader',
  content: 'Installing mods and plugins',
  configure: 'Configuring server',
  install: 'Installing server',
  start: 'Starting server',
} as const;

type StageID = keyof typeof labels;
type Progress = {value: number; completed?: number; total?: number; unit?: 'bytes'};

export function installProgressDetail(progress?: Progress): string | undefined {
  if (progress?.completed === undefined || progress.total === undefined) return;
  if (progress.unit !== 'bytes') return `${progress.completed} of ${progress.total}`;
  const mb = (bytes: number) => (bytes / 1024 ** 2).toFixed(1);
  return `${mb(progress.completed)} of ${mb(progress.total)} MB`;
}

export const installAttemptBoundary = '[Voltra]: Installer attempt started.';

export function isInstallBegin(line: string): boolean {
  return stripConsoleControls(line).trim() === '[voltra:install] begin';
}
export type InstallStage = {
  id: StageID;
  label: string;
  state: TerminalProgressState;
  progress?: Progress;
};

type InstallProgress = {
  stages: InstallStage[];
  marked: boolean;
  outcome?: 'complete' | 'failed';
  runtime?: 'starting' | 'running' | 'failed';
};

export const emptyInstallProgress: InstallProgress = {stages: [], marked: false};

const rules: [StageID, RegExp][] = [
  [
    'prepare',
    /^(?:reading package lists|building dependency tree|(?:get|hit|ign):\d+\s|fetch https?:\/\/\S+\/APKINDEX|\(\d+\/\d+\) installing|setting up\s|collecting\s|installing collected packages|downloading \S+\.whl\b|last metadata expiration check|dependencies resolved|determining projects to restore|wine: created the configuration directory)|\b(?:apt(?:-get)?|apk|dnf|yum|pip3?|npm|dotnet)\s+(?:install|add|update|restore|ci)\b|\b(?:wineboot|(?:wine|proton)\s+prefix)\b/i,
  ],
  [
    'content',
    /\b(?:workshop_download_item|downloading workshop item)\b|\b(?:installing|downloading|updating|copying|extracting)\s+(?:(?:the|server)\s+)?(?:mods?\b|plug-?ins?\b|mod\s*pack\b|workshop\b)/i,
  ],
  [
    'loader',
    /\b(?:java\s+.*(?:forge|fabric|quilt).*installer.*\.jar|--installServer|(?:installing|running)\s+(?:the\s+)?(?:neo\s?forge|forge|fabric|quilt|bepinex|oxide|txadmin)\b|minecraftforge installer)\b/i,
  ],
  [
    'verify',
    /\b(?:verifying|validating|checking)\s+(?:install|files|update|download|checksum|sha\d+)|\b(?:sha\d+sum|md5sum)\s+(?:-c|--check)\b/i,
  ],
  [
    'extract',
    /^(?:archive:|inflating:|extracting(?:\s|:)|creating:\s+.*\/)|\b(?:unzip\s|tar\s+(?:-[a-z]*x|x[a-z]*)|7z\s+[ex]\s)/i,
  ],
  [
    'configure',
    /\b(?:writing|generating|creating|updating|copying)\s+(?:the\s+)?(?:server config(?:uration)?|config(?:uration| files?)?|server\.properties|eula(?:\.txt)?)\b|\beula=true\b/i,
  ],
  [
    'download',
    /^(?:downloading\b|--\d{4}-\d\d-\d\d\s.*https?:\/\/|saving to:|% total\s+% received)|\b(?:curl|wget)\s+(?:-\S+\s+)*https?:\/\/|https?:\/\/github\.com\/\S+\/releases\/download\//i,
  ],
];

function stage(id: StageID, state: TerminalProgressState, progress?: Progress): InstallStage {
  return {id, label: labels[id], state, ...(progress ? {progress} : {})};
}

function selectStage(model: InstallProgress, id: StageID): InstallProgress {
  if (model.stages.at(-1)?.id === id) return model;
  // Keep one row per phase. Some installers loop through download, verify and
  // extract several times. The most recently entered phase goes last.
  const stages = model.stages.filter(entry => entry.id !== id);
  return {
    ...model,
    stages: [
      ...stages.map(entry => (entry.state === 'running' ? {...entry, state: 'done' as const} : entry)),
      stage(id, 'running'),
    ],
  };
}

function updateProgress(model: InstallProgress, progress: Progress): InstallProgress {
  const current = model.stages.at(-1);
  if (!current) return model;
  const last = current.progress;
  if (
    last &&
    last.value === progress.value &&
    last.completed === progress.completed &&
    last.total === progress.total &&
    last.unit === progress.unit
  )
    return model;
  return {...model, stages: [...model.stages.slice(0, -1), {...current, progress}]};
}

function percentage(value: string | undefined): number | undefined {
  if (!value) return;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : undefined;
}

function progressCounts(done?: string, total?: string, unit?: string): Omit<Progress, 'value'> | undefined {
  const completed = Number(done);
  const count = Number(total);
  if (
    Number.isSafeInteger(completed) &&
    Number.isSafeInteger(count) &&
    count > 0 &&
    completed >= 0 &&
    completed <= count
  )
    return {completed, total: count, ...(unit ? {unit: 'bytes'} : {})};
}

function toolProgress(line: string): {id?: StageID; progress?: Progress} | undefined {
  const steam =
    /^update state \(0x[\da-f]+\)\s+(downloading|verifying|validating|preallocating|reconfiguring|committing)\b(?:[^,]*,\s*progress:\s*(\d+(?:\.\d+)?))?/i.exec(
      line
    );
  if (steam) {
    const phase = steam[1].toLowerCase();
    const id = phase === 'downloading' ? 'download' : /^(?:verifying|validating)$/.test(phase) ? 'verify' : 'prepare';
    const value = percentage(steam[2]);
    return {id, progress: value === undefined ? undefined : {value}};
  }
  const npm = /^\[(?:[=.#> -]+)\]\s*(\d+)%\s+\b(?:npm|reify|idealTree|buildDeps)\b/i.exec(line);
  const value = percentage(npm?.[1]);
  if (value !== undefined) return {id: 'prepare', progress: {value}};
  // curl's -# and standard meters, wget's bar/dots, and package-manager bars.
  const download =
    /^(?:[#= >]+\s*(\d+(?:\.\d+)?)%|(?:\d+[KMGT]?\s+)?(?:\[[<>=+ .-]+\]|\.{2,}[ .]*)\s*(\d+)%|\d{1,3}\s+\S+\s+(\d{1,3})\s+\S+\s+\d{1,3}\s+\S+\s+\S+\s+\S+\s+(?:--:--:--|\d+:\d+:\d+)|\S+\s+(\d+)%\[[<>=+ .-]+\])/.exec(
      line
    );
  if (download) {
    const value = percentage(download[1] ?? download[2] ?? download[3] ?? download[4]);
    return {id: 'download', progress: value === undefined ? undefined : {value}};
  }
  const packages = /^(?:\S+\s+)?[━╸╺─]+\s+(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*([kMGT]?B)\b/i.exec(line);
  if (packages) {
    const value = percentage(String((Number(packages[1]) / Number(packages[2])) * 100));
    return {id: 'prepare', progress: value === undefined ? undefined : {value}};
  }
}

/** The progress overlay summarizes redraw frames. Keep them in the raw export. */
export function isInstallRedraw(line: string): boolean {
  return toolProgress(stripConsoleControls(line).trim())?.progress !== undefined;
}

export function isInstallMarker(line: string): boolean {
  return /^\[voltra:(?:install|stage|progress)\](?:\s|$)/.test(stripConsoleControls(line).trimStart());
}

/** Reduce a saved or live installer line. CR redraws only update the current phase. */
export function readInstallOutput(model: InstallProgress, output: string): InstallProgress {
  for (const frame of stripConsoleControls(output).split(/[\r\n]+/)) {
    const line = frame.trim();
    if (!line) continue;
    if (line === '[voltra:install] begin') {
      model = {...emptyInstallProgress, marked: true};
      continue;
    }
    if (model.runtime === 'running') model = emptyInstallProgress;
    if (isInstallMarker(line)) {
      if (line === '[voltra:install] complete') model = {...model, outcome: 'complete'};
      else if (line === '[voltra:install] failed') model = {...model, outcome: 'failed'};
      else if (line.startsWith('[voltra:stage] ')) {
        const id = line.slice('[voltra:stage] '.length);
        if (Object.hasOwn(labels, id) && id !== 'start' && id !== 'install')
          model = selectStage({...model, marked: true}, id as StageID);
      } else if (model.marked && line.length <= 64) {
        const match = /^\[voltra:progress\] (\d+(?:\.\d+)?)(?: (\d+)\/(\d+)( bytes)?)?$/.exec(line);
        const value = percentage(match?.[1]);
        const counted = progressCounts(match?.[2], match?.[3], match?.[4]);
        if (value !== undefined && (!match?.[2] || counted)) model = updateProgress(model, {value, ...counted});
      }
      continue;
    }
    const failed =
      /^(?:\w+\s+)?install(?:ation)?\s+(?:has\s+)?failed\b|^installer exited (?:with )?(?:code|status) [1-9]/i.test(
        line
      );
    if (failed) {
      model = {...model, outcome: 'failed'};
      continue;
    }
    if (
      !model.marked &&
      /^(?:server )?install(?:ation)? (?:complete[d.]?|finished)(?:[!.]|$)|^success!\s+app '\d+' fully installed\./i.test(
        line
      )
    ) {
      // SteamCMD only confirms its app download. Egg post-install steps can still run.
      model = /^success!/i.test(line)
        ? updateProgress(selectStage(model, model.stages.at(-1)?.id ?? 'download'), {value: 100})
        : {...model, outcome: 'complete'};
      continue;
    }
    if (model.marked) continue;
    const measured = toolProgress(line);
    const current = model.stages.at(-1)?.id;
    const phase = measured?.id ?? rules.find(([, pattern]) => pattern.test(line))?.[0];
    // Library and mod downloads can be nested inside an installer.
    if (phase && !(phase === 'download' && (current === 'loader' || current === 'content')))
      model = selectStage(model, phase);
    if (measured?.progress) model = updateProgress(model, measured.progress);
  }
  return model;
}

export function readInstallRuntime(model: InstallProgress, state: string): InstallProgress {
  if (model.runtime === 'running' || state === model.runtime) return model;
  if (state === 'starting' || state === 'running') return {...model, runtime: state};
  if (state === 'failed' || (state === 'offline' && model.runtime === 'starting')) return {...model, runtime: 'failed'};
  return model;
}

/** Only collector-written status entries can close a replayed install. */
export function readInstallHistory(model: InstallProgress, event: string, line: string): InstallProgress {
  if (event === 'install output') return readInstallOutput(model, line);
  if (event !== 'panel message') return model;
  const message = stripConsoleControls(line);
  if (message === installAttemptBoundary) return emptyInstallProgress;
  if (/\[Voltra\]: (?:Server entered the running state|Current server state: running)\.$/.test(message))
    return readInstallRuntime(model, 'running');
  if (
    /\[Voltra\]: (?:Server is starting\. Preparing the container and launching the process|Current server state: starting)\.$/.test(
      message
    )
  )
    return readInstallRuntime(model, 'starting');
  if (message.endsWith('[Voltra]: Server went offline during startup. Check the output above.'))
    return readInstallRuntime(model, 'failed');
  return model;
}

export function installStages(
  model: InstallProgress,
  phase: 'installing' | 'installed' | 'failed',
  runtime: string
): InstallStage[] {
  let stages = model.stages;
  const failed = phase === 'failed';
  const complete = phase === 'installed';
  if (!stages.length) stages = [stage('install', 'running')];
  stages = stages.map((entry, index) =>
    index === stages.length - 1 ? {...entry, state: failed ? 'failed' : complete ? 'done' : 'running'} : entry
  );
  if (failed) return stages;
  const startup = runtime === 'starting' ? 'running' : model.runtime === 'failed' ? 'failed' : 'waiting';
  // Installed and stopped: the next step is the user's, not a wait.
  if (complete && startup === 'waiting') return [...stages, {...stage('start', 'waiting'), label: 'Ready to start'}];
  return [...stages, stage('start', complete ? startup : 'waiting')];
}
