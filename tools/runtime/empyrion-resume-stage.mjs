import fs from 'node:fs';
const recipe='empyrion/egg-empyrion--galactic-survival.json';
const baseline=JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'))[recipe];
const next=structuredClone(baseline),source=fs.readFileSync('internal/panel/game_library/scripts/empyrion-console.py','utf8').trimEnd();
const marker='VOLTRA_EMPYRION_RESUME_CONSOLE';
// The specialized helper is the effective implementation. Do not accumulate
// obsolete generic/specialized overwrites on repeated staging.
next.egg.scripts.installation.script=next.egg.scripts.installation.script.replace(/cat > \.voltra\/space-survival-console\.py <<'([^']+)'\n[\s\S]*?\n\1\n/g,'').trimEnd();
next.egg.scripts.installation.script += `\n\ncat > .voltra/space-survival-console.py <<'${marker}'\n${source}\n${marker}\n`;
fs.writeFileSync(process.argv[2]||'artifacts/game-parity-20261029/empyrion-resume-profile.json',JSON.stringify({[recipe]:next},null,2)+'\n');
console.log('Exact per-game fragment staged; canonical untouched');
