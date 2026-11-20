import {accountNickname} from '../../account/accountProfile.ts';

export const serverListPageSize = 25;

// The admin list is paged and searched by the panel; the node and owner come
// from the same answer.
export function serverListPath({page, search}: {page: number; search: string}): string {
  const query = new URLSearchParams({
    per_page: String(serverListPageSize),
    page: String(Math.max(1, Math.floor(page) || 1)),
    include: 'user,node',
  });
  // Matches the name, the identifier or the start of the UUID.
  const text = search.trim();
  if (text) query.set('filter[search]', text);
  return `/api/application/servers?${query}`;
}

export type ServerStateTone = 'ready' | 'busy' | 'problem' | 'muted';

// One plain word or two for the saved install and suspension state. Whether
// the game is running is a live reading and is not part of this list.
export function serverState(server: Record<string, any>): {label: string; tone: ServerStateTone} {
  if (server.suspended || server.status === 'suspended') return {label: 'Suspended', tone: 'muted'};
  switch (server.status) {
    case 'installing':
      return {label: 'Installing', tone: 'busy'};
    case 'install_failed':
      return {label: 'Install failed', tone: 'problem'};
    case 'reinstall_failed':
      return {label: 'Reinstall failed', tone: 'problem'};
    case 'restoring_backup':
      return {label: 'Restoring backup', tone: 'busy'};
  }
  if (server.container && Number(server.container.installed) === 0) return {label: 'Not installed', tone: 'muted'};
  return {label: 'Ready', tone: 'ready'};
}

const related = (server: Record<string, any>, name: string) =>
  server.relationships?.[name]?.attributes as Record<string, any> | null | undefined;

export function serverNodeName(server: Record<string, any>): string {
  const node = related(server, 'node');
  return node?.name?.trim() || (server.node ? `Node ${server.node}` : '—');
}

export function serverOwnerName(server: Record<string, any>): string {
  const user = related(server, 'user');
  return user ? accountNickname(user) : server.user ? `User ${server.user}` : '—';
}

export function serverListRange(pagination: Record<string, any> | undefined): {
  page: number;
  pages: number;
  total: number;
  from: number;
  to: number;
} {
  const page = Number(pagination?.current_page) || 1,
    pages = Math.max(1, Number(pagination?.total_pages) || 1),
    total = Number(pagination?.total) || 0;
  const per = Number(pagination?.per_page) || serverListPageSize,
    count = Number(pagination?.count) || 0;
  const from = count ? (page - 1) * per + 1 : 0;
  return {page, pages, total, from, to: count ? from + count - 1 : 0};
}

/**
 * The list to show: the current answer, else the previous one while the next
 * page or search is loading, else nothing. A failed or refused request never
 * leaves another query's rows on screen.
 */
export function shownServerList<T>(current: T | null | undefined, previous: T | null, loading: boolean): T | null {
  if (current) return current;
  return loading ? previous : null;
}
