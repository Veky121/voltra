// Packs belong to the existing Minecraft content managers, not dedicated eggs.
export function isMinecraftModpackRecipe(path) {
  return /^minecraft\/java\/(?:curseforge|modrinth|ftb|technic)\//i.test(path);
}

export function isExcludedGameRecipe(path) {
  return isMinecraftModpackRecipe(path) || path === 'neverwinter_nights_ee/egg-neverwinter-nights--enhanced-edition.json';
}
