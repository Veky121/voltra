import {readSavedList, writeAccountSnapshot} from './accountSnapshots';

export type SavedNavigationServer = {
  uuid: string; identifier: string; name: string; egg_name?: string;
  artwork?: {game?: 'minecraft'; server_icon?: string; pack_icon?: string; pack_name?: string};
  status: string | null; favorite: boolean; last_visited_at: string | null;
};

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** The sidebar's last known list for the signed-in account. */
export const savedNavigation = () => readSavedList<SavedNavigationServer>('navigation', ['uuid', 'identifier', 'name']);

// The sidebar is read again every minute and seldom changes. An unchanged list
// is saved again only often enough to keep the copy from growing too old.
const refresh = 24 * 60 * 60 * 1000;
let last: {owner: number; text: string; at: number} | undefined;

/** Saves the sidebar's list for the account that asked for it (`owner`, from when the request began). */
export function saveNavigation(servers: unknown[], owner: number | undefined, now = Date.now()) {
  if (owner === undefined) return;
  const list = servers.map(savedNavigationEntry);
  const serialized = JSON.stringify(list);
  if (last && last.owner === owner && last.text === serialized && now - last.at < refresh) return;
  last = {owner, text: serialized, at: now};
  writeAccountSnapshot('navigation', list, owner, undefined, now);
}

/** Exactly what the sidebar draws for a server. Nothing else in the panel's answer is saved. */
export function savedNavigationEntry(server: any): SavedNavigationServer {
  const artwork = server?.artwork && typeof server.artwork === 'object'
    ? {game: server.artwork.game === 'minecraft' ? 'minecraft' as const : undefined, server_icon: text(server.artwork.server_icon), pack_icon: text(server.artwork.pack_icon), pack_name: text(server.artwork.pack_name)}
    : undefined;
  return {
    uuid: String(server?.uuid ?? ''), identifier: String(server?.identifier ?? ''), name: String(server?.name ?? ''),
    egg_name: text(server?.egg_name), artwork, status: text(server?.status) ?? null,
    favorite: server?.favorite === true, last_visited_at: text(server?.last_visited_at) ?? null,
  };
}
