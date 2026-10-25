import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupGameCatalog, familyMatches, templateFamilyID} from '../src/client/gameFamiliesModel.ts';

const catalog = JSON.parse(readFileSync(new URL('../../internal/panel/game_library/upstream/catalog.json', import.meta.url))).entries.map(entry => ({
  id: entry.path, name: entry.egg.name, description: entry.egg.description ?? '',
  category: entry.path.split('/')[0], source: `https://github.com/pterodactyl/game-eggs/blob/pinned/${entry.path}`,
  available: true, verification: 'runtime_unverified', detail: '',
}));
const family = (id, games = catalog, steam = []) => groupGameCatalog(games, steam).find(group => group.id === id);

test('all pinned recipes stay reachable once, with Minecraft remaining in its own flow', () => {
  const groups = groupGameCatalog(catalog, []);
  const targets = groups.flatMap(group => group.variants.map(variant => variant.to));
  assert.equal(new Set(groups.map(group => group.id)).size, groups.length);
  for (const game of catalog) {
    assert.equal(targets.filter(target => target === `/game-library/template/${encodeURIComponent(game.id)}`).length, game.category === 'minecraft' ? 0 : 1, game.id);
  }
});

test('Rust stable Autowipe is first and staging stays an explicit alternative', () => {
  const rust = family('rust');
  assert.equal(rust.name, 'Rust');
  assert.equal(rust.variants.length, 2);
  assert.equal(rust.variants[0].name, 'Vanilla / Autowipe');
  assert.equal(rust.variants[0].kind, 'default');
  assert.match(rust.variants[1].name, /Staging/);
  assert.equal(rust.variants[1].kind, 'other');
});

test('CS 1.6 has Vanilla before ReHLDS without hiding Source or CS2', () => {
  const groups = groupGameCatalog(catalog, []).filter(group => group.category === 'counter_strike');
  assert.deepEqual(new Set(groups.map(group => group.id)), new Set(['counter_strike_16', 'counter_strike_2', 'counter_strike_source']));
  const cs = groups.find(group => group.id === 'counter_strike_16');
  assert.equal(cs.variants[0].name, 'Vanilla');
  assert.match(cs.variants[1].name, /ReHLDS/);
});

test('shared engine or franchise categories keep distinct games separate', () => {
  const groups = groupGameCatalog(catalog, []);
  for (const category of ['arma', 'cubeengine', 'truck-simulator']) {
    const expected = catalog.filter(game => game.category === category);
    assert.equal(groups.filter(group => group.category === category).length, expected.length, category);
  }
  assert.equal(family('gta_v').variants.length, 4);
  assert.equal(family('gta_sa').variants.length, 3);
  assert.equal(groups.filter(group => group.category === 'gta').length, 3);
});

test('every same-game multi-recipe category collapses to one family', () => {
  for (const id of ['among_us', 'assetto_corsa', 'beamng', 'conan_exiles', 'factorio', 'hlds_server', 'ksp', 'mordhau', 'openra', 'palworld', 'rimworld', 'rising_world', 'rust', 'scpsl', 'space_engineers', 'stationeers', 'terraria', 'v_rising', 'valheim']) {
    const recipes = catalog.filter(game => game.category.toLowerCase() === id);
    const group = family(id);
    assert.equal(group.variants.length, recipes.length, id);
    const kinds = group.variants.map(variant => ['default', 'community', 'other'].indexOf(variant.kind));
    assert.deepEqual(kinds, [...kinds].sort(), id);
  }
});

test('DDNet aliases group with the Teeworlds original and preserve both recipes', () => {
  const group = family('teeworlds');
  assert.equal(group.variants.length, 3);
  assert.equal(group.variants[0].kind, 'default');
  assert.ok(familyMatches(group, 'DDRaceNetwork'));
  assert.ok(familyMatches(group, 'ddnet'));
});

test('Team Fortress 2 Classic is a community option beside the original game', () => {
  const group = family('team_fortress_2');
  assert.equal(group.variants.length, 2);
  assert.equal(group.variants[0].kind, 'default');
  assert.match(group.variants[1].name, /Classic/);
  assert.equal(group.variants[1].kind, 'community');
});

test('guided aliases merge only the exact managed recipe, retaining other options', () => {
  const templates = [
    {...catalog.find(game => game.category === 'satisfactory'), managed_game: 'satisfactory'},
    ...catalog.filter(game => game.category === 'palworld').map(game => ({...game, managed_game: /proton/i.test(game.name) ? 'palworld-proton' : 'palworld-native'})),
    ...catalog.filter(game => game.category === 'valheim'),
  ];
  const profiles = ['satisfactory', 'palworld', 'palworld-native', 'palworld-proton', 'valheim'].map(id => ({id, name: id, description: 'Guided server'}));
  const groups = groupGameCatalog(templates, profiles);
  assert.equal(groups.length, 3);
  const satisfactory = groups.find(group => group.id === 'satisfactory');
  assert.equal(satisfactory.variants.length, 1);
  assert.equal(satisfactory.variants[0].aliases.length, 1);
  assert.ok(satisfactory.variants[0].source);
  const palworld = groups.find(group => group.id === 'palworld');
  assert.equal(palworld.variants.length, 3);
  assert.equal(palworld.variants.filter(variant => variant.kind === 'default').length, 2);
  const routes = groups.flatMap(group => group.variants.flatMap(variant => [variant.to, ...variant.aliases]));
  for (const game of templates) assert.ok(routes.includes(`/game-library/template/${encodeURIComponent(game.id)}`), game.name);
  for (const game of profiles) assert.ok(routes.includes(`/game-library/${game.id}`), game.id);
});

test('patch search finds its parent game, and unavailable options remain represented', () => {
  const game = {...catalog.find(game => game.name.includes('ReHLDS') && game.category === 'counter_strike'), available: false};
  const cs = family('counter_strike_16', [game]);
  assert.ok(familyMatches(cs, 'rehlds'));
  assert.ok(familyMatches(cs, 'Counter-Strike 1.6'));
  assert.equal(familyMatches(cs, 'Palworld'), false);
  assert.equal(cs.variants[0].available, false);
});

test('community-only games never claim a Vanilla option', () => {
  for (const id of ['beamng', 'among_us', 'rimworld', 'ksp', 'gta_v', 'gta_sa']) {
    assert.ok(family(id).variants.every(variant => variant.kind !== 'default'), id);
  }
});

test('unknown future recipes and guided profiles stay available without a name allowlist', () => {
  const custom = {id: 'new', name: 'New Game', category: 'new_game', source: 'https://example.test/new_game/egg.json', description: '', available: true, verification: '', detail: ''};
  const groups = groupGameCatalog([custom], [{id: 'next-game', name: 'Next Game', description: ''}]);
  assert.equal(groups.length, 2);
  assert.equal(family('new_game', [custom]).name, 'New Game');
  assert.equal(templateFamilyID({...custom, category: 'counter_strike'}), 'counter_strike:new');
});
