import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {templateVariableControl} from '../src/client/gameTemplateModel.ts';

test('Luanti recipe uses existing masked, conditional and bounded setup controls', () => {
  const profile=JSON.parse(fs.readFileSync(new URL('../../internal/panel/game_library/overrides.json',import.meta.url)))['minetest/egg-minetest.json'];
  const variable=key=>profile.egg.variables.find(v=>v.env_variable===key);
  assert.equal(templateVariableControl(variable('SERVER_PASSWORD')).secret,true);
  assert.equal(templateVariableControl(variable('SERVER_ADMIN_PASSWORD')).secret,true);
  for(const key of ['COMMUNITY_GAME_NAME','COMMUNITY_GAME_AUTOR']){
    assert.equal(templateVariableControl(variable(key),{COMMUNITY_DOWNLOAD:'1'}).required,true);
    assert.equal(templateVariableControl(variable(key),{COMMUNITY_DOWNLOAD:'0'}).required,false);
  }
  const players=templateVariableControl(variable('SERVER_MAX_USERS'));
  assert.equal(players.numeric,true);assert.equal(players.minimum,1);assert.equal(players.maximum,65535);
  assert.deepEqual(templateVariableControl(variable('SERVER_ANNOUNCE')).choices,['true','false']);
  assert.deepEqual(profile.platforms,['linux/amd64']);
});
