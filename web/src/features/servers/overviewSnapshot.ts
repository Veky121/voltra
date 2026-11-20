import {queryCacheEpoch} from '../../hooks/queryCache';
import {readSavedList, writeAccountSnapshot} from '../../accountSnapshots';

// Keep a recent view while returning from a server. Always revalidate on mount.
// The in-memory view is fenced by the authentication boundary. The saved copy
// is for the first paint after a restart; accountSnapshots keeps it to the
// signed-in account.
let snapshot: {epoch: number; at: number; servers: any[]} | undefined;
// Live readings arrive every second. The list itself rarely changes, so it is
// compared and saved at most this often, always ending on the latest list. An
// unchanged list is saved again once a day, so that a page left open for a
// week does not let its copy grow too old to use.
const saveInterval = 10_000;
const refresh = 24 * 60 * 60 * 1000;
let saved = {epoch: -1, at: 0, text: '', written: 0, owner: undefined as number | undefined};
let queued: {epoch: number; servers: any[]; owner: number | undefined} | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

const text = (value: unknown) => (typeof value === 'string' ? value : undefined);
const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
// The two kinds of startup value that choose a server's artwork. The panel's
// overview already reduces variables to these; this does not rely on it.
function savedVariable(variable: any) {
  const name = text(variable?.env_variable),
    value = String(variable?.server_value ?? '');
  if (name === 'MINECRAFT_LOADER')
    return /^[a-z0-9_-]{1,32}$/.test(value) ? {attributes: {env_variable: name, server_value: value}} : undefined;
  if (name && ['APP_ID', 'APPID', 'STEAM_APP_ID', 'STEAMAPPID'].includes(name.toUpperCase()))
    return /^[1-9][0-9]{0,11}$/.test(value) ? {attributes: {env_variable: name, server_value: value}} : undefined;
  return undefined;
}
/**
 * Exactly what a server card draws and what picks its artwork. Nothing else
 * in the panel's answer is saved, whatever a panel chooses to send: no live
 * readings, allocations, startup commands or other variable values.
 */
export function savedServerCard(server: any) {
  const limits =
    server?.limits && typeof server.limits === 'object'
      ? {cpu: amount(server.limits.cpu), memory: amount(server.limits.memory), disk: amount(server.limits.disk)}
      : undefined;
  const artwork =
    server?.artwork && typeof server.artwork === 'object'
      ? {
          game: server.artwork.game === 'minecraft' ? 'minecraft' : undefined,
          server_icon: text(server.artwork.server_icon),
          pack_icon: text(server.artwork.pack_icon),
          pack_name: text(server.artwork.pack_name),
        }
      : undefined;
  const variables = Array.isArray(server?.relationships?.variables?.data)
    ? server.relationships.variables.data
        .map((variable: any) => savedVariable(variable?.attributes ?? variable))
        .filter(Boolean)
    : [];
  return {
    uuid: text(server?.uuid),
    identifier: text(server?.identifier),
    name: text(server?.name),
    description: text(server?.description),
    node: text(server?.node),
    status: text(server?.status) ?? null,
    is_installing: server?.is_installing === true,
    limits,
    game: text(server?.game),
    egg_name: text(server?.egg_name),
    docker_image: text(server?.docker_image),
    artwork,
    relationships: {variables: {data: variables}},
  };
}

function savedServers(): any[] | undefined {
  // Nothing is known about the servers yet, so each one shows as being checked.
  return readSavedList<any>('overview', ['uuid'])?.map(s => ({
    ...s,
    liveState: s.status || (s.is_installing ? 'installing' : 'unknown'),
  }));
}
function save(servers: any[], epoch: number, owner: number | undefined) {
  if (epoch !== queryCacheEpoch()) return;
  const now = Date.now();
  if (saved.epoch !== epoch) saved = {epoch, at: 0, text: '', written: 0, owner: undefined};
  saved.at = now;
  if (owner === undefined) return;
  const list = servers.map(savedServerCard);
  const next = JSON.stringify(list);
  if (next === saved.text && owner === saved.owner && now - saved.written < refresh) return;
  saved.text = next;
  saved.owner = owner;
  saved.written = now;
  writeAccountSnapshot('overview', list, owner);
}
export function readOverviewSnapshot() {
  return snapshot?.epoch === queryCacheEpoch() && Date.now() - snapshot.at < 300_000
    ? snapshot.servers
    : savedServers();
}
/**
 * `owner` is snapshotOwner() from when the list in `servers` was asked for:
 * the copy is saved for that account, in that session, or not at all.
 */
export function writeOverviewSnapshot(servers: any[], epoch: number, owner: number | undefined) {
  if (epoch !== queryCacheEpoch()) return;
  const now = Date.now();
  snapshot = {epoch, at: now, servers};
  // A list that was restored, not asked for, is kept in memory only. It must
  // not take the place of a save that is waiting for a list that was asked for.
  if (owner === undefined) return;
  const wait = saved.epoch === epoch ? saved.at + saveInterval - now : 0;
  if (wait <= 0) {
    queued = undefined;
    save(servers, epoch, owner);
    return;
  }
  queued = {epoch, servers, owner};
  timer ??= setTimeout(() => {
    timer = undefined;
    const latest = queued;
    queued = undefined;
    if (latest) save(latest.servers, latest.epoch, latest.owner);
  }, wait);
  // Never keep a test or a closing tab alive for a pending save.
  if (typeof timer === 'object') timer.unref?.();
}
