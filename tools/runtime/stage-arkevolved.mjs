import fs from 'node:fs';
import {createHash} from 'node:crypto';
const output = 'artifacts/game-parity-20261029/arkevolved-resume-wave4';
const key = 'ark_survival_evolved/egg-ark--survival-evolved.json';
const current = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json', 'utf8'));
const profile = structuredClone(current[key]);
if (!profile?.egg || !profile.settings_documents) throw Error('Current ASE metadata missing');
function embed(script, target, source) {
  const pattern = new RegExp(`(cat > \\.voltra/${target} <<'([^']+)'\\r?\\n)([\\s\\S]*?)(\\r?\\n\\2(?:\\r?\\n|$))`);
  let count = 0;
  const updated = script.replace(pattern, (_, start, marker, old, end) => {
    count++;
    return start + source.trimEnd() + end;
  });
  if (count !== 1) throw Error(`Missing unique ${target} embed`);
  return updated;
}
let script = profile.egg.scripts.installation.script;
const helpers = [['arkevolved.py', 'arkevolved.py'], ['native_config.py', 'native-config.py'], ['ark_family.py', 'ark-family.py'], ['steam_template.py', 'steam-template.py'], ['bundle_debian_python.py', 'bundle-debian-python.py']];
const hashes = {};
for (const [target, source] of helpers) {
  hashes[source] = createHash('sha256').update(fs.readFileSync('internal/panel/game_library/scripts/' + source)).digest('hex');
  script = embed(script, target, fs.readFileSync('internal/panel/game_library/scripts/' + source, 'utf8'));
}
profile.egg.scripts.installation.script = script;
profile.revision = 'arkevolved-resume-wave4-20261030-v1';
profile.detail = 'ASE exact-byte backup/newline preservation and native identity authority; offline fixtures only, unserved candidate.';
profile.setup_steps = profile.setup_steps.map(step => step.replace('Identity, passwords, MaxPlayers, mods and RCON remain managed by original startup controls.', 'Native SessionName, ServerPassword and ServerAdminPassword remain authoritative after initial seeding from original startup controls. MaxPlayers, mods, RCON and allocated listener ports remain controlled.'));
const original = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json', 'utf8')).entries.find(e => e.path === key).egg.variables;
if (original.length !== 13 || JSON.stringify(profile.egg.variables.slice(0, 13)) !== JSON.stringify(original)) throw Error('Original ordered controls/defaults/permissions changed');
fs.mkdirSync(output, {recursive: true});
fs.writeFileSync(output + '/profile.json', JSON.stringify({[key]: profile}, null, 2) + '\n');
fs.writeFileSync(output + '/helper-hashes.json', JSON.stringify(hashes, null, 2) + '\n');
console.log('Staged sole ASE recipe, current five helpers and exact original 13 controls; canonical unchanged.');
