import type {QuickField} from '../game-library/gameSetupModel.ts';
import {readableSettingName} from './gameSettingsLayout.ts';

// Plain words for game settings: a label, one sentence on what the setting
// does, and Details for rules and defaults. Settings come from each game's own
// files, so the descriptions are keyed by the setting's name, the same way in
// every game that uses it. A game-specific entry ("minecraft:motd") wins.
// A setting with an obvious label and no entry gets no description.

const normal = (key: string) =>
  key
    .replace(/^\//, '')
    .split('/')
    .at(-1)!
    .replace(/^b(?=[A-Z])/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Leaves this common mean different things inside a section of a larger file
// (a database password, a plugin's name), so they are described only at the top.
const ambiguous = new Set(['password', 'port', 'public', 'world', 'seed', 'region', 'motd', 'difficulty', 'pvp']);
const players = 'How many players can be online at once.';
const join = 'The password players enter to join; leave it empty for an open server.';
const descriptions: Record<string, string> = {
  // Shared by many games.
  servername: 'The name players see in the server browser.',
  'valheim:name': 'The name players see in the server browser.',
  serverdescription: 'A short description shown in the server browser.',
  serverpassword: join,
  password: join,
  joinpassword: join,
  adminpassword: 'Gives admin commands to players who enter it in game.',
  maxplayers: players,
  serverplayermaxnum: players,
  servermaxplayercount: players,
  playerlimit: players,
  maxplayercount: players,
  slots: players,
  port: 'The port players connect to.',
  serverport: 'The port players connect to.',
  gameport: 'The port players connect to.',
  queryport: 'The port server browsers use to read the player count and details.',
  enablequery: 'Lets server browsers read the player count and details.',
  rconport: 'The port admin tools use to run console commands remotely.',
  rconpassword: 'The password admin tools use to run console commands remotely.',
  rconenabled: 'Lets admin tools run console commands remotely.',
  enablercon: 'Lets admin tools run console commands remotely.',
  public: 'Lists the server in the public server browser.',
  world: 'The world to load, or to create if it does not exist yet.',
  worldname: 'The world to load, or to create if it does not exist yet.',
  levelname: 'The world folder to load, or to create if it does not exist yet.',
  seed: 'The seed used to generate a new world.',
  worldseed: 'The seed used to generate a new world.',
  levelseed: 'The seed used to generate a new world.',
  difficulty: 'How hard the game is.',
  gamedifficulty: 'How hard the game is.',
  pvp: 'Lets players hurt each other.',
  ispvp: 'Lets players hurt each other.',
  enableplayertoplayerdamage: 'Lets players hurt each other.',
  welcomemessage: 'A message shown to players when they join.',
  motd: 'A message shown to players when they join.',
  region: 'The region shown in the server browser.',
  publicip: 'The address shown to players in the server browser.',
  publicport: 'The port shown to players in the server browser.',
  serverip: 'The address the server listens on, or every address when left empty.',
  saveinterval: 'How often the world is saved.',
  autosaveinterval: 'How often the world is saved.',

  // 7 Days to Die
  daynightlength: 'How many real minutes one game day lasts.',
  daylightlength: 'How many hours of each game day are daylight.',
  bloodmoonfrequency: 'How many days pass between blood moon hordes.',
  lootabundance: 'How much loot is found, compared with normal.',

  // Palworld
  exprate: 'How fast players and Pals gain experience.',
  palcapturerate: 'How easily Pals are caught.',
  palspawnnumrate: 'How many Pals appear in the world.',
  daytimespeedrate: 'How fast daytime passes.',
  nighttimespeedrate: 'How fast night passes.',
  collectiondroprate: 'How much players get from gathering.',
  deathpenalty: 'What players drop when they die.',
  isusebackupsavedata: 'Keeps automatic backups of the world.',
  paldamagerateattack: 'How much damage Pals deal.',
  paldamageratedefense: 'How much damage Pals take.',
  playerdamagerateattack: 'How much damage players deal.',
  playerdamageratedefense: 'How much damage players take.',
  playerstomachdecreacerate: 'How fast players get hungry.',
  playerstaminadecreacerate: 'How fast players use stamina.',
  playerautohpregenerate: 'How fast players heal on their own.',
  playerautohpregenerateinsleep: 'How fast players heal while sleeping.',
  palstomachdecreacerate: 'How fast Pals get hungry.',
  palstaminadecreacerate: 'How fast Pals use stamina.',
  palautohpregenerate: 'How fast Pals heal on their own.',
  palautohpregenerateinsleep: 'How fast Pals heal while resting.',
  buildobjectdamagerate: 'How much damage buildings take.',
  buildobjectdeteriorationdamagerate: 'How fast buildings decay.',
  collectionobjecthprate: 'How tough trees and rocks are.',
  collectionobjectrespawnspeedrate: 'How fast trees and rocks grow back.',
  enemydropitemrate: 'How many items defeated enemies drop.',
  enablefriendlyfire: 'Lets players hurt members of their own guild.',
  enableinvaderenemy: 'Lets raids attack player bases.',
  enablefasttravel: 'Lets players use fast travel points.',
  isstartlocationselectbymap: 'Lets new players choose where they start.',
  existplayerafterlogout: 'Keeps a character in the world after the player leaves.',
  enabledefenseotherguildplayer: 'Lets players fight back against other guilds.',
  canpickupotherguilddeathpenaltydrop: 'Lets players pick up what other guilds drop when they die.',
  coopplayermaxnum: 'How many players can join one co-op group.',
  guildplayermaxnum: 'How many players can join one guild.',
  basecampmaxnum: 'How many bases can exist on the server.',
  basecampworkermaxnum: 'How many Pals can work at one base.',
  basecampmaxnuminguild: 'How many bases one guild can have.',
  dropitemmaxnum: 'How many dropped items can lie in the world at once.',
  dropitemalivemaxhours: 'How long dropped items stay before they disappear.',
  autoresetguildnoonlineplayers: 'Removes guilds whose members have all stayed away for a while.',
  autoresetguildtimenoonlineplayers: 'How long a guild can go without players before it is removed.',
  paleggdefaulthatchingtime: 'How many hours the largest eggs take to hatch.',
  workspeedrate: 'How fast Pals work.',
  restapienabled: 'Lets admin tools manage the server over the web.',
  restapiport: 'The port admin tools use to manage the server over the web.',
  showplayerlist: 'Shows the list of online players in game.',
  isshowjoinleftmessage: 'Shows a message when players join or leave.',
  crossplayplatforms: 'Which platforms can join.',
  allowconnectplatform: 'Which platforms can join.',
  chatpostlimitperminute: 'How many chat messages a player can send each minute.',
  useauth: 'Checks player accounts when they join.',
  banlisturl: 'Where the server reads its shared ban list from.',
  logformattype: 'The format of the server log.',

  // Minecraft server.properties
  'minecraft:motd': 'The message shown under the server name in the multiplayer list.',
  acceptstransfers: 'Lets other servers send players here.',
  allowflight: 'Lets players fly when a mod or plugin allows it, instead of removing them.',
  allownether: 'Lets players travel to the Nether.',
  broadcastconsoletoops: 'Shows console command results to online operators.',
  broadcastrcontoops: 'Shows remote console results to online operators.',
  bugreportlink: 'A link players can use to report server problems.',
  enablecommandblock: 'Lets command blocks run commands.',
  enablejmxmonitoring: 'Shares performance data with Java monitoring tools.',
  enablestatus: 'Shows the server as online in the multiplayer list.',
  enforcesecureprofile: 'Only lets players with a signed chat profile join.',
  enforcewhitelist: 'Removes players who are not on the allowlist when it is reloaded.',
  entitybroadcastrangepercentage: 'How far away players can see mobs and other entities.',
  forcegamemode: 'Puts players back into the default game mode each time they join.',
  functionpermissionlevel: 'What data pack functions are allowed to do.',
  gamemode: 'The game mode players start in.',
  generatestructures: 'Adds villages, temples and other structures to new terrain.',
  generatorsettings: 'Custom terrain settings for new worlds.',
  hardcore: 'Players become spectators when they die.',
  hideonlineplayers: 'Hides who is online from the multiplayer list.',
  initialdisabledpacks: 'Data packs left off when a new world is created.',
  initialenabledpacks: 'Data packs turned on when a new world is created.',
  leveltype: 'The kind of terrain a new world gets.',
  logips: 'Writes player IP addresses to the server log.',
  maxchainedneighborupdates: 'Limits chain reactions of block updates to protect performance.',
  maxticktime: 'How long one game tick may take before the server stops itself.',
  maxworldsize: 'How far the world can extend from its centre.',
  networkcompressionthreshold: 'Network messages larger than this are compressed.',
  onlinemode: 'Checks that every player owns a Minecraft account.',
  oppermissionlevel: 'What operators are allowed to do.',
  pausewhenemptyseconds: 'Pauses the world after it has been empty this long.',
  playeridletimeout: 'Removes players who stay idle this long.',
  preventproxyconnections: 'Blocks players whose connection does not match their account location.',
  ratelimit: 'Removes players who send too much network traffic.',
  regionfilecompression: 'How world files are compressed on disk.',
  requireresourcepack: 'Disconnects players who decline the server resource pack.',
  resourcepack: 'A link to a resource pack players download when they join.',
  resourcepackid: 'Tells players when the resource pack has changed.',
  resourcepackprompt: 'The message shown when players are asked to accept the resource pack.',
  resourcepacksha1: 'Checks that the resource pack downloaded correctly.',
  simulationdistance: 'How far from players mobs move and crops grow.',
  spawnanimals: 'Lets animals appear.',
  spawnmonsters: 'Lets monsters appear.',
  spawnnpcs: 'Lets villagers appear.',
  spawnprotection: 'How far around spawn only operators can build.',
  synchunkwrites: 'Saves world changes right away, which is safer but slower.',
  usenativetransport: 'Uses faster networking on Linux.',
  viewdistance: 'How far players can see.',
  whitelist: 'Only players on the allowlist can join.',
  textfilteringconfig: 'Settings for filtering chat messages.',
  managementserverenabled: 'Lets admin tools manage the server over the network.',
};

// Vanilla defaults, shown in Details. Only values the game itself documents.
const defaults: Record<string, string> = {
  'minecraft:maxplayers': '20',
  'minecraft:viewdistance': '10',
  'minecraft:simulationdistance': '10',
  'minecraft:spawnprotection': '16',
  'minecraft:difficulty': 'easy',
  'minecraft:gamemode': 'survival',
  'minecraft:serverport': '25565',
  'minecraft:queryport': '25565',
  'minecraft:rconport': '25575',
  'minecraft:motd': 'A Minecraft Server',
  'minecraft:levelname': 'world',
  'minecraft:pvp': 'On',
  'minecraft:whitelist': 'Off',
  'minecraft:onlinemode': 'On',
  'minecraft:allowflight': 'Off',
  'minecraft:playeridletimeout': '0 (never)',
  'minecraft:entitybroadcastrangepercentage': '100',
  'minecraft:maxticktime': '60000 ms',
  'minecraft:networkcompressionthreshold': '256 bytes',
  'minecraft:oppermissionlevel': '4',
  'minecraft:functionpermissionlevel': '2',
  'minecraft:hardcore': 'Off',
};

// Backend notes are rules, so they go in Details, worded for players.
export function plainSettingNote(text: string): string {
  const plain = text
    .replace(/\bexisting native (?:host )?value(?: only)?\s*[.;]\s*/gi, '')
    .replace(/\b(?:requires restart|restart required)\b/gi, 'Takes effect after a restart')
    .replace(/\bcurrent game-version support is unverified\b/gi, 'not yet tested with the current game version')
    .replace(/\bcustom-mode save\b/gi, 'custom save')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.replace(/(^|[.!?]\s+)([a-z])/g, (_, start: string, letter: string) => start + letter.toUpperCase());
}

export type SettingCopy = {label: string; description?: string; details: string[]};

export function settingCopy(
  field: Pick<QuickField, 'key' | 'label' | 'help' | 'min' | 'max' | 'required' | 'type'>,
  game = ''
): SettingCopy {
  const label = readableSettingName(field);
  const key = normal(field.key);
  const family = game.split('-')[0];
  const nested = field.key.replace(/^\//, '').includes('/') && !field.key.includes('/OptionSettings/');
  const description =
    descriptions[`${family}:${key}`] ?? (nested && ambiguous.has(key) ? undefined : descriptions[key]);
  const details: string[] = [];
  if (typeof field.help === 'string' && field.help.trim()) details.push(plainSettingNote(field.help));
  if (field.type === 'number' && typeof field.min === 'number' && typeof field.max === 'number')
    details.push(`Allowed: ${field.min} to ${field.max}.`);
  else if (field.type === 'number' && typeof field.min === 'number') details.push(`Lowest allowed: ${field.min}.`);
  if (/multiplier/i.test(label) || (family === 'palworld' && /rate$/.test(key))) details.push('1 is the normal rate.');
  const preset = defaults[`${family}:${key}`];
  if (preset) details.push(`Game default: ${preset}.`);
  if (field.required) details.push('Required.');
  details.push(`Saved as ${field.key.replace(/^\//, '')}.`);
  return {label, description, details};
}

/** Search over what a player reads, plus the saved name for people who know it. */
export function settingMatches(
  field: Pick<QuickField, 'key' | 'label' | 'help' | 'min' | 'max' | 'required' | 'type'>,
  query: string,
  game = ''
): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const copy = settingCopy(field, game);
  const text = `${field.key} ${copy.label} ${copy.description ?? ''}`.toLowerCase();
  return words.every(word => text.includes(word));
}
