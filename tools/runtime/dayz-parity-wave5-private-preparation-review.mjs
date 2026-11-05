// Reorder-only proposal. Never changes canonical profiles or the private guard.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const base='artifacts/game-parity-20261029',target='internal/panel/game_library/overrides.json';
const current=JSON.parse(fs.readFileSync(target));
const recipe='banana_shooter/egg-banana-shooter.json',profile=structuredClone(current[recipe]);
const script=profile.egg.scripts.installation.script;
const command='python3 .voltra/light_games_next_install.py banana';
const header="cat > .voltra/banana_native_authority.py <<'VOLTRA_BANANA_AUTHORITY_WAVE4'\n";
const delimiter='VOLTRA_BANANA_AUTHORITY_WAVE4';
assert.equal(script.split(command).length,2,'Reviewed downloader must occur exactly once');
assert.equal(script.split(header).length,2,'Exactly one wrapper heredoc required');
const start=script.indexOf(header),wrapper=script.slice(start);
assert.ok(wrapper.trimEnd().endsWith('\n'+delimiter),'Wrapper must be the final intact heredoc');
const before=script.slice(0,start).trimEnd();
assert.ok(before.endsWith(command),'Unexpected shell steps between downloader and wrapper');
const prefix=before.slice(0,-command.length);
const reordered=prefix+wrapper.trimEnd()+'\n'+command+'\n';
assert.ok(reordered.trimEnd().endsWith('\n'+command));
assert.equal(reordered.split('\n'+command).length,2);
assert.equal(reordered.slice(reordered.indexOf(header),reordered.lastIndexOf('\n'+command)).trimEnd(),wrapper.trimEnd(),'Wrapper bytes changed');
profile.egg.scripts.installation.script=reordered;
const unchanged=structuredClone(profile);unchanged.egg.scripts.installation.script=script;
assert.deepEqual(unchanged,current[recipe],'Only installer statement order may change');
const pending=base+'/dayz-wave5-private-preparation.pending.json';
fs.writeFileSync(pending,JSON.stringify({[recipe]:profile},null,2)+'\n');
const full=structuredClone(current);full[recipe]=profile;
const fullPending=base+'/dayz-wave5-private-preparation-overrides.pending.json';
fs.writeFileSync(fullPending,JSON.stringify(full,null,2)+'\n');
const overlay=base+'/dayz-wave5-private-preparation-overlay.pending.json';
fs.writeFileSync(overlay,JSON.stringify({Replace:{[path.resolve(target)]:path.resolve(fullPending)}},null,2)+'\n');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
fs.writeFileSync(base+'/dayz-wave5-private-preparation-review.pending.json',JSON.stringify({
  cause:'Banana wrapper heredoc appended after the reviewed final downloader. This breaks the existing terminal-command guard. DayZ is not a private preparation descriptor.',
  fix:'Move the exact unchanged wrapper heredoc before the unique terminal downloader. No private guard, descriptor, app policy, credential rule, updater rule or binding logic changes.',
  recipe,pending,overlay,original_installer_sha256:hash(script),proposed_installer_sha256:hash(reordered),wrapper_block_sha256:hash(wrapper.trimEnd()),original_rows:profile.egg.variables.length,
  static_checks:{original_has_terminal_command:false,proposed_has_unique_terminal_command:true,all_wrapper_bytes_retained:true,all_other_profile_values_identical:true,canonical_changes:false},
  pin_note:'No literal expected-hash pin exists in privatePreparationDescriptor. Content-derived recipe and prepared egg identities automatically change from the reordered script. Never substitute a blind hash update or weaken suffix/occurrence checks.',
  safety:'Prepared recipe now retains every helper heredoc, removes only the exact final anonymous downloader and emits its existing preparation message. AUTO_UPDATE=0, rejection/stripping of ordinary credentials, game-token preservation and app2406780 private binding remain unchanged and covered by existing focused tests.',
  concurrency:'Regenerate this proposal from current canonical profiles if another owner changes the Banana helper before root merge; do not overwrite newer alias fixes with stale staged bytes.'
},null,2)+'\n');
console.log(JSON.stringify({pending,overlay,old_script_sha256:hash(script),new_script_sha256:hash(reordered),rows:profile.egg.variables.length}));
