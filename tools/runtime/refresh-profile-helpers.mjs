// Refresh explicitly selected embedded helpers without rebuilding recipe metadata.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function refreshHelpers(profiles, sources) {
  const result = structuredClone(profiles), changes = [];
  for (const [recipe, profile] of Object.entries(result)) {
    const installation = profile.egg.scripts.installation;
    installation.script = installation.script.replace(
      /(cat\s+>\s*([^\s]+\.py)\s+<<'([^']+)'\r?\n)([\s\S]*?)(\r?\n\3(?:\r?\n|$))/g,
      (whole, start, target, delimiter, embedded, end) => {
        const name = path.posix.basename(target).slice(0, -3).replaceAll('-', '_');
        if (!sources.has(name)) return whole;
        // The delimiter contributes one newline. Retain any additional source
        // newlines so exact-source checks and installed provenance agree.
        const source = sources.get(name).replaceAll('\r\n', '\n').replace(/\n$/, '');
        if (source.split('\n').includes(delimiter)) throw Error(`Heredoc delimiter collision: ${name}`);
        if (embedded.replaceAll('\r\n', '\n') === source) return whole;
        changes.push({recipe, module: name});
        return start + source + end;
      });
  }
  return {profiles: result, changes};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const modules = process.argv.slice(2).filter(v => v !== '--apply');
  if (!modules.length || modules.some(v => !/^[a-z][a-z0-9_]*$/.test(v))) throw Error('Specify helper module names; --apply is optional');
  const sources = new Map(modules.map(name => [name, fs.readFileSync(`internal/panel/game_library/scripts/${name.replaceAll('_', '-')}.py`, 'utf8')]));
  const file = 'internal/panel/game_library/overrides.json', original = fs.readFileSync(file, 'utf8');
  const result = refreshHelpers(JSON.parse(original), sources);
  if (process.argv.includes('--apply') && result.changes.length) {
    if (fs.readFileSync(file, 'utf8') !== original) throw Error('Profiles changed during refresh');
    const temporary = file + `.refresh-${process.pid}`;
    fs.writeFileSync(temporary, JSON.stringify(result.profiles, null, 2) + '\n');
    fs.renameSync(temporary, file);
  }
  console.log(JSON.stringify({applied: process.argv.includes('--apply'), changes: result.changes}, null, 2));
}
