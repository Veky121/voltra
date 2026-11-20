import test from 'node:test';
import assert from 'node:assert/strict';
import {plainSettingNote, settingCopy, settingMatches} from '../src/features/server-settings/gameSettingCopy.ts';

const field = (key, extra = {}) => ({key, label: key, type: 'text', value: '', ...extra});

test('every Quick setup field the panel offers has a plain label and one sentence', () => {
  // The fields game_quick_setup.go offers for each guided game.
  const offered = {
    minecraft: [
      'motd',
      'max-players',
      'gamemode',
      'difficulty',
      'pvp',
      'white-list',
      'view-distance',
      'simulation-distance',
      'spawn-protection',
      'allow-flight',
    ],
    palworld: [
      'ServerName',
      'ServerDescription',
      'ServerPassword',
      'AdminPassword',
      'ServerPlayerMaxNum',
      'ExpRate',
      'CollectionDropRate',
      'DeathPenalty',
      'bIsUseBackupSaveData',
    ],
    '7days': [
      'ServerName',
      'ServerDescription',
      'ServerPassword',
      'ServerMaxPlayerCount',
      'GameDifficulty',
      'DayNightLength',
      'DayLightLength',
      'BloodMoonFrequency',
      'LootAbundance',
    ],
    valheim: ['name', 'password', 'world', 'public'],
  };
  for (const [game, keys] of Object.entries(offered))
    for (const key of keys) {
      const copy = settingCopy(field(key), game);
      assert.ok(copy.description, `${game} ${key}`);
      assert.match(copy.description, /^[A-Z].*\.$/, `${game} ${key}: one sentence`);
      assert.equal(copy.description.split(/(?<=\.)\s/).length, 1, `${game} ${key}: one sentence`);
      assert.doesNotMatch(
        copy.description,
        /native|authority|env|variable|MiB|property|config file/i,
        `${game} ${key}: no jargon`
      );
      assert.notEqual(copy.label, key, `${game} ${key}: label is not the raw key`);
    }
});

test('the game picks its own wording when a name means something else elsewhere', () => {
  assert.match(settingCopy(field('motd'), 'minecraft').description, /multiplayer list/);
  assert.match(settingCopy(field('motd'), 'zandronum').description, /when they join/);
  // A password inside a section of a larger file is not the join password.
  assert.equal(settingCopy(field('/database/password'), 'mta').description, undefined);
  assert.match(
    settingCopy(field('/Script/Pal.PalGameWorldSettings/OptionSettings/ServerPassword'), 'palworld').description,
    /players enter to join/
  );
});

test('rules and defaults go in Details, with the saved name last', () => {
  const view = settingCopy(field('view-distance', {type: 'number', min: 2, max: 32}), 'minecraft');
  assert.equal(view.label, 'View distance');
  assert.deepEqual(view.details, ['Allowed: 2 to 32.', 'Game default: 10.', 'Saved as view-distance.']);
  const rate = settingCopy(field('ExpRate', {type: 'number', min: 0.1, max: 20}), 'palworld-native');
  assert.ok(rate.details.includes('1 is the normal rate.'));
  assert.ok(!settingCopy(field('sv_tickrate', {type: 'number'}), 'tf2').details.includes('1 is the normal rate.'));
  assert.ok(settingCopy(field('AdminPassword', {required: true}), 'palworld').details.includes('Required.'));
  assert.equal(
    settingCopy(field('/Script/Pal.PalGameWorldSettings/OptionSettings/ExpRate'), 'palworld').details.at(-1),
    'Saved as Script/Pal.PalGameWorldSettings/OptionSettings/ExpRate.'
  );
});

test('panel notes are reworded for players and kept as Details', () => {
  assert.equal(plainSettingNote('Existing native host value; restart required.'), 'Takes effect after a restart.');
  assert.equal(
    plainSettingNote('Existing native value only. Requires restart; current game-version support is unverified.'),
    'Takes effect after a restart; not yet tested with the current game version.'
  );
  assert.equal(
    plainSettingNote(
      'Applies only when creating a new custom-mode save; ignored when loading an existing save. Current game-version support is unverified.'
    ),
    'Applies only when creating a new custom save; ignored when loading an existing save. Not yet tested with the current game version.'
  );
  const copy = settingCopy(field('/GameSettings/Foo', {help: 'Existing native host value; restart required.'}), 'sons');
  assert.equal(copy.details[0], 'Takes effect after a restart.');
});

test('search finds a setting by its label, its sentence or its saved name', () => {
  assert.ok(settingMatches(field('view-distance'), 'view distance', 'minecraft'));
  assert.ok(settingMatches(field('view-distance'), 'far players', 'minecraft'));
  assert.ok(settingMatches(field('view-distance'), 'view-distance', 'minecraft'));
  assert.ok(settingMatches(field('view-distance'), '', 'minecraft'));
  assert.ok(!settingMatches(field('view-distance'), 'password', 'minecraft'));
});
