// Root-owned integration of disjoint worker profiles. Dry run unless --apply.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const allowDowngrade = args.includes('--allow-verification-downgrade');
const files = args.filter(arg => !['--apply', '--allow-verification-downgrade'].includes(arg));
if (!files.length) throw Error('Usage: node tools/runtime/merge-game-profiles.mjs staged.json [...] [--apply]');
const target = 'internal/panel/game_library/overrides.json';
const original = fs.readFileSync(target);
const merged = JSON.parse(original);
const catalog = new Map(JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json')).entries.map(entry => [entry.path, entry]));
const claimed = new Set();
const changes = [];
for (const file of files) {
  const staged = JSON.parse(fs.readFileSync(file));
  if (!staged || Array.isArray(staged) || typeof staged !== 'object') throw Error('Expected profile map: ' + file);
  for (const [key, profile] of Object.entries(staged)) {
    if (claimed.has(key)) throw Error('Multiple workers staged the same recipe: ' + key);
    claimed.add(key);
    const entry = catalog.get(key);
    if (!entry || profile.upstream_sha256 !== entry.sha256) throw Error('Catalog digest mismatch: ' + key);
    if (!profile.revision || !profile.egg?.startup || !profile.egg?.scripts?.installation?.script) throw Error('Incomplete profile: ' + key);
    const upstreamVars = new Set(entry.egg.variables.map(variable => variable.env_variable));
    const newVars = new Set(profile.egg.variables.map(variable => variable.env_variable));
    for (const name of upstreamVars) if (!newVars.has(name)) throw Error('Missing original variable ' + name + ': ' + key);
    for (const name of upstreamVars) {
      const originalCount = entry.egg.variables.filter(variable => variable.env_variable === name).length;
      const stagedCount = profile.egg.variables.filter(variable => variable.env_variable === name).length;
      if (stagedCount < originalCount) throw Error('Missing duplicate original variable ' + name + ': ' + key);
    }
    // Verification promotion is a separate root review of native evidence.
    if (profile.verification === 'runtime_verified' && merged[key]?.verification !== 'runtime_verified') throw Error('Native evidence must be reviewed before verification promotion: ' + key);
    const previous = merged[key];
    if (!allowDowngrade && previous?.revision === profile.revision &&
        ['runtime_verified', 'runtime_partial', 'runtime_failed'].includes(previous.verification) &&
        previous.verification !== profile.verification) {
      throw Error('Staged profile would overwrite reviewed runtime evidence; regenerate against current overrides or explicitly review --allow-verification-downgrade: ' + key);
    }
    changes.push({path: key, previous_revision: merged[key]?.revision ?? null, revision: profile.revision});
    merged[key] = profile;
  }
}
if (apply) {
  const scratch = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(scratch, JSON.stringify(merged, null, 2) + '\n', {flag: 'wx'});
    if (!fs.readFileSync(target).equals(original)) throw Error('Overrides changed during integration; rerun against current source.');
    fs.renameSync(scratch, target);
  } finally {
    if (fs.existsSync(scratch)) fs.unlinkSync(scratch);
  }
}
console.log(JSON.stringify({applied: apply, files: files.map(file => path.relative(process.cwd(), file)), changes}, null, 2));
