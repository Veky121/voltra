import {familyMatches, type GameFamily} from './gameFamiliesModel.ts';

// Game Library categories. Recipe folders name the game, not its kind, so the
// kind of game is listed here. A game that is not listed shows under Other.
export type GameCategory = 'survival' | 'shooter' | 'sandbox' | 'driving' | 'strategy' | 'roleplay' | 'party' | 'other';
export const gameCategories: {id: GameCategory; label: string; subtitle: string}[] = [
  {id: 'survival', label: 'Survival', subtitle: 'Survival game'},
  {id: 'shooter', label: 'Shooters', subtitle: 'Shooter'},
  {id: 'sandbox', label: 'Sandbox & building', subtitle: 'Sandbox game'},
  {id: 'strategy', label: 'Strategy & management', subtitle: 'Strategy game'},
  {id: 'driving', label: 'Driving', subtitle: 'Driving game'},
  {id: 'roleplay', label: 'Roleplay & social', subtitle: 'Roleplay and social server'},
  {id: 'party', label: 'Party & co-op', subtitle: 'Party and co-op game'},
  {id: 'other', label: 'Other', subtitle: 'Dedicated server'},
];

const members: Record<Exclude<GameCategory, 'other'>, string[]> = {
  survival: [
    '7_days_to_die',
    'abiotic_factor',
    'aloft',
    'ark_survival_ascended',
    'ark_survival_evolved',
    'aska',
    'astroneer',
    'conan_exiles',
    'core_keeper',
    'craftopia',
    'cryofall',
    'dayz',
    'dead_matter',
    'dont_starve',
    'empyrion',
    'enshrouded',
    'frozen_flame',
    'humanitz',
    'hurtworld',
    'icarus',
    'longvinter',
    'myth_of_empires',
    'necesse',
    'night_of_the_dead',
    'nightingale',
    'no_one_survived',
    'palworld',
    'path_of_titans',
    'pixark',
    'plains_of_pain',
    'project_zomboid',
    'return_to_moria',
    'romestead',
    'rust',
    'scum',
    'smalland_survive_the_wilds',
    'solace_crafting',
    'sonsoftheforest',
    'soulmask',
    'starrupture',
    'subnautica_nitrox_mod',
    'sunkenland',
    'the_forest',
    'the_isle',
    'thefront',
    'unturned',
    'v_rising',
    'valheim',
    'vein',
    'vintage_story',
    'voyagers_of_nera',
    'windrose',
    'wurm_unlimited',
  ],
  shooter: [
    'americas_army',
    'arma',
    'banana_shooter',
    'battalion_legacy',
    'black_mesa',
    'cod',
    'contagion',
    'counter_strike',
    'counter_strike_16',
    'counter_strike_2',
    'counter_strike_source',
    'cs2d',
    'cubeengine',
    'doom',
    'eft',
    'fof',
    'ground_branch',
    'half_life_2_deathmatch',
    'hlds_server',
    'holdfast',
    'insurgency_sandstorm',
    'killing_floor_2',
    'left4dead',
    'left4dead_2',
    'mohaa',
    'mordhau',
    'nazi zombies portable',
    'nmrih',
    'no_love_lost',
    'nuclear_option',
    'open_fortress',
    'openarena',
    'operation_harsh_doorstop',
    'pavlov_vr',
    'post_scriptum',
    'quake_live',
    'r5reloaded',
    'renown',
    'scpsl',
    'soldat',
    'soldat_2',
    'sourcecoop',
    'squad',
    'svencoop',
    'team_fortress_2',
    'team_fortress_2_classic',
    'urbanterror',
    'wolfenstein_enemy_territory',
    'xonotic',
  ],
  sandbox: [
    'archean',
    'brickadia',
    'classicube',
    'cubic_odyssey',
    'eco',
    'fortresscraft_evolved',
    'gmod',
    'hytale',
    'minecraft',
    'minetest',
    'modiverse',
    'rising_world',
    'space_engineers',
    'starbound',
    'starmade',
    'stationeers',
    'stormworks',
    'terraria',
    'terratech_worlds',
    'veloren',
  ],
  strategy: [
    'astro_colony',
    'avorion',
    'carrier_command_2',
    'colony_survival',
    'factorio',
    'foundry',
    'ftl_tachyon',
    'ksp',
    'mindustry',
    'mount_blade_ii_bannerlord',
    'openra',
    'openrct2',
    'openttd',
    'rimworld',
    'satisfactory',
  ],
  driving: ['assetto_corsa', 'automobilista2', 'beamng', 'supertuxkart', 'trackmania', 'truck-simulator'],
  roleplay: [
    'foundry_vtt',
    'gta',
    'gta_sa',
    'gta_v',
    'hogwarp',
    'just_cause',
    'losangelescrimes',
    'neosvr',
    'novalife_amboise',
    'onset',
    'rdr',
    'resonite',
    'spacestation_14',
    'tower_unite',
  ],
  party: [
    'among_us',
    'barotrauma',
    'citadel',
    'clone_hero',
    'ddnet',
    'ddracenetwork',
    'iosoccer',
    'midnight_ghost_hunt',
    'portal_knights',
    'puck',
    'risk_of_rain_2',
    'sonic_robo_blast_2',
    "swords_'n_magic_and_stuff",
    'teeworlds',
  ],
};
const categoryOf = new Map<string, GameCategory>(
  Object.entries(members).flatMap(([category, ids]) => ids.map(id => [id, category as GameCategory]))
);

/** The category a game family belongs to: by its family first, then by its recipe folder. */
export function gameCategory(family: Pick<GameFamily, 'id' | 'category'>): GameCategory {
  const key = (value: string) => value.toLowerCase().split(':')[0];
  return categoryOf.get(key(family.id)) ?? categoryOf.get(key(family.category)) ?? 'other';
}
export const isGameCategory = (value: unknown): value is GameCategory =>
  gameCategories.some(category => category.id === value);

/** A plain description of the game for its card, instead of its recipe folder name. */
export function familySubtitle(family: GameFamily): string {
  const variant = family.variants[0];
  if (family.variants.length > 1)
    return family.variants.some(option => option.kind === 'default')
      ? 'Vanilla, versions & community servers'
      : 'Community servers & alternatives';
  if (variant?.guided) return 'Dedicated server · Steam updates';
  return gameCategories.find(category => category.id === gameCategory(family))!.subtitle;
}

// Minecraft has its own setup flow and card, outside the grouped catalog.
const minecraftWords = /minecraft|vanilla|modpack|paper|fabric|forge|quilt|bedrock/i;
export function minecraftVisible(search: string, category: GameCategory | null): boolean {
  return (!category || category === 'sandbox') && (!search.trim() || minecraftWords.test(search));
}

export type LibraryFilter = {search: string; category: GameCategory | null};
export function filterGameFamilies(families: GameFamily[], {search, category}: LibraryFilter): GameFamily[] {
  return families.filter(family => (!category || gameCategory(family) === category) && familyMatches(family, search));
}

/** How many games each category holds for the current search, Minecraft included. */
export function categoryCounts(families: GameFamily[], search: string): Record<GameCategory, number> {
  const counts = Object.fromEntries(gameCategories.map(category => [category.id, 0])) as Record<GameCategory, number>;
  for (const family of families) if (familyMatches(family, search)) counts[gameCategory(family)]++;
  if (minecraftVisible(search, 'sandbox')) counts.sandbox++;
  return counts;
}

// The grid draws a page of cards at a time; "Show more" adds the next page.
export const gamePageSize = 24;
export function pageGameFamilies<T>(list: T[], pages: number, size = gamePageSize): {shown: T[]; remaining: number} {
  const count = Math.max(1, Math.floor(pages)) * size;
  return {shown: list.slice(0, count), remaining: Math.max(0, list.length - count)};
}
