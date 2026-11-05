import fs from 'node:fs';
import crypto from 'node:crypto';
const recipe = 'spacestation_14/egg-spacestation14.json';
const base = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
if (base.revision !== 'ss14-file-authority-source-v2') throw Error('Review changed SS14 base before staging');
const profile = structuredClone(base);
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.find(e => e.path === recipe).egg.variables;
if (JSON.stringify(profile.egg.variables.slice(0, original.length)) !== JSON.stringify(original)) throw Error('Original ordered controls changed');
let script = profile.egg.scripts.installation.script;
const hashes = {};
// Refresh every existing embed from current source, without changing shared helpers.
script = script.replace(/cat > \.voltra\/([a-z0-9_]+)\.py <<'([^']+)'\r?\n[\s\S]*?\r?\n\2(?=\r?\n)/g, (block, name, delimiter) => {
  const path = `internal/panel/game_library/scripts/${name.replaceAll('_', '-')}.py`;
  const source = fs.readFileSync(path, 'utf8');
  if (source.split(/\r?\n/).includes(delimiter)) throw Error('Heredoc delimiter collision');
  hashes[path] = crypto.createHash('sha256').update(source).digest('hex');
  return `cat > .voltra/${name}.py <<'${delimiter}'\n${source.replace(/\r\n/g, '\n').trimEnd()}\n${delimiter}`;
});
if (!hashes['internal/panel/game_library/scripts/ss14-parity.py'] || !script.includes('python3 .voltra/ss14_parity.py install')) throw Error('Missing SS14 installer');
profile.egg.scripts.installation.script = script;
profile.revision = 'ss14-file-authority-source-v3';
profile.verification = 'not_verified';
profile.detail = 'Unapplied SS14 source candidate; prior native acceptance does not attest revised embeds.';
const directory = 'artifacts/game-parity-20261029/ss14-runtime-reviewed';
fs.mkdirSync(directory, {recursive:true});
fs.writeFileSync(`${directory}/candidate.json`, JSON.stringify({[recipe]:profile}, null, 2)+'\n');
fs.writeFileSync(`${directory}/stage.json`, JSON.stringify({recipe, base_revision:base.revision, base_sha256:crypto.createHash('sha256').update(JSON.stringify(base)).digest('hex'), helper_sha256:hashes, applied:false}, null, 2)+'\n');
console.log('Staged one unapplied SS14 candidate with current helper embeds');

