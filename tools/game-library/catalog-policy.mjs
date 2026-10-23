// Packs belong to the existing Minecraft content managers, not dedicated eggs.
export function isMinecraftModpackRecipe(path) {
  return /^minecraft\/java\/(?:curseforge|modrinth|ftb|technic)\//i.test(path);
}
