import test from 'node:test';
import assert from 'node:assert/strict';
import {isMinecraftModpackRecipe} from './catalog-policy.mjs';

test('pack providers and dedicated Technic packs are excluded', () => {
  for (const path of ['minecraft/java/curseforge/egg-curse-forge-generic.json', 'minecraft/java/modrinth/egg-modrinth-generic.json', 'minecraft/java/ftb/egg-ftb-installer.json', 'minecraft/java/technic/Tekkit/egg-tekkit.json']) assert.equal(isMinecraftModpackRecipe(path), true, path);
});

test('custom Minecraft servers and other games remain available', () => {
  for (const path of ['minecraft/java/forge/egg-forge.json', 'minecraft/java/fabric/egg-fabric.json', 'minecraft/java/mohist/egg-mohist.json', 'minecraft/bedrock/nukkit/egg-nukkit.json', 'factorio/egg-factorio.json']) assert.equal(isMinecraftModpackRecipe(path), false, path);
});
