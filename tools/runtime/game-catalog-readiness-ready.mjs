import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

// Real publisher-program log lines captured on the publisher's community forum.
// This establishes the network-listener event, not player/world acceptance.
export const empyrionReadyPattern = String.raw`^[0-9]{2}-[0-9]{2}[:.][0-9]{2}[:.][0-9]{2}\.[0-9]{3}(?: [0-9]{2}_[0-9]{2})? -LOG- (?:Unity network|Server) started listening on port [1-9][0-9]{0,4}\s*$`;

export function stageEmpyrionReadiness(profile) {
  const next = structuredClone(profile);
  next.egg.config.startup = JSON.stringify({done: 'regex:' + empyrionReadyPattern, strip_ansi: true});
  next.setup_steps.push('Online marker matches the native game listener startup log, never a timer, Wine diagnostic or Telnet banner. Actual current-version log delivery and player/world acceptance remain native gates.');
  const comparison = structuredClone(next);
  comparison.egg.config.startup = profile.egg.config.startup;
  comparison.setup_steps = profile.setup_steps;
  assert.deepEqual(comparison, profile, 'Readiness staging altered unrelated metadata');
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const recipe = 'empyrion/egg-empyrion--galactic-survival.json';
  const profiles = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
  const output = 'artifacts/game-parity-20261029/catalog-readiness-empyrion-profile.json';
  fs.writeFileSync(output, JSON.stringify({[recipe]: stageEmpyrionReadiness(profiles[recipe])}, null, 2) + '\n');
  console.log(JSON.stringify({output, recipe, native_acceptance: false}));
}
