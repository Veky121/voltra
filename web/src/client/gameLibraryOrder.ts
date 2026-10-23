// Curated discovery order, not live player counts. Unlisted games follow by name.
const popularGames = [
  'minecraft', 'rust', 'counter_strike', 'gta', 'palworld', 'ark_survival_ascended',
  'ark_survival_evolved', 'terraria', 'dayz', 'project_zomboid', '7_days_to_die',
  'valheim', 'satisfactory', 'enshrouded', 'gmod', 'team_fortress_2',
  'dont_starve', 'factorio', 'conan_exiles', 'space_engineers', 'arma',
  'squad', 'sonsoftheforest', 'the_forest', 'v_rising', 'core_keeper',
  'left4dead_2', 'barotrauma', 'unturned', 'scum', 'abiotic_factor',
];
const popularity = new Map(popularGames.map((game, index) => [game, index]));

export function compareGamePopularity(a: {name: string; category: string}, b: {name: string; category: string}) {
  const rank = (category: string) => popularity.get(category.toLowerCase()) ?? popularGames.length;
  return rank(a.category) - rank(b.category) || a.name.localeCompare(b.name);
}
