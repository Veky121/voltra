import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

test('Nightingale can restage integrated controls and resource defaults without duplicate wrappers',()=>{
  const canonicalFile='internal/panel/game_library/overrides.json';
  const canonicalBytes=fs.readFileSync(canonicalFile);
  const recipe='Nightingale/egg-nightingale.json';
  const original=JSON.parse(canonicalBytes)[recipe];
  const staged='artifacts/game-parity-20261029/nightingale-owner-20261030/profile.json';
  const stage=()=>{
    const result=spawnSync(process.execPath,['tools/runtime/nightingale-owner-stage.mjs'],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    return fs.readFileSync(staged);
  };
  const first=stage(),second=stage();
  assert.deepEqual(first,second,'Repeated staging changed candidate bytes');
  assert.deepEqual(fs.readFileSync(canonicalFile),canonicalBytes,'Staging changed canonical source');
  const fragment=JSON.parse(second);
  assert.deepEqual(Object.keys(fragment),[recipe]);
  const profile=fragment[recipe];
  assert.deepEqual(profile.egg.variables,original.egg.variables);
  assert.deepEqual(profile.defaults,original.defaults);
  const script=profile.egg.scripts.installation.script;
  assert.equal(script.split(/\r?\n/).filter(line=>line==='python3 .voltra/nightingale-owner.py install').length,1);
  assert.equal(script.match(/cat > \.voltra\/nightingale-owner\.py <<'VOLTRA_SOURCE'/g)?.length,1);
  assert.equal(profile.setup_steps.length,new Set(profile.setup_steps).size);
});
