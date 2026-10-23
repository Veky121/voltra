import fs from 'node:fs';
import path from 'node:path';
const catalog = JSON.parse(fs.readFileSync('internal/panel/game_library/upstream/catalog.json'));
const current = JSON.parse(fs.readFileSync('internal/panel/game_library/overrides.json'));
const destination = process.argv[2] || '.local/goldsrc-games/profiles.json';
const profiles = {};
for (const [recipe, flavor] of [
  ['counter_strike/counter_strike_1.6/egg-counter-strike1-6--vanilla.json', 'cs16'],
  ['hlds_server/vanilla/egg-custom-h-l-d-s-engine-game.json', 'generic'],
  ['hlds_server/rehlds/egg-custom-re-h-l-d-s-engine-game.json', 'rehlds'],
]) {
  const entry = catalog.entries.find(entry => entry.path === recipe);
  const egg = structuredClone(entry.egg);
  egg.features = [...new Set([...(egg.features || []), 'voltra_steam_template'])];
  egg.docker_images = {'Debian Steam runtime': 'ghcr.io/ptero-eggs/steamcmd@sha256:c8a93dc0e256d1dba10aed6a0d8d6e739d4f1809f4e3b7428d0c01adc6e6e68b'};
  egg.startup = `exec env VOLTRA_GOLDSRC_RECIPE=${flavor} PYTHONHOME=/home/container/.voltra/python LD_LIBRARY_PATH=/home/container/.voltra/python/lib .voltra/python/bin/python3 .voltra/goldsrc_runtime.py`;
  egg.config = {files: '{}', startup: JSON.stringify({done: 'VOLTRA_GOLDSRC_READY'}), logs: '{}', stop: 'quit'};
  const controls = [
    ['Server name', 'HOSTNAME', 'Native server browser name.', 'Counter-Strike 1.6 Server', 'required|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'],
    ['Game directory', 'HLDS_GAME', 'Native HLDS mod depot name. Changing it requires reinstall and a map belonging to that mod. Examples: cstrike, valve, dod, tfc. Custom mods require their native game files.', 'cstrike', flavor === 'cs16' ? 'required|string|in:cstrike' : 'required|string|max:32|regex:/^[A-Za-z0-9_]+$/'],
    ['Map', flavor === 'cs16' ? 'SRV_STARTMAP' : 'SRCDS_MAP', 'Installed native BSP map name without the extension. Half-Life uses maps such as crossfire; Counter-Strike uses de_dust2.', 'de_dust2', 'required|string|max:64|regex:/^[A-Za-z0-9_-]+$/'],
    ['Maximum players', 'SRV_SLOTS', 'Native GoldSrc player limit.', '32', 'required|integer|between:1,32'],
    ['Pingboost', 'SRV_PINGBOOST', 'Native Linux timing mode, 0 disables boosting.', flavor === 'cs16' ? '2' : '0', 'required|integer|between:0,3'],
    ['Server ticrate', 'SYS_TICRATE', 'Native sys_ticrate. Higher values can increase CPU usage.', flavor === 'cs16' ? '1200' : '100', 'required|integer|between:10,2000'],
    ['VAC security', 'SRV_SECURE', 'Native Valve anti-cheat selection. Internet VAC connectivity requires network access.', 'secure', 'required|string|in:secure,insecure'],
    ['Steam service port', 'VAC_PORT', 'Zero automatically selects a distinct additional allocation. Explicit values must be allocated.', '0', 'required|integer|between:0,65535'],
    ['Internet mode', 'PUBLIC_SERVER', 'Disabled selects native LAN mode. Internet reachability and authenticated client joins require separate acceptance.', '0', 'required|boolean'],
    ['Server password', 'SERVER_PASSWORD', 'Empty permits joining without a password.', '', 'nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'],
    ['RCON password', 'RCON_PASSWORD', 'Empty disables remote administration.', '', 'nullable|string|max:128|not_regex:/[\\x00-\\x1f\\x7f"\\\\;]/'],
    ['Automatic updates', 'AUTO_UPDATE', 'Use the shared typed updater on startup; the panel disables the runtime image legacy updater.', '0', 'required|boolean'],
    ['Steam beta branch', 'SRCDS_BETAID', 'Empty selects the current public publisher build. steam_legacy selects the publisher legacy branch.', '', 'nullable|string|max:64|regex:/^[A-Za-z0-9_.-]+$/'],
    ['Beta password', 'SRCDS_BETAPASS', 'Only used for a selected private publisher branch.', '', 'nullable|string|max:128'],
  ];
  for (const [name, key, description, value, rules] of controls) {
    const previous = egg.variables.find(variable => variable.env_variable === key);
    const fields = {name, description, default_value: value, rules, user_viewable: true, user_editable: true, field_type: 'text'};
    if (previous) Object.assign(previous, fields);
    else egg.variables.push({env_variable: key, ...fields});
  }
  for (const variable of egg.variables) {
    if (variable.env_variable === 'SRCDS_APPID') variable.rules = 'required|string|in:90';
    if (variable.env_variable === 'HLDS_GAME' && flavor === 'cs16') variable.user_editable = false;
    if (variable.env_variable === 'HLDS_GAME' && flavor === 'rehlds') variable.default_value = 'valve';
    if (variable.env_variable === 'HOSTNAME' && flavor !== 'cs16') variable.default_value = 'GoldSrc dedicated server';
    if (variable.env_variable === 'SRCDS_MAP' && flavor === 'rehlds') variable.default_value = 'crossfire';
    if (variable.env_variable === 'SRCDS_BETAID' && flavor === 'rehlds') Object.assign(variable, {default_value:'steam_legacy', rules:'required|string|in:steam_legacy', description:'ReHLDS requires the pre-anniversary publisher steam_legacy branch.'});
    if (variable.env_variable === 'VERSION') Object.assign(variable, {rules:'required|string|max:32|regex:/^(latest|v?[0-9]+(?:\\.[0-9]+){2,3})$/',description:'latest selects the reviewed ReHLDS 3.15.0.896 release. Explicit release tags resolve only within the official repository.'});
    if (variable.env_variable === 'VALIDATE') variable.rules = 'required|boolean';
  }
  let script = `#!/bin/bash\nset -euo pipefail\nexport DEBIAN_FRONTEND=noninteractive\nexport VOLTRA_GOLDSRC_RECIPE=${flavor}\ncd /mnt/server\napt-get update\napt-get install -y --no-install-recommends python3 ca-certificates lib32gcc-s1 lib32stdc++6\nmkdir -p .voltra\n`;
  for (const [source, target] of [
    ['steam-template.py', 'steam_template.py'], ['bundle-debian-python.py', 'bundle_debian_python.py'],
    ['native-console.py', 'native_console.py'], ['goldsrc-runtime.py', 'goldsrc_runtime.py'], ['goldsrc-install.py', 'goldsrc_install.py'],
  ]) script += `cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/' + source, 'utf8')}\nVOLTRA_SOURCE\n`;
  if (flavor === 'rehlds') {
    for (const [source, target] of [['native-release.py','native_release.py'],['rehlds-install.py','rehlds_install.py'],['rehlds-release.json','rehlds-release.json'],['rehlds-license.txt','rehlds-license.txt']]) script += `cat > .voltra/${target} <<'VOLTRA_SOURCE'\n${fs.readFileSync('internal/panel/game_library/scripts/' + source, 'utf8')}\nVOLTRA_SOURCE\n`;
  }
  script += 'python3 .voltra/bundle_debian_python.py\nPYTHONPATH=.voltra python3 .voltra/goldsrc_install.py\n';
  egg.scripts.installation = {script, container: 'debian:bookworm-slim', entrypoint: 'bash'};
  profiles[recipe] = {upstream_sha256: entry.sha256, revision: 'goldsrc-native-v1', platforms: ['linux/amd64'], required_ports: 2,
    defaults: {memory: 1024, disk: 4096}, egg, verification: current[recipe]?.verification || 'not_verified',
    detail: current[recipe]?.detail || 'Typed native GoldSrc setup implemented; publisher install and runtime acceptance pending.',
    setup_steps: [
      'Choose a Linux x64 node with two free ports on the same address. The primary port handles gameplay and query; another allocation handles the Steam service.',
      'The CS 1.6 recipe fixes the game to cstrike. The generic recipe selects the native HLDS mod depot and requires a matching installed map. Changing the game requires reinstall.',
      'Native settings use a private managed config, executed after your existing server.cfg. Advanced configuration, ban lists, custom maps and addons remain in the game directory.',
      'Reinstall and automatic updates preserve root game configuration files, liblist.gam plugin registration, motd, mapcycle and addon files. Back up edited publisher maps and binaries separately.',
      'Console commands pass through to the native dedicated server. Stop sends quit. GoldSrc has no persistent world save; verify custom configuration, maps, bans and plugins through restart and reinstall.',
      'LAN mode is the default. VAC backend connectivity, Internet listing and real client joins are separate from native process and LAN query readiness.',
    ]};
}
fs.mkdirSync(path.dirname(destination), {recursive: true});
fs.writeFileSync(destination, JSON.stringify(profiles, null, 2) + '\n');
console.log('Staged ' + Object.keys(profiles).length + ' GoldSrc profiles: ' + destination);
