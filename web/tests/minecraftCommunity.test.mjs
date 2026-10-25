import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isMinecraftTemplate, minecraftProjectKey} from '../src/client/minecraftCommunityModel.ts';

test('all pinned Minecraft recipes move into Minecraft without hiding other games', () => {
  const {entries} = JSON.parse(fs.readFileSync(new URL('../../internal/panel/game_library/upstream/catalog.json', import.meta.url)));
  for (const entry of entries) {
    assert.equal(isMinecraftTemplate({category: entry.path.split('/')[0], source: `https://github.com/pterodactyl/game-eggs/blob/revision/${entry.path}`}), entry.path.startsWith('minecraft/'), entry.path);
  }
});

test('project logo matching distinguishes server implementations and proxies', () => {
  assert.equal(minecraftProjectKey('https://example.test/minecraft/java/paper/egg-paper.json'), 'paper');
  assert.equal(minecraftProjectKey('https://example.test/minecraft/java/fabric/egg-fabric.json'), 'fabric');
  assert.equal(minecraftProjectKey('https://example.test/minecraft/proxy/java/velocity/egg-velocity.json'), 'velocity');
  assert.equal(minecraftProjectKey('https://example.test/factorio/egg-factorio.json'), undefined);
});
