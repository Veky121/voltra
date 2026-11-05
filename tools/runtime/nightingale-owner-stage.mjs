import fs from 'node:fs';
import crypto from 'node:crypto';
const key = 'Nightingale/egg-nightingale.json';
const source = 'internal/panel/game_library/scripts/';
const out = 'artifacts/game-parity-20261029/nightingale-owner-20261030';
fs.mkdirSync(out, {recursive:true});
const profile = structuredClone(JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[key]);
const hashes = {};
let script = profile.egg.scripts.installation.script;
script = script.replace(/cat > (\S+) <<'VOLTRA_SOURCE'\r?\n([\s\S]*?)\r?\nVOLTRA_SOURCE/g, (block, target) => {
  const name = target.split('/').at(-1).replaceAll('_', '-');
  const path = source + name;
  if (!fs.existsSync(path)) throw Error('Unresolved embedded source: ' + target);
  const body = fs.readFileSync(path, 'utf8');
  hashes[path] = crypto.createHash('sha256').update(body).digest('hex');
  return `cat > ${target} <<'VOLTRA_SOURCE'\n${body}\nVOLTRA_SOURCE`;
});
const wrapper = fs.readFileSync(source+'nightingale-owner.py', 'utf8');
hashes[source+'nightingale-owner.py'] = crypto.createHash('sha256').update(wrapper).digest('hex');
const install = 'python3 .voltra/fantasy_survival_servers.py install nightingale';
const wrappedInstall = 'python3 .voltra/nightingale-owner.py install';
const commands = script.split(/\r?\n/);
if (commands.includes(install)) {
  if (commands.filter(line => line === install).length !== 1 || commands.includes(wrappedInstall)) throw Error('Ambiguous Nightingale install dispatch');
  script = script.replace(install, () => `cat > .voltra/nightingale-owner.py <<'VOLTRA_SOURCE'\n${wrapper}\nVOLTRA_SOURCE\n${wrappedInstall}`);
} else if (commands.filter(line => line === wrappedInstall).length !== 1 || !script.includes("cat > .voltra/nightingale-owner.py <<'VOLTRA_SOURCE'")) {
  throw Error('Reviewed Nightingale install dispatch missing');
}
profile.egg.scripts.installation.script = script;
profile.egg.startup = profile.egg.startup.replace('.voltra/fantasy_survival_servers.py run nightingale', '.voltra/nightingale-owner.py run');
profile.revision = 'nightingale-owner-preflight-stdout-v1';
profile.detail = 'Source-only scalar preflight and publisher-documented stdout logging. Native delivery/readiness remain blocked by rejected activation; no native promotion.';
const setupStep = 'Publisher dedicated-server manual confirms anonymous app 3796810, Linux/Windows, UDP game port 1024-65535 and graceful Control-C. JSON stdout logging enabled; native rendering and readiness must be verified after authorized integration.';
if (!profile.setup_steps.includes(setupStep)) profile.setup_steps.push(setupStep);
fs.writeFileSync(out+'/profile.json', JSON.stringify({[key]:profile},null,2)+'\n');
fs.writeFileSync(out+'/embeds.json', JSON.stringify(hashes,null,2)+'\n');
console.log(JSON.stringify({profile:out+'/profile.json',embeds:hashes},null,2));
