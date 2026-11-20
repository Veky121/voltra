import type {CatalogSteamGame, CatalogTemplate} from './gameFamiliesModel.ts';
import {readAccountSnapshot, snapshotOwner, writeAccountSnapshot, type SnapshotStore} from '../../accountSnapshots.ts';

// Everything the Game Library grid shows, as one value: the page groups it
// once instead of merging lists that arrive at different times.
export type GameCatalogSnapshot = {templates: CatalogTemplate[]; steam: CatalogSteamGame[]; canInstall: boolean};
type Request = <T>(path: string, options?: RequestInit) => Promise<T>;

export const gameCatalogPath = '/api/client/game-library/catalog';
const attributes = (response: any) => response?.attributes ?? response;

// A desktop build can be newer than the panel it is paired with. A panel
// without the combined endpoint is read through its two separate lists, and
// still handed to the page as one settled value.
//
// Either way the page is given a catalog only when it is whole: both lists
// present, every record one the grid can draw, and a plain yes or no on who
// may install. A combined answer that falls short is read the older way; if
// that falls short too, the page shows its error and Retry instead of an
// empty or broken library.
export async function loadGameCatalog(request: Request, path: string, options?: RequestInit): Promise<unknown> {
  let combined: unknown;
  try {
    combined = await request(path, options);
  } catch (error) {
    // Missing on an older panel, or answered 200 with something that is not
    // JSON at all. Refusals, cancellations and outages are the caller's to see.
    const failure = error as {status?: number; code?: string} | undefined;
    const status = Number(failure?.status);
    if (![404, 405].includes(status) && !(status === 200 && failure?.code === 'invalid_json')) throw error;
  }
  const catalog = attributes(combined);
  if (listed(catalog?.templates) && listed(catalog?.steam) && typeof catalog.can_install === 'boolean')
    return whole(catalog.templates, catalog.steam, catalog.can_install);
  const [templates, steam] = (
    await Promise.all([
      request('/api/client/game-library/templates', options),
      request('/api/client/game-library/steam', options),
    ])
  ).map(attributes);
  if (!listed(templates?.games) || !listed(steam?.games) || typeof templates.can_install !== 'boolean')
    throw new Error('The panel returned an incomplete game list.');
  return whole(templates.games, steam.games, templates.can_install);
}

/**
 * Loads the catalog and saves it for the account that asked. The owner is
 * noted before the request, so an answer that arrives after the account has
 * changed is not saved for the next one.
 */
export async function loadAndSaveGameCatalog(request: Request, path: string, options?: RequestInit): Promise<unknown> {
  const owner = snapshotOwner();
  const result = await loadGameCatalog(request, path, options);
  const catalog = attributes(result);
  writeGameCatalogSnapshot(
    {templates: catalog.templates, steam: catalog.steam, canInstall: catalog.can_install === true},
    owner
  );
  return result;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

// Keep only what the library grid reads. The list response also carries setup
// metadata for every recipe, which the setup pages request themselves.
function template(game: CatalogTemplate): CatalogTemplate {
  return {
    id: text(game.id),
    name: text(game.name),
    category: text(game.category),
    source: text(game.source),
    description: text(game.description),
    available: game.available === true,
    verification: text(game.verification),
    detail: text(game.detail),
    ...(typeof game.managed_game === 'string' ? {managed_game: game.managed_game} : {}),
  };
}

function steamGame(game: CatalogSteamGame): CatalogSteamGame {
  return {id: text(game.id), name: text(game.name), description: text(game.description)};
}

function listed(value: unknown): value is {id: string}[] {
  return Array.isArray(value) && value.every(entry => entry && typeof entry.id === 'string' && entry.id !== '');
}

/** The catalog as the page receives it: only the fields the grid reads, each of the type it expects. */
function whole(templates: {id: string}[], steam: {id: string}[], canInstall: boolean) {
  return {
    object: 'game_catalog',
    attributes: {
      templates: (templates as CatalogTemplate[]).map(template),
      steam: (steam as CatalogSteamGame[]).map(steamGame),
      can_install: canInstall,
    },
  };
}

// The catalog this account last saw is kept across app starts so the library
// paints at once and is then revalidated. It holds the shipped game list and
// whether this account may install, and it lives with the account's other
// saved pages (accountSnapshots.ts) under the same rules: read and written
// only for the identified account, and removed when its session ends.
const saved = 'game-library';

export function readGameCatalogSnapshot(storage?: SnapshotStore, now?: number): GameCatalogSnapshot | undefined {
  const copy = readAccountSnapshot<Partial<GameCatalogSnapshot>>(saved, storage, now);
  if (!copy || !listed(copy.templates) || !listed(copy.steam)) return undefined;
  return {
    templates: copy.templates.map(template),
    steam: copy.steam.map(steamGame),
    canInstall: copy.canInstall === true,
  };
}

/** `owner` is snapshotOwner() from when the catalog was asked for. */
export function writeGameCatalogSnapshot(
  snapshot: GameCatalogSnapshot,
  owner: number | undefined,
  storage?: SnapshotStore,
  now?: number
): void {
  writeAccountSnapshot(
    saved,
    {
      templates: snapshot.templates.map(template),
      steam: snapshot.steam.map(steamGame),
      canInstall: snapshot.canInstall === true,
    },
    owner,
    storage,
    now
  );
}
