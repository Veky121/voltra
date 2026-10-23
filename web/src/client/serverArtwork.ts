import {panelArtwork} from './artworkLibrary.ts';
import catalog from './serverArtworkCatalog.json' with {type: 'json'};

export type ServerArtwork = {
  id: string;
  name: string;
  src: string;
  aliases: string[];
  kind: string;
  appIds?: number[];
};

type Workload = {
	artwork?: ServerIdentityArtwork;
  game?: string;
  name?: string;
  description?: string;
  egg_name?: string;
  docker_image?: string;
  invocation?: string;
  relationships?: {variables?: {data?: {attributes?: {env_variable?: string; server_value?: unknown; default_value?: unknown}}[]}};
};

export type ServerIdentityArtwork = {game?:'minecraft';server_icon?:string;pack_icon?:string;pack_name?:string};
export function getServerIconSources(artwork?:ServerIdentityArtwork):{src:string;kind:'server'|'modpack'}[]{
  const candidates:[string|undefined,'server'|'modpack','icon'|'pack'][]=[
    [artwork?.server_icon,'server','icon'],[artwork?.pack_icon,'modpack','pack'],
  ];
  return candidates.filter((candidate):candidate is [string,'server'|'modpack','icon'|'pack']=>typeof candidate[0]==='string'&&new RegExp(`^/api/client/servers/[a-zA-Z0-9-]+/artwork/${candidate[2]}$`).test(candidate[0])).map(([src,kind])=>({src,kind}));
}

const artwork: ServerArtwork[] = catalog;
const byId = new Map(artwork.map(item => [item.id, item]));
export const fallbackArtwork = byId.get('server')!;
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const generic = new Set(['server', 'dedicated server', 'steam', 'source', 'vanilla', 'linux', 'java']);

function match(text: string): ServerArtwork | undefined {
  const variants = [text, text.replace(/([a-z0-9])([A-Z])/g, '$1 $2')].map(value => ` ${normalize(value)} `);
  let best: ServerArtwork | undefined;
  let score = 0;
  for (const item of artwork) {
    for (const alias of item.aliases) {
      if (generic.has(alias) || alias.length < 3) continue;
      // Match whole names, so a service called "Rusty" is not a Rust server.
      if (alias.length >= score && variants.some(value => value.includes(` ${alias} `))) {
        score = alias.length;
        best = item;
      }
    }
  }
  return best;
}

export function getServerArtwork(server: Workload): ServerArtwork {
 const base=resolveServerArtwork(server);return panelArtwork('server',base.id,base);
}
function resolveServerArtwork(server: Workload): ServerArtwork {
  // Explicit workload metadata wins over a user's custom display name.
  const explicit = (server.game || server.artwork?.game) && match(server.game || server.artwork?.game || '');
  if (explicit) return explicit;
  const egg = server.egg_name && match(server.egg_name);
  if (egg) return egg;
  const variables = server.relationships?.variables?.data?.map(variable => variable.attributes ?? {}) ?? [];
  if (variables.some(variable => /^(DISCORD_TOKEN|DISCORD_BOT_TOKEN|DISCORD_CLIENT_ID)$/i.test(variable.env_variable ?? ''))) return byId.get('discord')!;
  for (const variable of variables) {
    if (!/APP_?ID/i.test(variable.env_variable ?? '')) continue;
    const id = Number(variable.server_value ?? variable.default_value);
    const candidate = artwork.find(item => item.appIds?.includes(id));
    if (candidate) return candidate;
  }
  const titleText = `${server.name ?? ''} ${server.description ?? ''}`;
  if (/\bdiscord\b/i.test(titleText) && /\bbot\b/i.test(titleText)) return byId.get('discord')!;
  const title = match(titleText);
  if (title) return title;
  const runtime = `${server.docker_image ?? ''} ${server.invocation ?? ''}`;
  if (/\bcstrike\b/i.test(runtime) && /srcds/i.test(runtime)) return byId.get('counter-strike-source') ?? fallbackArtwork;
  if (/\bcstrike\b/i.test(runtime) && /hlds/i.test(runtime)) return byId.get('counter-strike-16') ?? fallbackArtwork;
  const runtimeMatch = match(runtime);
  if (runtimeMatch) return runtimeMatch;
  if (/factoryserver/i.test(runtime)) return byId.get('satisfactory') ?? fallbackArtwork;
  if (/palserver/i.test(runtime)) return byId.get('palworld') ?? fallbackArtwork;
  const context = `${server.name ?? ''} ${server.description ?? ''} ${runtime}`;
  if (/nodejs|node\.js|python|deno|bun\b|bot\b|sandbox|development|staging|plugin test|file manager/i.test(context)) return byId.get('software') ?? fallbackArtwork;
  if (/database|redis|postgres|maria|mysql|proxy|nginx/i.test(context)) return byId.get('hardware') ?? fallbackArtwork;
  return fallbackArtwork;
}
