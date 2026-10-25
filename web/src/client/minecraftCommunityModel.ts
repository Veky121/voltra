export function isMinecraftTemplate(game: {category: string; source: string}) {
  return game.category === 'minecraft' || /\/minecraft\//i.test(game.source);
}

export function minecraftProjectKey(source: string) {
  return source.match(/\/minecraft\/(?:java|bedrock|crossplay)\/([^/]+)\//i)?.[1]
    ?? source.match(/\/minecraft\/proxy\/(?:java|bedrock)\/([^/]+)\//i)?.[1];
}
