#!/usr/bin/env python3
"""MIT. Literal Unreal argv and preserved flat tactical server configuration."""
import os
from pathlib import Path
import re
import shlex
import signal
import time
from steam_template import _publish
from native_console import run
from tactical_install import selection, confined, install


def text(value, limit=4096):
    if not isinstance(value, str) or len(value.encode()) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value): raise ValueError('Invalid native text setting')
    return value


def integer(env, key, default, lower, upper):
    value = env.get(key, str(default))
    if not re.fullmatch(r'[0-9]{1,8}', value) or not lower <= int(value) <= upper: raise ValueError('Invalid native number: ' + key)
    return int(value)


def boolean(env, key, default='true'):
    value = env.get(key, default)
    if value not in ('true', 'false'): raise ValueError('Native boolean must be true or false: ' + key)
    return value


def service_ports(env, kind):
    """Match shared blank-auto service groups; explicit ports reserve first."""
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    main = integer(env, 'SERVER_PORT', 7787, 1025, 65535)
    reserved = {main, main + 1} if kind == 'squad' else {main}
    if any(port not in allocated or not 1025 <= port <= 65535 for port in reserved):
        raise ValueError('Allocate the primary game port and its documented companions')
    specifications = [('QUERY_PORT', (0, 1) if kind == 'squad' else (0,))]
    if kind == 'squad': specifications += [('BEACON_PORT', (0,)), ('RCON_PORT', (0,))]
    elif kind == 'postscriptum': specifications += [('RCON_PORT', (0,))]
    services = {}; automatic = []
    def group(base, offsets): return {base + offset for offset in offsets}
    def available(ports): return all(1025 <= port <= 65535 and port in allocated and port not in reserved for port in ports)
    for key, offsets in specifications:
        raw = env.get(key, '')
        if raw == '': automatic.append((key, offsets)); continue
        # Zero retains shared disabled semantics. These native roles cannot be
        # disabled, so require blank(auto) or a real assigned nonzero port.
        if not re.fullmatch(r'[1-9][0-9]{0,4}', raw): raise ValueError('Mandatory service ports require blank auto or a canonical nonzero allocation: ' + key)
        base = int(raw); ports = group(base, offsets)
        if not available(ports): raise ValueError('Explicit service group overlaps or lacks an allocation: ' + key)
        services[key] = base; reserved.update(ports)
    for key, offsets in automatic:
        base = next((port for port in sorted(allocated) if available(group(port, offsets))), None)
        if base is None: raise ValueError('No complete allocated service group is available: ' + key)
        services[key] = base; reserved.update(group(base, offsets))
    return main, services, reserved, allocated


def flat_config(root, relative, values):
    path = confined(root, relative)
    previous = path.read_bytes() if path.exists() else b''
    if len(previous) > 8 * 1024**2: raise ValueError('Tactical configuration exceeds limit')
    content = previous.decode('utf-8-sig'); newline = '\r\n' if '\r\n' in content else '\n'; seen = set(); lines = []
    for line in content.splitlines(keepends=True):
        match = re.match(r'^(\s*)([A-Za-z][A-Za-z0-9_]*)\s*=', line)
        if match and match[2] in values:
            if match[2] in seen: raise ValueError('Duplicate managed tactical setting')
            seen.add(match[2]); line = match[1] + match[2] + '=' + values[match[2]] + newline
        lines.append(line)
    if lines and not lines[-1].endswith(('\n', '\r')): lines[-1] += newline
    for key, value in values.items():
        if key not in seen: lines.append(key + '=' + value + newline)
    updated = ''.join(lines).encode('utf-8')
    if previous == updated: return
    metadata = path.stat() if path.exists() else None
    if previous:
        backup = '.voltra/tactical/config-backups/' + str(time.time_ns()) + '.cfg'
        _publish(root, backup, lambda output: output.write(previous), 0o600)
    _publish(root, relative, lambda output: output.write(updated), stat_mode := metadata.st_mode & 0o777 if metadata else 0o600)
    if metadata:
        if os.geteuid() == 0: os.chown(path, metadata.st_uid, metadata.st_gid)
        path.chmod(stat_mode)


def switches(value, allocated, roles):
    value = text(value, 8192)
    if any(c in value for c in '\\;`'): raise ValueError('Additional switches must be literal native options without shell commands')
    try: tokens = shlex.split(value, posix=True)
    except ValueError: raise ValueError('Unbalanced native additional switches') from None
    if len(tokens) > 128: raise ValueError('Too many native switches')
    secrets = []; rcon = None
    for token in tokens:
        if not re.fullmatch(r'-[A-Za-z][A-Za-z0-9_.-]*(?:=.*)?', token): raise ValueError('Use -NativeSwitch=value for additional switches')
        key, _, setting = token.partition('='); key = key.casefold()
        if key in ('-port', '-queryport', '-hostname', '-gslttoken', '-gamestatstoken', '-execcmds', '-ini'): raise ValueError('Use the dedicated typed field instead of overriding a managed native switch')
        if key == '-rconlistenport':
            if not setting.isdecimal() or int(setting) not in allocated or int(setting) in roles: raise ValueError('Optional RCON must use a distinct allocation')
            rcon = int(setting)
        if 'password' in key or 'token' in key:
            if not setting: raise ValueError('Private native switch requires a literal value')
            secrets.append(setting)
    if any(t.casefold() == '-rcon' for t in tokens) and rcon is None: raise ValueError('Enabled RCON requires an explicitly allocated -RconListenPort')
    return tokens, secrets


ORIGINAL_CASE_FIELDS = {
    'squad': ('servername', 'maxplayers', 'reservedslots', 'allowteamchange', 'advertise', 'ptciu', 'teambal', 'recorddemos'),
    'postscriptum': ('hostname', 'maxplayers', 'reservedslots', 'allowteamchange', 'advertise', 'team_change', 'teambalance', 'demo_recording'),
}


def environment_aliases(env):
    kind, _, _, _ = selection(env)
    result = dict(env)
    # Preserve original API names while accepting the observed uppercase native
    # environment form. Conflicts name only the key, never either supplied value.
    for original in ORIGINAL_CASE_FIELDS.get(kind, ()):
        upper = original.upper()
        if original in env and upper in env and env[original] != env[upper]:
            raise ValueError('Conflicting original and uppercase variable ' + original)
        if upper in env: result[original] = env[upper]
    return result


def configure(root, env):
    env = environment_aliases(env)
    root = root.resolve(); kind, app, game, executable = selection(env); binary = confined(root, executable)
    if not binary.is_file(): raise ValueError('Publisher dedicated binary is missing')
    main, services, roles, allocated = service_ports(env, kind)
    query = services['QUERY_PORT']
    secrets = [env.get(k, '') for k in ('GSLTT', 'GST', 'RCON_PASSWORD', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    argv = [str(binary)]
    config = None
    if kind == 'sandstorm':
        game_map = env.get('MAP_NAME', 'Canyon'); scenario = env.get('SCENARIO', 'Scenario_Crossing_Checkpoint_Insurgents')
        if not all(re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', value) and '..' not in value.split('/') for value in (game_map, scenario)): raise ValueError('Choose native map and scenario IDs')
        maximum = integer(env, 'MAX_PLAYERS', 28, 1, 128); name = text(env.get('HOSTNAME', 'My Insurgency Server'), 64)
        tokens = [text(env.get(key, ''), 512) for key in ('GSLTT', 'GST')]
        if any(token and not re.fullmatch(r'[A-Za-z0-9_.-]{1,512}', token) for token in tokens): raise ValueError('Invalid publisher registration token')
        extra, extra_secrets = switches(env.get('ADDSWITCHES', ''), allocated, roles); secrets += extra_secrets
        argv += [game_map + '?Scenario=' + scenario + '?MaxPlayers=' + str(maximum), '-Port=' + str(main), '-QueryPort=' + str(query), '-log', '-hostname=' + name]
        if tokens[0]: argv += ['-GSLTToken=' + tokens[0]]
        if tokens[1]: argv += ['-GameStats', '-GameStatsToken=' + tokens[1]]
        argv += extra
        ready = b'LogGameState: Match State Changed from LoadingAssets to WaitingToStart'
    else:
        maximum = integer(env, 'maxplayers', 80, 1, 100); reserved = integer(env, 'reservedslots', 0, 0, maximum)
        name = text(env.get('servername' if kind == 'squad' else 'hostname', 'Tactical server'), 80 if kind == 'squad' else 32)
        if any(c in name for c in '"\\'): raise ValueError('Native flat server name cannot contain quotes or backslashes')
        values = {'ServerName': '"' + name + '"' if kind == 'squad' else name, 'MaxPlayers': str(maximum), 'NumReservedSlots': str(reserved)}
        for key, alias in [('AllowTeamChanges', 'allowteamchange'), ('ShouldAdvertise', 'advertise'), ('PreventTeamChangeIfUnbalanced', 'ptciu' if kind == 'squad' else 'team_change'), ('EnforceTeamBalance', 'teambal' if kind == 'squad' else 'teambalance'), ('RecordDemos', 'recorddemos' if kind == 'squad' else 'demo_recording')]: values[key] = boolean(env, alias)
        config = (game + '/ServerConfig/Server.cfg', values)
        argv += (['SquadGame'] if kind == 'squad' else []) + ['Port=' + str(main), 'QueryPort=' + str(query)]
        role_key = 'BEACON_PORT' if kind == 'squad' else 'RCON_PORT'; port = services[role_key]
        argv += [('-beaconport=' if kind == 'squad' else '-RCONPORT=') + str(port)]
        if kind == 'squad':
            argv += ['RCONPORT=' + str(services['RCON_PORT'])]
        else: argv += ['-RCONPASSWORD=' + text(env.get('RCON_PASSWORD', ''), 128), '-fullcrashdump', '-log']
        ready = b'Engine Initialization'
    child = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'): child.pop(key, None)
    child['HOME'] = str(root)
    library = env.get('LD_LIBRARY_PATH', str(root / 'linux64'))
    if library == '.': library = str(root)
    for segment in library.split(':'):
        if not segment or not Path(segment).resolve().is_relative_to(root): raise ValueError('Native library path must remain in server volume')
    child['LD_LIBRARY_PATH'] = library
    if config: flat_config(root, *config)
    argv += ['-stdout', '-FullStdOutLogOutput']
    return argv, child, secrets, ready


def main(root, env):
    env = environment_aliases(env)
    kind, app, game, executable = selection(env)
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'): raise ValueError('Auto update must be0or1')
    if automatic == '1' and env.get('SRCDS_APPID', str(app)): install(root, env, validate=False)
    argv, child, secrets, ready = configure(root, env)
    return run(root, argv, child, '\x03', credentials=secrets, ready_marker=ready, terminal_input=True, stop_signal=signal.SIGINT)


if __name__ == '__main__': raise SystemExit(main(Path.cwd(), dict(os.environ)))
