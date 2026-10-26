import type {QuickField} from './gameSetupModel';

const names: Record<string, string> = {
  ServerName: 'Server name', ServerDescription: 'Server description', ServerPlayerMaxNum: 'Player limit',
  ServerPassword: 'Server password', AdminPassword: 'Admin password', ExpRate: 'Experience multiplier',
  PalCaptureRate: 'Capture rate multiplier', PalSpawnNumRate: 'Pal spawn multiplier',
  DayTimeSpeedRate: 'Day speed multiplier', NightTimeSpeedRate: 'Night speed multiplier',
  motd: 'Server message', 'max-players': 'Player limit', 'gamemode': 'Game mode',
  pvp: 'Player combat', 'white-list': 'Whitelist', 'online-mode': 'Verify player accounts',
  'enforce-secure-profile': 'Require secure player profiles', 'level-name': 'World name',
  'level-seed': 'World seed', 'level-type': 'World type', 'generator-settings': 'World generator settings',
  'view-distance': 'View distance', 'simulation-distance': 'Simulation distance',
  'entity-broadcast-range-percentage': 'Entity tracking range (%)',
  'max-tick-time': 'Watchdog timeout (ms)', 'player-idle-timeout': 'Idle timeout (minutes)',
  'pause-when-empty-seconds': 'Pause when empty (seconds)',
  'op-permission-level': 'Operator permission level', 'function-permission-level': 'Function permission level',
  'network-compression-threshold': 'Compression threshold (bytes)',
  'enable-rcon': 'Enable RCON', 'rcon.password': 'RCON password', 'rcon.port': 'RCON port',
  'enable-query': 'Enable query protocol', 'query.port': 'Query port',
  'enable-jmx-monitoring': 'Enable JMX monitoring', 'log-ips': 'Log player IP addresses',
  'server-ip': 'Bind address', 'server-port': 'Game port',
};

export function readableSettingName(field: Pick<QuickField, 'key' | 'label'>): string {
  const key = field.key.replace(/^\//, '');
  if (names[key]) return names[key];
  const leaf = key.split('/').at(-1)!;
  if (names[leaf]) return names[leaf];
  const original = field.label && field.label !== field.key ? field.label : key.includes('/OptionSettings/') ? leaf : key;
  return original.split('/').map(part => {
    const text = part.replace(/^b(?=[A-Z])/, '').replace(/~1/g, '/').replace(/~0/g, '~')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._-]+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }).join(' / ').replace(/\b(rcon|jmx|tls|ip|api)\b/gi, value => value.toUpperCase());
}

const minecraftGroups = [
  {id: 'general', label: 'General'},
  {id: 'world', label: 'World'},
  {id: 'players', label: 'Players'},
  {id: 'performance', label: 'Performance'},
  {id: 'network', label: 'Network'},
  {id: 'packs', label: 'Resource packs'},
  {id: 'advanced', label: 'Advanced'},
];

function minecraftGroup(key: string): string {
  if (/^(motd|max-players|gamemode|difficulty|pvp|hardcore|white-list|online-mode|allow-flight)$/.test(key)) return 'general';
  if (/resource-pack|^initial-.*packs$/.test(key)) return 'packs';
  if (/^(level-|generate-|generator-|spawn-|allow-nether|max-world-size|force-gamemode)/.test(key)) return 'world';
  if (/^(view-distance|simulation-distance|entity-broadcast|max-tick-time|max-chained|pause-when-empty|region-file)/.test(key)) return 'performance';
  if (/^(player-|enforce-|hide-online|op-permission|function-permission|enable-command-block|chat-spam|command-spam)/.test(key)) return 'players';
  if (/^(server-|query\.|enable-query|enable-status|network-|rate-limit|prevent-proxy|accepts-transfers|status-)/.test(key)) return 'network';
  return 'advanced';
}

export type SettingsGroup = {id: string; label: string; fields: QuickField[]};

const palworldGroups = [
  {id: 'server', label: 'Server'}, {id: 'world', label: 'World'},
  {id: 'players', label: 'Players'}, {id: 'pals', label: 'Pals'},
  {id: 'building', label: 'Building and bases'}, {id: 'items', label: 'Items and gathering'},
  {id: 'network', label: 'Network and administration'}, {id: 'advanced', label: 'Other settings'},
];
function palworldGroup(key: string): string {
  key = key.split('/').at(-1)!;
  if (/^(ServerName|ServerDescription|ServerPassword|ServerPlayerMaxNum)$/.test(key)) return 'server';
  if (/RCON|RESTAPI|AdminPassword|PublicIP|PublicPort|BanList|Crossplay|AllowConnect|LogFormat|Chat/.test(key)) return 'network';
  if (/Build|BaseCamp|Guild|Worker|WorkSpeed/.test(key)) return 'building';
  if (/Drop|Collection|Gather|Item|Supply/.test(key)) return 'items';
  if (/Pal|Capture|Egg/.test(key)) return 'pals';
  if (/Player|PvP|PVP|DeathPenalty|ExpRate|FriendlyFire/.test(key)) return 'players';
  if (/Difficulty|DayTime|NightTime|Weather|Random|Event|Invader|Dungeon|World/.test(key)) return 'world';
  return 'advanced';
}

export function settingsGroups(fields: QuickField[], game: string, file: string): SettingsGroup[] {
  const minecraft = game === 'minecraft' && file.endsWith('/server.properties');
  const palworld = /^palworld(?:-|$)/.test(game) || /palworldsettings\.ini$/i.test(file) || fields.some(field => field.key.includes('PalGameWorldSettings'));
  const groups = new Map<string, SettingsGroup>();
  if (minecraft) for (const group of minecraftGroups) groups.set(group.id, {...group, fields: []});
  if (palworld) for (const group of palworldGroups) groups.set(group.id, {...group, fields: []});
  for (const field of fields) {
    const section = field.key.startsWith('/') ? field.key.slice(1).split('/')[0] : field.key.includes('/') ? field.key.split('/')[0] : 'general';
    const id = minecraft ? minecraftGroup(field.key) : palworld ? palworldGroup(field.key) : section;
    if (!groups.has(id)) groups.set(id, {id, label: id === 'general' ? 'General' : readableSettingName({key: id, label: id}), fields: []});
    groups.get(id)!.fields.push(field);
  }
  if (minecraft) {
    const generalOrder = ['motd', 'max-players', 'gamemode', 'difficulty', 'online-mode', 'white-list', 'pvp', 'hardcore', 'allow-flight'];
    groups.get('general')!.fields.sort((left, right) => generalOrder.indexOf(left.key) - generalOrder.indexOf(right.key));
  }
  return [...groups.values()].filter(group => group.fields.length);
}
