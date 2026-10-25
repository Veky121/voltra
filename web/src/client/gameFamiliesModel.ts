import {compareGamePopularity} from './gameLibraryOrder.ts';
import {isMinecraftTemplate} from './minecraftCommunityModel.ts';

export type CatalogTemplate = {id: string; name: string; category: string; source: string; description: string; available: boolean; verification: string; detail: string; managed_game?: string};
export type CatalogSteamGame = {id: string; name: string; description: string};
export type VariantKind = 'default' | 'community' | 'other';
export type GameVariant = {
  id: string; name: string; description: string; kind: VariantKind; to: string;
  available: boolean; guided: boolean; source?: string; verification?: string; detail?: string;
  templateID?: string; steamID?: string; aliases: string[];
};
export type GameFamily = {id: string; name: string; category: string; variants: GameVariant[]};

const familyNames: Record<string, string> = {
  among_us: 'Among Us', assetto_corsa: 'Assetto Corsa', beamng: 'BeamNG.drive',
  conan_exiles: 'Conan Exiles', counter_strike_16: 'Counter-Strike 1.6',
  counter_strike_2: 'Counter-Strike 2', counter_strike_source: 'Counter-Strike: Source',
  factorio: 'Factorio', gta_v: 'Grand Theft Auto V', gta_sa: 'Grand Theft Auto: San Andreas',
  hlds_server: 'Half-Life / GoldSrc', ksp: 'Kerbal Space Program', mordhau: 'Mordhau',
  openra: 'OpenRA', palworld: 'Palworld', rimworld: 'RimWorld', rising_world: 'Rising World',
  rust: 'Rust', scpsl: 'SCP: Secret Laboratory', space_engineers: 'Space Engineers',
  stationeers: 'Stationeers', terraria: 'Terraria', v_rising: 'V Rising', valheim: 'Valheim',
  satisfactory: 'Satisfactory', '7_days_to_die': '7 Days to Die', teeworlds: 'Teeworlds', team_fortress_2: 'Team Fortress 2',
};
const steamFamilies: Record<string, string> = {'7days': '7_days_to_die', 'palworld-native': 'palworld', 'palworld-proton': 'palworld'};
const normal = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// Upstream categories sometimes contain several distinct games. Split those
// first, then group server implementations, branches and platforms per game.
export function templateFamilyID(game: Pick<CatalogTemplate, 'category' | 'source' | 'id'>): string {
  const category = game.category.toLowerCase();
  const path = game.source.toLowerCase();
  if (category === 'counter_strike') {
    if (/counter_strike_1[._]6/.test(path)) return 'counter_strike_16';
    if (path.includes('/counter_strike_2/')) return 'counter_strike_2';
    if (path.includes('/counter_strike_source/')) return 'counter_strike_source';
    return `counter_strike:${game.id}`;
  }
  if (category === 'gta') {
    if (/\/(altv|fivem|ragecoop|ragemp)\//.test(path)) return 'gta_v';
    if (/\/(mtasa|openmp|samp)\//.test(path)) return 'gta_sa';
    return `gta:${game.id}`;
  }
  if (['arma', 'cubeengine', 'truck-simulator'].includes(category)) {
    const section = path.split(`/${category}/`)[1]?.split('/')[0];
    return `${category}:${section && !section.endsWith('.json') ? section : game.id}`;
  }
  if (category === 'ddnet' || category === 'ddracenetwork') return 'teeworlds';
  if (category === 'team_fortress_2_classic') return 'team_fortress_2';
  return category;
}

function templateKind(game: CatalogTemplate, family: string): VariantKind {
  const text = `${game.name} ${game.source}`;
  if (family === 'openra') return 'other';
  if (/staging|legacy|arm64|proton|wine|java legacy/i.test(text)) return 'other';
  if (/vanilla/i.test(text) || normal(game.name) === normal(familyNames[family] ?? game.category)) return 'default';
  if (family === 'rust' && /autowipe/i.test(text)) return 'default';
  if (family === 'scpsl' && !/exiled/i.test(text)) return 'default';
  if (family === 'hlds_server' && !/rehlds/i.test(text)) return 'default';
  if (family === 'rising_world' && /unity/i.test(text)) return 'default';
  return 'community';
}

function templateLabel(game: CatalogTemplate, family: string, kind: VariantKind): string {
  if (family === 'rust' && /autowipe/i.test(game.name)) return 'Vanilla / Autowipe';
  if (kind === 'default') return family === 'rising_world' ? 'Unity edition' : 'Vanilla';
  return game.name;
}

export function groupGameCatalog(templates: CatalogTemplate[], steam: CatalogSteamGame[]): GameFamily[] {
  const families = new Map<string, GameFamily>();
  const add = (id: string, name: string, category: string, variant: GameVariant) => {
    let family = families.get(id);
    if (!family) {family = {id, name: familyNames[id] ?? name, category, variants: []}; families.set(id, family);}
    family.variants.push(variant);
  };
  for (const game of steam) {
    const match = templates.find(template => template.managed_game === game.id)
      ?? templates.find(template => normal(template.category) === normal(game.id));
    const family = steamFamilies[game.id] ?? (match ? templateFamilyID(match) : game.id);
    const kind: VariantKind = /proton|staging|legacy|wine/i.test(game.id) ? 'other' : 'default';
    const name = game.id === 'palworld-native' ? 'Vanilla · Linux with admin controls'
      : game.id === 'palworld' ? 'Vanilla · Simple setup'
      : kind === 'default' ? 'Vanilla · Easy setup' : game.name;
    add(family, game.name, match?.category ?? family, {
      id: `steam:${game.id}`, name, description: game.description, kind,
      to: `/game-library/${encodeURIComponent(game.id)}`, guided: true, available: true,
      steamID: game.id, aliases: [],
    });
  }
  for (const game of templates) {
    if (isMinecraftTemplate(game)) continue;
    const family = templateFamilyID(game);
    const guided = game.managed_game ? families.get(family)?.variants.find(variant => variant.steamID === game.managed_game) : undefined;
    if (guided) {
      guided.aliases.push(`/game-library/template/${encodeURIComponent(game.id)}`);
      guided.source = game.source;
      guided.templateID = game.id;
      guided.verification = game.verification;
      guided.detail = game.detail;
      continue;
    }
    const kind = templateKind(game, family);
    add(family, game.name, game.category, {
      id: `template:${game.id}`, name: templateLabel(game, family, kind), description: game.description,
      kind, to: `/game-library/template/${encodeURIComponent(game.id)}`, guided: false,
      available: game.available, source: game.source, templateID: game.id,
      verification: game.verification, detail: game.detail, aliases: [],
    });
  }
  const kindOrder = {default: 0, community: 1, other: 2};
  for (const family of families.values()) {
    family.variants.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || Number(b.guided) - Number(a.guided) || a.name.localeCompare(b.name));
    // Prefer a canonical plain recipe name over an enhanced recipe encountered
    // first. Unknown categories still retain their actual catalog names.
    if (!familyNames[family.id]) {
      const base = templates.find(game => templateFamilyID(game) === family.id && templateKind(game, family.id) === 'default');
      if (base) family.name = base.name.replace(/\s*[-:]?\s*vanilla$/i, '').trim();
    }
  }
  return [...families.values()].sort(compareGamePopularity);
}

export function familyMatches(family: GameFamily, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${family.name} ${family.category.replaceAll('_', ' ')} ${family.variants.map(variant => `${variant.name} ${variant.description}`).join(' ')}`.toLowerCase();
  return words.every(word => text.includes(word));
}

export function variantVerification(variant: Pick<GameVariant, 'verification'>): string {
  return variant.verification === 'runtime_verified' ? 'Hosting tested'
    : variant.verification === 'runtime_partial' ? 'Partially tested'
    : variant.verification === 'runtime_failed' ? 'Runtime test failed' : 'Runtime not verified';
}
