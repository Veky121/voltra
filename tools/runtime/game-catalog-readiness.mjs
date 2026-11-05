// Read-only source readiness. Never execute installers, imports or game code.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const sha = source => crypto.createHash('sha256').update(source).digest('hex');
const normalized = source => source.replaceAll('\r\n', '\n').trimEnd();

export function literalHeredocs(script) {
  const expression = /cat\s+>\s*(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s]+))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)/g;
  return [...script.matchAll(expression)].map(m => ({file: m[1] || m[2] || m[3], source: m[5]}));
}

export function safeSettingsDocument(file) {
  return typeof file === 'string' && file !== '' && !file.startsWith('/') && !/[\\\x00\r\n{}*?\[\]:$]/.test(file) &&
    !file.split('/').some(part => !part || part === '.' || part === '..' || /^(mod|plugin)/i.test(part));
}

export function declaredDocumentPaths(value) {
  return Array.isArray(value) ? value : value && typeof value === 'object' ? Object.keys(value).map(file => file.replace(/^\//, '')).sort() : [];
}

export function readinessPresent(value) {
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return false; } }
  return typeof value?.done === 'string' ? value.done !== '' : Array.isArray(value?.done) && value.done.length > 0 && value.done.every(item => typeof item === 'string' && item !== '');
}

export function compilePythonModules(modules, python = 'python') {
  const code = 'import json,sys\nerrors=[]\nfor item in json.load(sys.stdin):\n try: compile(item["source"].encode("utf-8"),item["file"],"exec")\n except (SyntaxError,ValueError) as error: errors.append({"recipe":item["recipe"],"file":item["file"],"line":getattr(error,"lineno",None),"error":str(error)})\nprint(json.dumps({"version":sys.version.split()[0],"errors":errors}))';
  const compiled = spawnSync(python, ['-B', '-c', code], {input: JSON.stringify(modules), encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8*1024*1024});
  if (compiled.error || compiled.status !== 0) throw Error('Offline Python compiler unavailable: ' + (compiled.error?.message || compiled.stderr));
  return JSON.parse(compiled.stdout);
}

export function variablePreservation(original = [], current = []) {
  const occurrences = new Map(), reviews = [];
  for (const variable of current) {
    const rows = occurrences.get(variable.env_variable) || [];
    rows.push(variable); occurrences.set(variable.env_variable, rows);
  }
  const seen = new Map(), missing = [];
  for (const variable of original) {
    const key = variable.env_variable, index = seen.get(key) || 0;
    seen.set(key, index + 1);
    const next = occurrences.get(key)?.[index];
    if (!next) { missing.push({environment: key, occurrence: index + 1}); continue; }
    for (const field of ['name', 'description', 'default_value', 'rules', 'user_viewable', 'user_editable', 'field_type']) {
      if (JSON.stringify(variable[field]) !== JSON.stringify(next[field])) reviews.push({environment: key, occurrence: index + 1, field});
    }
  }
  let cursor = 0;
  for (const variable of current) if (variable.env_variable === original[cursor]?.env_variable) cursor++;
  return {missing, original_order_preserved: cursor === original.length, metadata_reviews: reviews};
}

function fs25Entry(root) {
  const source = fs.readFileSync(path.join(root, 'internal/panel/game_fs25.go'), 'utf8');
  const recipe = source.match(/const fs25Path = "([^"]+)"/)?.[1];
  const startup = source.match(/egg\["startup"\] = "([^"]+)"/)?.[1];
  const ready = source.match(/const fs25ReadyPattern = `([^`]+)`/)?.[1];
  if (!recipe || !startup || !ready || !source.includes('fs.WalkDir(fs25Files, "game_library/fs25"')) throw Error('FS25 assembly changed; audit needs source review');
  const base = path.join(root, 'internal/panel/game_library/fs25');
  const original = JSON.parse(fs.readFileSync(path.join(base, 'upstream-egg.json')));
  let script = '#!/bin/bash\nset -euo pipefail\numask 077\ncd /mnt/server\nmkdir -p installer dlc data/mods data/pdlc .voltra/fs25\n';
  const canonical = new Map();
  function walk(folder, prefix = '') {
    for (const entry of fs.readdirSync(folder, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) { walk(path.join(folder, entry.name), relative + '/'); continue; }
      if (relative === 'upstream-egg.json') continue;
      const body = fs.readFileSync(path.join(folder, entry.name));
      const target = '.voltra/fs25/' + relative, delimiter = 'VOLTRA_' + sha(body);
      canonical.set(target, body.toString('utf8'));
      if (relative.includes('/')) script += `mkdir -p '.voltra/fs25/${path.posix.dirname(relative)}'\n`;
      script += `cat > '${target}' <<'${delimiter}'\n${body.toString('utf8')}\n${delimiter}\n`;
    }
  }
  walk(base);
  script += "echo 'FS25 prepared. Start from Console to download and activate your licensed game.'\n";
  return {path: recipe, original, egg: {...original, startup, config: {startup: {done: ready}, stop: '^C'}, scripts: {installation: {script, entrypoint: 'bash'}}}, canonical,
    note: 'FS25 Go assembly modeled read-only from embedded tree/startup/readiness source. Original variable occurrences checked; Go-specific metadata alterations and added controls are outside metadata review.'};
}

export function auditCatalog(root, {python = 'python', bash = 'C:/Program Files/Git/bin/bash.exe'} = {}) {
  const catalogBytes = fs.readFileSync(path.join(root, 'internal/panel/game_library/upstream/catalog.json'));
  const overrideBytes = fs.readFileSync(path.join(root, 'internal/panel/game_library/overrides.json'));
  const catalog = JSON.parse(catalogBytes), profiles = JSON.parse(overrideBytes);
  const scripts = path.join(root, 'internal/panel/game_library/scripts');
  const canonical = new Map(fs.readdirSync(scripts).filter(name => fs.statSync(path.join(scripts, name)).isFile()).map(name => [name.replaceAll('-', '_'), fs.readFileSync(path.join(scripts, name), 'utf8')]));
  for (const [installed, source] of [
    ['minecraft_install.py', 'internal/panel/game_library/minecraft-install.py'],
    ['ddrace_legacy.py', 'internal/panel/game_library/scripts/ddrace-network.py'],
    ['ddrace_console.py', 'internal/panel/game_library/scripts/ddrace-parity-console.py'],
    ['aloft_parity_wave2.py', 'internal/panel/game_library/scripts/aloft-preflight.py'],
    ['archean_parity_wave3.py', 'tools/runtime/archean-parity-wave3.py'],
    ['brickadia_parity_wave3.py', 'tools/runtime/brickadia-parity-wave3.py'],
  ]) canonical.set(installed, fs.readFileSync(path.join(root, source), 'utf8'));
  const fs25 = fs25Entry(root);
  const entries = [...catalog.entries.map(entry => ({path: entry.path, original: entry.egg, egg: profiles[entry.path]?.egg || entry.egg, profile: profiles[entry.path]})), fs25];
  const findings = [], reviews = [], modules = [], shells = new Map(), rows = [], provenance = [];
  let exact = 0, cosmetic = 0, pythonCount = 0, helperCount = 0;
  const fail = (recipe, check, details = {}) => findings.push({recipe, check, ...details});
  const addShell = (script, recipe, file, entrypoint) => {
    const identity = sha(script);
    if (!shells.has(identity)) shells.set(identity, {script, targets: [], entrypoints: new Set()});
    shells.get(identity).targets.push({recipe, file}); shells.get(identity).entrypoints.add(entrypoint);
  };
  for (const entry of entries) {
    const recipe = entry.path, egg = entry.egg, script = egg.scripts?.installation?.script || '';
    if (!script) fail(recipe, 'missing_installer');
    const embedded = literalHeredocs(script), emitted = new Set(embedded.map(item => item.file.replace(/^\/home\/container\//, '')));
    const duplicates = new Set();
    for (const item of embedded) {
      helperCount++;
      if (duplicates.has(item.file)) fail(recipe, 'duplicate_emitted_file', {file: item.file});
      duplicates.add(item.file);
      const name = path.posix.basename(item.file).replaceAll('-', '_');
      const expected = entry.canonical?.get(item.file) ?? canonical.get(name);
      if (expected !== undefined) {
        if (item.source === expected || item.source === expected.replace(/\n$/, '')) exact++;
        else if (normalized(item.source) === normalized(expected)) cosmetic++;
        else fail(recipe, 'stale_embedded_helper', {file: item.file, helper: name, embedded_sha256: sha(item.source), canonical_sha256: sha(expected)});
      } else if (/\.(py|sh|mjs|lua)$/.test(item.file)) provenance.push({recipe, file: item.file, note: 'Inline/generated helper has no standalone canonical filename match; syntax checked, source provenance needs generator review.'});
      if (item.file.endsWith('.py')) { modules.push({recipe, file: item.file, source: item.source}); pythonCount++; }
      if (item.file.endsWith('.sh')) addShell(item.source, recipe, item.file, 'embedded shell');
    }
    for (const match of String(egg.startup || '').matchAll(/(?:\/home\/container\/)?(\.voltra\/[A-Za-z0-9_./-]+\.(?:py|mjs|sh|lua))\b/g)) {
      if (!emitted.has(match[1])) fail(recipe, 'startup_helper_not_literal_emitted', {file: match[1], note: 'Review dynamic/copy/image-provided generation before treating this as missing at runtime.'});
    }
    const variables = variablePreservation(entry.original.variables, egg.variables);
    for (const missing of variables.missing) fail(recipe, 'missing_original_variable', missing);
    if (!variables.original_order_preserved) fail(recipe, 'original_variable_order_changed');
    if (variables.metadata_reviews.length) reviews.push({recipe, changes: variables.metadata_reviews});
    const documents = declaredDocumentPaths(entry.profile?.settings_documents);
    for (const file of documents) if (!safeSettingsDocument(file)) fail(recipe, 'unsafe_declared_document', {file});
    if (!readinessPresent(egg.config?.startup)) fail(recipe, 'missing_readiness');
    if (!egg.config?.stop || typeof egg.config.stop !== 'string') fail(recipe, 'missing_stop');
    const shell = String(egg.scripts?.installation?.entrypoint || '');
    addShell(script, recipe, null, shell);
    rows.push({recipe, embedded_files: embedded.length, embedded_python: embedded.filter(e => e.file.endsWith('.py')).length, variable_occurrences: egg.variables?.length || 0, declared_documents: documents.length, installer_entrypoint: shell, ...(entry.note ? {note: entry.note} : {})});
  }
  const pythonResult = compilePythonModules(modules, python);
  for (const error of pythonResult.errors) { const {recipe, ...details} = error; fail(recipe, 'embedded_python_syntax', details); }
  let shellChecked = 0;
  for (const entry of shells.values()) {
    const checked = spawnSync(bash, ['--noprofile', '--norc', '-n', '-s'], {input: entry.script, encoding: 'utf8', windowsHide: true, env: {...process.env, BASH_ENV: '', ENV: ''}, timeout: 10000, maxBuffer: 1024*1024});
    if (checked.error) throw Error('Offline Bash parser unavailable: ' + checked.error.message);
    shellChecked += entry.targets.length;
    if (checked.status !== 0) for (const {recipe, file} of entry.targets) fail(recipe, file ? 'embedded_shell_syntax' : 'installer_bash_syntax', {file, error: checked.stderr.trim().slice(0, 1200)});
  }
  const failuresByRecipe = Object.fromEntries([...new Set(findings.map(f => f.recipe))].sort().map(recipe => [recipe, findings.filter(f => f.recipe === recipe)]));
  const counts = findings.reduce((counts, failure) => ({...counts, [failure.check]: (counts[failure.check] || 0) + 1}), {});
  return {schema_version: 1, scope: 'Deterministic offline source checks only; no imports/installers/game execution, network, Docker, build, activation or native promotion.',
    inputs: {catalog_sha256: sha(catalogBytes), overrides_sha256: sha(overrideBytes)},
    overrides_unchanged_during_audit: sha(fs.readFileSync(path.join(root, 'internal/panel/game_library/overrides.json'))) === sha(overrideBytes),
    checked: {entries: entries.length, upstream: catalog.entries.length, go_added: 1, helper_heredocs: helperCount, exact_canonical_matches: exact, newline_only_canonical_matches: cosmetic, embedded_python_modules: pythonCount, python_version: pythonResult.version, installer_shell_scripts: entries.length, installer_and_embedded_shell_scripts: shellChecked, unique_shell_scripts: shells.size},
    failures: {recipes: Object.keys(failuresByRecipe).length, total: findings.length, counts, by_recipe: failuresByRecipe},
    variable_metadata_reviews: reviews,
    inline_helper_provenance_reviews: provenance,
    limitations: ['Bash -n checks installer syntax only. Nine ash entrypoints require their native ash parser for strict shell compatibility.', 'Literal cat heredocs only; generated/copied/image-provided startup helpers are review findings, not proven runtime absence.', 'Canonical helper comparisons permit normalized CRLF and trailing blank lines only; exact and newline-only counts are separate.', 'FS25 uses a read-only model of current Go assembly; original variable metadata alterations are not reproduced.', 'Managed Steam bridge runtime and typed API exposure require their independent integration/native gates.'],
    entries: rows};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const report = auditCatalog(root);
  const output = path.join(root, 'artifacts/game-parity-20261029/catalog-readiness.json');
  if (fs.existsSync(output)) {
    const previous = JSON.parse(fs.readFileSync(output));
    const historical = previous.prior_actionable_findings || Object.values(previous.failures?.by_recipe || {}).flat().filter(failure => ['stale_embedded_helper', 'embedded_python_syntax'].includes(failure.check));
    report.prior_actionable_findings = historical;
  }
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({output, checked: report.checked, failures: {recipes: report.failures.recipes, total: report.failures.total, counts: report.failures.counts}}, null, 2));
  if (report.failures.total) process.exitCode = 1;
}
