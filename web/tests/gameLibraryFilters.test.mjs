import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {groupGameCatalog} from '../src/features/game-library/gameFamiliesModel.ts';
import {
  categoryCounts,
  familySubtitle,
  filterGameFamilies,
  gameCategories,
  gameCategory,
  gamePageSize,
  isGameCategory,
  minecraftVisible,
  pageGameFamilies,
} from '../src/features/game-library/gameLibraryFilters.ts';

// The shipped recipe list, as the catalog endpoint hands it to the page.
const catalog = JSON.parse(
  readFileSync(new URL('../../internal/panel/game_library/upstream/catalog.json', import.meta.url))
).entries.map(entry => ({
  id: entry.path,
  name: entry.egg.name,
  description: entry.egg.description ?? '',
  category: entry.path.split('/')[0],
  source: `https://github.com/pterodactyl/game-eggs/blob/pinned/${entry.path}`,
  available: true,
  verification: 'runtime_unverified',
  detail: '',
}));
const families = groupGameCatalog(catalog, [{id: 'valheim', name: 'Valheim', description: 'Vikings'}]);
const family = id => families.find(group => group.id === id);

test('well-known games land in the category players expect', () => {
  assert.equal(gameCategory(family('rust')), 'survival');
  assert.equal(gameCategory(family('valheim')), 'survival');
  assert.equal(gameCategory(family('counter_strike_2')), 'shooter');
  assert.equal(gameCategory(family('terraria')), 'sandbox');
  assert.equal(gameCategory(family('factorio')), 'strategy');
  assert.equal(gameCategory(family('gta_v')), 'roleplay');
  assert.equal(gameCategory(family('among_us')), 'party');
  assert.equal(gameCategory(family('beamng')), 'driving');
  // Split families keep their recipe folder's category.
  assert.ok(families.filter(group => group.category === 'arma').every(group => gameCategory(group) === 'shooter'));
  assert.equal(gameCategory({id: 'something_new', category: 'something_new'}), 'other');
});

test('most of the shipped catalog has a real category', () => {
  const other = families.filter(group => gameCategory(group) === 'other');
  assert.ok(
    other.length <= families.length * 0.1,
    `${other.length} of ${families.length} under Other: ${other.map(group => group.id).join(', ')}`
  );
});

test('filters combine category and search over the one catalog in memory', () => {
  const survival = filterGameFamilies(families, {search: '', category: 'survival'});
  assert.ok(survival.length > 10);
  assert.ok(survival.every(group => gameCategory(group) === 'survival'));
  assert.equal(filterGameFamilies(families, {search: 'rust', category: 'survival'})[0].id, 'rust');
  assert.deepEqual(filterGameFamilies(families, {search: 'rust', category: 'shooter'}), []);
  assert.equal(filterGameFamilies(families, {search: '', category: null}).length, families.length);
  // Filtering never reorders the curated list.
  const ids = families.map(group => group.id);
  const order = survival.map(group => ids.indexOf(group.id));
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b)
  );
});

test('category counts add up to everything shown, with Minecraft under Sandbox', () => {
  const counts = categoryCounts(families, '');
  assert.equal(
    Object.values(counts).reduce((sum, count) => sum + count, 0),
    families.length + 1
  );
  assert.equal(counts.sandbox, filterGameFamilies(families, {search: '', category: 'sandbox'}).length + 1);
  assert.equal(
    categoryCounts(families, 'paper').sandbox,
    filterGameFamilies(families, {search: 'paper', category: 'sandbox'}).length + 1
  );
  assert.equal(minecraftVisible('', null), true);
  assert.equal(minecraftVisible('', 'sandbox'), true);
  assert.equal(minecraftVisible('', 'shooter'), false);
  assert.equal(minecraftVisible('rust', null), false);
  assert.ok(isGameCategory('party'));
  assert.ok(!isGameCategory('toString'));
  assert.equal(gameCategories.length, new Set(gameCategories.map(category => category.id)).size);
});

test('the grid shows a page at a time and says how many remain', () => {
  const list = Array.from({length: 60}, (_, index) => index);
  assert.deepEqual(pageGameFamilies(list, 1), {shown: list.slice(0, gamePageSize), remaining: 60 - gamePageSize});
  assert.deepEqual(pageGameFamilies(list, 2).remaining, 60 - 2 * gamePageSize);
  assert.deepEqual(pageGameFamilies(list, 3), {shown: list, remaining: 0});
  assert.deepEqual(pageGameFamilies(list, 0).shown.length, gamePageSize);
  assert.deepEqual(pageGameFamilies([], 1), {shown: [], remaining: 0});
});

test('card subtitles are plain words, never recipe folder names', () => {
  for (const group of families) {
    const subtitle = familySubtitle(group);
    assert.doesNotMatch(subtitle, /_/, group.id);
    assert.notEqual(subtitle.toLowerCase(), group.category.toLowerCase(), group.id);
  }
  assert.equal(familySubtitle(family('valheim')), 'Vanilla, versions & community servers');
  const single = families.find(
    group => group.variants.length === 1 && !group.variants[0].guided && gameCategory(group) === 'shooter'
  );
  assert.equal(familySubtitle(single), 'Shooter');
});
