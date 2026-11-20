// How the overview draws its servers, remembered per browser. Artwork cards are
// the default; the list is a denser view of the same servers.
export type OverviewLayout = 'cards' | 'list';
export const overviewLayoutKey = 'voltra.overview.layout';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readOverviewLayout(store: Storage | undefined = storage()): OverviewLayout {
  try {
    return store?.getItem(overviewLayoutKey) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}
export function writeOverviewLayout(layout: OverviewLayout, store: Storage | undefined = storage()): void {
  // Storage can be full, blocked or missing; the choice then lasts for this visit.
  try {
    store?.setItem(overviewLayoutKey, layout);
  } catch {}
}

/** The letter shown when a server has neither its own icon nor a game icon. */
export function serverInitial(name: unknown): string {
  const text = typeof name === 'string' ? name.trim() : '';
  const letter = [...text].find(character => /[\p{L}\p{N}]/u.test(character));
  return letter ? letter.toLocaleUpperCase() : '?';
}

/**
 * The game picture to try after the server's own icon: the loader or software
 * icon, then the game's artwork. Generic placeholder artwork is not a game
 * icon, so it is skipped and the initial is shown instead.
 */
export function gameIconFallback(
  art: {id: string; src: string; kind: string},
  software?: {src: string}
): string | undefined {
  if (software?.src) return software.src;
  if (art.id === 'minecraft') return '/game-icons/minecraft-official.png';
  return art.kind === 'fallback' ? undefined : art.src;
}
