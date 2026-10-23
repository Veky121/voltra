// Fetch existing publisher artwork and stock photographs. No generated images.
// Run from the repository root: node tools/artwork/sync-overview.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'web/public/artwork');
await fs.mkdir(output, {recursive: true});
const normalize = text => String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const catalog = JSON.parse(await fs.readFile('internal/panel/game_library/upstream/catalog.json', 'utf8'));
const records = [];
const failures = [];
const previous = new Map(JSON.parse(await fs.readFile('web/src/client/serverArtworkCatalog.json', 'utf8').catch(() => '[]')).map(record => [record.id, record]));
async function request(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(18000), headers: {'User-Agent': 'Voltra-Artwork-Sync/1.0'}});
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  return response;
}
async function asset(id, name, url, source, aliases, extra = {}) {
  const cached = previous.get(id);
  if (cached?.imageUrl === url && await fs.stat(path.join(output, path.basename(cached.src))).catch(() => false)) {
    const record = {...cached, name, source, aliases: [...new Set(aliases.map(normalize))].filter(Boolean), ...extra};
    records.push(record);
    return record;
  }
  const response = await request(url);
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw Error('Not an image');
  const extension = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('svg') ? 'svg' : 'jpg';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100 || bytes.length > 5_000_000) throw Error('Unexpected image size');
  const filename = `${id}.${extension}`;
  await fs.writeFile(path.join(output, filename), bytes);
  const record = {id, name, src: `/artwork/${filename}`, aliases: [...new Set(aliases.map(normalize))].filter(Boolean), source, imageUrl: url, ...extra};
  records.push(record);
  return record;
}

await asset('server', 'Server', 'https://images.unsplash.com/photo-1506399558188-acca6f8cbf41?auto=format&fit=crop&w=1000&q=80', 'https://unsplash.com/photos/server-racks-in-data-center-klWUhr-wPJ8', [], {kind: 'fallback'});
await asset('software', 'Application', 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?auto=format&fit=crop&w=1000&q=80', 'https://unsplash.com/photos/monitor-showing-java-programming-OqtafYT5kTw', [], {kind: 'fallback'});
await asset('hardware', 'Service', 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1000&q=80', 'https://unsplash.com/photos/macro-photography-of-black-circuit-board-FO7JIlwjOtU', [], {kind: 'fallback'});
await asset('discord', 'Discord bot', 'https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/665643dd8c7ac752237b5cef_Discord-OG-1200x630.jpg', 'https://discord.com/branding', ['discord', 'discord js', 'discord py', 'discord bot', 'jmusicbot', 'redbot', 'red discordbot'], {kind: 'software'});
await asset('minecraft', 'Minecraft', 'https://www.minecraft.net/content/dam/minecraftnet/games/minecraft/key-art/NewKeyArt_Header.jpg', 'https://www.minecraft.net/en-us/article/key-art-update', ['minecraft', 'paper', 'purpur', 'spigot', 'bukkit', 'bedrock', 'fabric', 'forge', 'neoforge', 'bungeecord', 'waterfall', 'velocity'], {kind: 'game'});

const known = {
  satisfactory: 526870, palworld: 1623730, rust: 252490, valheim: 892970,
  openttd: 1536610, core_keeper: 1621690, terraria: 105600, factorio: 427520,
  gmod: 4000, team_fortress_2: 440, counter_strike: 730, project_zomboid: 108600,
  ark_survival_evolved: 346110, ark_survival_ascended: 2399830, enshrouded: 1203620,
  seven_days: 251570, '7_days_to_die': 251570, the_forest: 242760, sonsoftheforest: 1326470,
  dont_starve: 322330, dayz: 221100, v_rising: 1604030, space_engineers: 244850,
  mindustry: 1127400, unturned: 304930, conan_exiles: 440900, squad: 393380,
  arma: 107410, scpsl: 700330, left4dead_2: 550, left4dead: 500, starbound: 211820,
  barotrauma: 602960, icarus: 1149460, abiotic_factor: 427410, killing_floor_2: 232090,
  among_us: 945360, the_isle: 376210, stormworks: 573090, stationeers: 544550,
};
const searchTerms = {automobilista2: 'Automobilista 2', fof: 'Fistful of Frags', ksp: 'Kerbal Space Program', gta: 'Grand Theft Auto V', rdr: 'Red Dead Redemption 2', r5reloaded: 'Apex Legends', nmrih: 'No More Room in Hell', pavlov_vr: 'Pavlov', svencoop: 'Sven Co-op', thefront: 'The Front', spacestation_14: 'Space Station 14', subnautica_nitrox_mod: 'Subnautica', hlds_server: 'Half-Life', neverwinter_nights_ee: 'Neverwinter Nights Enhanced Edition', ddracenetwork: 'DDNet', windrose: 'Windrose'};
const publisherNames = {satisfactory: 'Satisfactory', palworld: 'Palworld', rust: 'Rust', valheim: 'Valheim', openttd: 'OpenTTD', core_keeper: 'Core Keeper', terraria: 'Terraria', factorio: 'Factorio', gmod: "Garry's Mod", counter_strike: 'Counter-Strike 2', team_fortress_2: 'Team Fortress 2', arma: 'Arma 3', dont_starve: "Don't Starve Together", scpsl: 'SCP: Secret Laboratory', '7_days_to_die': '7 Days to Die'};
const groups = new Map();
for (const entry of catalog.entries) {
  const category = entry.path.split('/')[0];
  if (['minecraft', 'wine'].includes(category)) continue;
  const group = groups.get(category) || {category, names: [], appIds: []};
  group.names.push(entry.egg.name);
  for (const variable of entry.egg.variables || []) {
    if (/APP_?ID/i.test(variable.env_variable) && /^\d+$/.test(variable.default_value)) group.appIds.push(Number(variable.default_value));
  }
  groups.set(category, group);
}
for (const category of ['satisfactory', 'palworld']) {
  if (!groups.has(category)) groups.set(category, {category, names: [category], appIds: []});
}
async function game(group) {
  const {category, names} = group;
  const key = category.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cached = previous.get(key);
  if (cached?.kind === 'game') {
    await asset(key, publisherNames[category] || cached.name, cached.imageUrl, cached.source, [category, ...names], {kind: 'game', appIds: cached.appIds});
    return;
  }
  let appId = known[category];
  let title = publisherNames[category] || names[0];
  try {
    if (!appId) {
      const term = searchTerms[category] || category.replaceAll('_', ' ');
      const results = await (await request(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`)).json();
      const tokens = normalize(term).split(' ');
      const match = results.items?.find(item => tokens.every(token => normalize(item.name).split(' ').includes(token)));
      if (!match) throw Error('No exact publisher match');
      appId = match.id; title = match.name;
    }
    const url = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
    const record = await asset(category.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title, url, `https://store.steampowered.com/app/${appId}/`, [category, ...names], {kind: 'game', appIds: [...new Set([appId, ...group.appIds])]});
    console.log(`Artwork: ${record.id}`);
  } catch (error) {
    failures.push({category, reason: String(error.message)});
  }
}
let next = 0;
const all = [...groups.values()];
await Promise.all(Array.from({length: 4}, async () => {
  while (next < all.length) {
    const group = all[next++];
    await game(group);
    await new Promise(resolve => setTimeout(resolve, 180));
  }
}));
// Distinct Source variants should not all be pictured as Counter-Strike 2.
for (const [id, name, appId, aliases] of [
  ['counter-strike-source', 'Counter-Strike: Source', 240, ['counter strike source', 'css', 'source css']],
  ['counter-strike-16', 'Counter-Strike 1.6', 10, ['counter strike 1 6', 'cs 1 6']],
  ['arma-reforger', 'Arma Reforger', 1874880, ['arma reforger']],
  ['quake', 'Quake', 2310, ['quake', 'quake server']],
]) {
  try {await asset(id, name, `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`, `https://store.steampowered.com/app/${appId}/`, aliases, {kind: 'game', appIds: [appId]});}
  catch (error) {failures.push({category: id, reason: error.message});}
}

// Luanti is the current name for Minetest. Use the project's own screenshot.
try {
  const html = await (await request('https://www.luanti.org/en/')).text();
  const candidates = [...html.matchAll(/(?:src|srcset)=["']([^"']+\.(?:jpg|png|webp)[^"']*)["']/g)].map(match => match[1].split(' ')[0]);
  const image = candidates.find(url => /gallery\/8\.jpg/.test(url)) || candidates.find(url => /screenshot|gallery|hero|background/i.test(url));
  if (!image) throw Error('No screenshot found');
  await asset('luanti', 'Luanti / Minetest', new URL(image, 'https://www.luanti.org/en/').href, 'https://www.luanti.org/', ['luanti', 'minetest'], {kind: 'game'});
} catch (error) {failures.push({category: 'luanti', reason: error.message});}

await asset('urbanterror', 'Urban Terror', 'https://www.urbanterror.info/images/banners/website_thumbnail_00.png', 'https://www.urbanterror.info/', ['urbanterror', 'urban terror'], {kind: 'game'});
for (const [id, name, website, aliases] of [
  ['vintage-story', 'Vintage Story', 'https://www.vintagestory.at/', ['vintage story', 'vintagestory']],
  ['hytale', 'Hytale', 'https://hytale.com/', ['hytale']],
  ['openrct2', 'OpenRCT2', 'https://openrct2.org/', ['openrct2']],
  ['foundry-vtt', 'Foundry Virtual Tabletop', 'https://foundryvtt.com/', ['foundry vtt', 'foundry virtual tabletop']],
  ['xonotic', 'Xonotic', 'https://xonotic.org/', ['xonotic']],
]) {
  try {
    const html = await (await request(website)).text();
    const tags = [...html.matchAll(/<meta[^>]+>/gi)].map(match => match[0]);
    const tag = tags.find(tag => /(?:property|name)=["']og:image["']/i.test(tag));
    const url = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (!url) throw Error('No publisher cover found');
    await asset(id, name, new URL(url.replaceAll('&amp;', '&'), website).href, website, aliases, {kind: id === 'foundry-vtt' ? 'software' : 'game'});
  } catch (error) {failures.push({category: id, reason: error.message});}
}

const extraAliases = {'counter-strike-16': ['cs16', 'cstrike'], 'counter-strike-source': ['css'], 'half-life-2-deathmatch': ['hl2dm', 'hl2mp'], 'team-fortress-2': ['tf2'], 'gmod': ['garrysmod'], 'gta': ['fivem', 'ragemp', 'altv'], 'minecraft': ['minecraft bedrock']};
for (const record of records) record.aliases = [...new Set([...record.aliases, ...(extraAliases[record.id] || [])])];
await fs.writeFile('web/src/client/serverArtworkCatalog.json', JSON.stringify(records, null, 2) + '\n');
await fs.writeFile(path.join(output, 'SOURCES.md'), '# Server artwork sources\n\nExisting publisher artwork and stock photography downloaded for Voltra server identification. Images are not AI generated. Publisher artwork and trademarks remain owned by their respective rights holders; no endorsement is implied. Unsplash photos are used under the Unsplash License. Original source URLs follow.\n\n' + records.map(record => `- **${record.name}** (${path.basename(record.src)}): [source](${record.source}) · [original image](${record.imageUrl})`).join('\n') + '\n');
await fs.mkdir('artifacts/ui-overview', {recursive: true});
await fs.writeFile('artifacts/ui-overview/artwork-sync.json', JSON.stringify({downloaded: records.length, fallbacks: failures, generatedImages: false}, null, 2));
console.log(JSON.stringify({downloaded: records.length, fallbackCategories: failures.length}));
