#!/usr/bin/env python3
"""MIT. Typed Source dedicated-server launcher with an operator-owned server.cfg."""
import os
from pathlib import Path
import re
import tempfile
import time
from native_console import run
from source_install import update

GAMES = {'232330': ('cstrike', 'de_dust2', 64), '232250': ('tf', 'ctf_2fort', 128)}


def quoted(value, maximum=128):
    # Source's command buffer has a second parsing stage. Do not guess at
    # shell-style escaping: refuse command delimiters and ambiguous escapes.
    if len(value.encode('utf-8')) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value) or any(c in value for c in '"\\;'):
        raise ValueError('Source settings cannot contain quotes, backslashes, semicolons or control characters')
    return '"' + value + '"'


def private_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.voltra-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            output.write(content)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def configure(root, env, *, source_tv=True, player_limit=True, launcher='srcds_run', client_allocation=True, server_config_selector=True):
    root = root.resolve()
    app = env.get('SRCDS_APPID', '')
    if app not in GAMES: raise ValueError('Choose a reviewed Source server application')
    if launcher not in ('srcds_run', 'srcds_run_64', 'contagion_dedicated', 'contagionds.exe'): raise ValueError('Choose a reviewed publisher launcher')
    game, default_map, capacity = GAMES[app]
    if env.get('SRCDS_GAME', game) != game: raise ValueError('Game directory does not match the application')
    game_map = env.get('SRCDS_MAP', default_map)
    if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', game_map) or any(part in ('', '.', '..') for part in game_map.split('/')):
        raise ValueError('Choose a native map name without traversal or console commands')
    main = int(env['SERVER_PORT'])
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    if main not in allocated or any(not 1025 <= p <= 65535 for p in allocated):
        raise ValueError('Source game ports must be allocated and above 1024')
    available = sorted(allocated - {main})
    ports = []
    if not client_allocation:
        if source_tv: raise ValueError('SourceTV requires its reviewed allocation policy')
        port = int(env.get('SRCDS_CPORT', '0'))
        if port != 0 and (not 1025 <= port <= 65535 or port == main): raise ValueError('Choose a distinct optional outgoing client port above 1024')
        ports.append(port)
    for key in (('SRCDS_CPORT', 'SRCDS_STV') if source_tv else ('SRCDS_CPORT',)) if client_allocation else ():
        port = int(env.get(key, '0'))
        if port == 0:
            if not available: raise ValueError('Allocate ' + ('three' if source_tv else 'two') + ' distinct ports on the game address')
            port = available[0]
        if port not in available: raise ValueError(key + ' must be a distinct additional allocation')
        available.remove(port); ports.append(port)
    maximum = int(env.get('MAX_PLAYERS', '24')) if player_limit else None
    if player_limit and not 1 <= maximum <= capacity: raise ValueError('Player limit is outside the native game range')
    public = env.get('PUBLIC_SERVER', '0')
    tv = env.get('TV_ENABLE', '0')
    if public not in ('0', '1') or source_tv and tv not in ('0', '1'): raise ValueError('Listing and SourceTV controls must be 0 or 1')
    token_key = 'STEAM_TOKEN' if game == 'cstrike' else 'STEAM_GSLT'
    token = env.get(token_key, '')
    if token and not re.fullmatch(r'[A-Za-z0-9]{1,128}', token): raise ValueError('Invalid game server login token')
    if game == 'cstrike' and public == '1' and not token:
        raise ValueError('Counter-Strike Source Internet mode requires a GSLT for game AppID 240')
    values = {'hostname': quoted(env.get('HOSTNAME', 'Source dedicated server'), 128),
              'sv_password': quoted(env.get('SERVER_PASSWORD', ''), 128),
              'rcon_password': quoted(env.get('RCON_PASSWORD', ''), 128),
              'sv_lan': '0' if public == '1' else '1'}
    if source_tv: values.update({'tv_enable': tv, 'tv_port': str(ports[1])})
    target = root / game / 'cfg/voltra-managed.cfg'
    wrapper = root / game / 'cfg/voltra-server.cfg'
    login = root / game / 'cfg/voltra-login.cfg'
    state = root / '.voltra/source'
    backups = state / 'config-backups'
    executable = root / launcher
    for path in (target, wrapper, login, state, backups, executable):
        if not path.resolve().is_relative_to(root): raise ValueError('Source path escapes the server volume')
    if not executable.is_file(): raise ValueError('Steam installation is missing ' + launcher)
    content = '// Managed by the setup form. Advanced settings remain in server.cfg.\n' + ''.join(key + ' ' + value + '\n' for key, value in values.items())
    original = target.read_text(encoding='utf-8') if target.exists() else ''
    if content != original:
        if target.exists():
            backup = backups / (str(time.time_ns()) + '.cfg')
            if not backup.resolve().is_relative_to(root): raise ValueError('Source backup escapes the server volume')
            private_write(backup, original)
        private_write(target, content)
    else: target.chmod(0o600)
    # The publisher executes server.cfg on each map. A dedicated wrapper config
    # executes it first, then reapplies only the form's managed settings.
    private_write(wrapper, 'exec server.cfg\nexec voltra-managed.cfg\n')
    private_write(login, ('sv_setsteamaccount ' + quoted(token) + '\n') if token else '// Anonymous game server login.\n')
    argv = [str(executable), '-game', game, '-console', '-ip', '0.0.0.0', '-port', str(main),
            '-strictportbind', '-norestart']
    if player_limit: argv += ['-maxplayers', str(maximum)]
    if ports[0]: argv += ['+clientport', str(ports[0])]
    if source_tv: argv += ['+tv_port', str(ports[1])]
    if server_config_selector: argv += ['+servercfgfile', 'voltra-server.cfg', '+exec', 'voltra-managed.cfg']
    argv += ['+sv_lan', values['sv_lan'],
             '+exec', 'voltra-login.cfg', '+map', game_map]
    environment = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD'): environment.pop(key, None)
    environment['LD_LIBRARY_PATH'] = str(root / 'bin') + ':' + str(root / 'bin/linux64')
    return argv, environment


if __name__ == '__main__':
    root = Path.cwd()
    automatic = os.environ.get('VOLTRA_STEAM_AUTO_UPDATE', os.environ.get('AUTO_UPDATE', '1'))
    if automatic not in ('0', '1'): raise ValueError('AUTO_UPDATE must be 0 or 1')
    app = os.environ.get('SRCDS_APPID', '')
    if app not in GAMES: raise ValueError('Unsupported Source application')
    if automatic == '1': update(root, int(app), validate=False, required=('srcds_run',))
    argv, environment = configure(root, os.environ)
    credentials = [os.environ.get(key, '') for key in ('SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_TOKEN', 'STEAM_GSLT', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    raise SystemExit(run(root, argv, environment, 'quit', credentials, terminal_input=True))
