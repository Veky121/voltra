import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./merge-game-profiles.mjs',import.meta.url));
test('stale stages cannot erase reviewed evidence or promote unreviewed native results',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'voltra-profile-merge-'));
 try {
  const root=path.join(dir,'internal/panel/game_library');
  fs.mkdirSync(path.join(root,'upstream'),{recursive:true});
  const profile={upstream_sha256:'fixture',revision:'v1',verification:'runtime_verified',egg:{startup:'run',variables:[{env_variable:'ORIGINAL'}],scripts:{installation:{script:'install'}}}};
  const target=path.join(root,'overrides.json');
  fs.writeFileSync(target,JSON.stringify({recipe:profile}));
  fs.writeFileSync(path.join(root,'upstream/catalog.json'),JSON.stringify({entries:[{path:'recipe',sha256:'fixture',egg:profile.egg}]}));
  const stage=path.join(dir,'stage.json');
  const run=(p,args=[])=>{fs.writeFileSync(stage,JSON.stringify({recipe:p}));return spawnSync(process.execPath,[script,stage,...args],{cwd:dir,encoding:'utf8'});};
  const original=fs.readFileSync(target,'utf8');
  const stale=run({...profile,verification:'implemented'},['--apply']);
  assert.notEqual(stale.status,0);assert.match(stale.stderr,/overwrite reviewed runtime evidence/);
  assert.equal(fs.readFileSync(target,'utf8'),original);
  assert.equal(run(profile,['--apply']).status,0);
  assert.equal(run({...profile,verification:'runtime_partial'},['--apply','--allow-verification-downgrade']).status,0);
  const promotion=run(profile,['--apply']);
  assert.notEqual(promotion.status,0);assert.match(promotion.stderr,/Native evidence must be reviewed/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
