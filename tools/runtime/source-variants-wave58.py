#!/usr/bin/env python3
"""FOF/NMRIH source-only preflight candidate. No publisher or process calls in preflight."""
import importlib
import os
from pathlib import Path
import re
import sys
from source_pair_preflight import bounded_text, safe_path
from steam_template import arguments

GAMES = {'295230': ('fof', 'fof_revenge', 32, 'srcds_run'),
         '317670': ('nmrih', 'nms_northway', 8, 'srcds_run')}

def preflight(root, environment, require_binary=True, wine_available=None):
    """Pure validation and explicit-first port selection; no files are changed."""
    root = Path(root).resolve()
    env = dict(environment)
    app = env.get('SRCDS_APPID')
    if app not in GAMES:
        raise ValueError('This adapter supports FOF and NMRIH only')
    game, default_map, capacity, launcher = GAMES[app]
    if env.get('SRCDS_GAME', game) != game:
        raise ValueError('Game directory does not match the application')
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0' if app == '293030' else '1'))
    if automatic not in ('0', '1'):
        raise ValueError('Automatic updates must be 0 or 1')
    map_key = 'SRV_MAP' if app == '293030' else 'SRCDS_MAP'
    selected_map = env.get(map_key, default_map)
    if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', selected_map) or any(p in ('', '.', '..') for p in selected_map.split('/')):
        raise ValueError('Invalid native map')
    env[map_key] = selected_map
    max_key = 'SRV_MAXPLAYERS' if app == '293030' else 'MAX_PLAYERS'
    maximum = int(env.get(max_key, '8' if app == '317670' else '24'))
    if not 1 <= maximum <= capacity:
        raise ValueError('Player count is outside native limits')
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Allocated native ports are required')
    ports = [int(p) for p in raw.split(',')]
    primary = int(env['SERVER_PORT'])
    if len(ports) != len(set(ports)) or primary not in ports or any(not 1025 <= p <= 65535 for p in ports):
        raise ValueError('Invalid Source allocations')
    used = {primary}
    # Reserve explicit roles first, so automatic client allocation cannot
    # consume the operator's explicit SourceTV allocation.
    for key in ('SRCDS_CPORT', 'SRCDS_STV'):
        value = int(env.get(key, '0'))
        if value:
            if value not in ports or value in used:
                raise ValueError('Native roles require distinct allocations')
            used.add(value)
            env[key] = str(value)
    for key in ('SRCDS_CPORT', 'SRCDS_STV'):
        if int(env.get(key, '0')) == 0:
            available = sorted(set(ports) - used)
            if not available:
                raise ValueError('Three allocated native ports are required')
            env[key] = str(available[0])
            used.add(available[0])
    for key in ('PUBLIC_SERVER', 'TV_ENABLE'):
        if env.get(key, '0') not in ('0', '1'):
            raise ValueError('Native switches must be 0 or 1')
    for key in ('HOSTNAME', 'SERVER_PASSWORD', 'RCON_PASSWORD'):
        bounded_text(env.get(key, 'Source dedicated server' if key == 'HOSTNAME' else ''))
    token = env.get('STEAM_GSLT', '')
    if token and not re.fullmatch(r'[A-Za-z0-9]{1,128}', token):
        raise ValueError('Invalid game-server login token')
    for name in ('voltra-managed.cfg', 'voltra-server.cfg', 'voltra-login.cfg'):
        target = safe_path(root, game + '/cfg/' + name)
        if target.exists() and target.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Oversized managed Source configuration')
        if target.exists():
            target.read_text(encoding='utf-8')
    safe_path(root, '.voltra/source', directory=True)
    safe_path(root, '.voltra/source/config-backups', directory=True)
    binary = safe_path(root, launcher)
    if require_binary and not binary.is_file():
        raise ValueError('Reinstall to restore the native launcher')
    arguments(root, int(app), env, validate=False)
    return env, launcher, automatic


def main(root=None, environment=None, runtime=None, install=False):
    root = Path.cwd() if root is None else Path(root)
    environment = dict(os.environ if environment is None else environment)
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '1'))
    env, launcher, automatic = preflight(root, environment, require_binary=not install and automatic != '1')
    runtime = runtime or importlib.import_module('source_variant_runtime')
    if install or automatic == '1':
        runtime.update(root, int(env['SRCDS_APPID']), env=env, validate=install, required=(launcher,))
    env, _, _ = preflight(root, env)
    if install:
        return 0
    argv, child = runtime.launch(root, env)
    secrets = [env.get(k, '') for k in ('SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_GSLT', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    return runtime.run(root, argv, child, 'quit', secrets, terminal_input=True)


if __name__ == '__main__':
    if len(sys.argv) not in (2, 3) or sys.argv[1] not in GAMES or os.environ.get('SRCDS_APPID') != sys.argv[1] or len(sys.argv) == 3 and sys.argv[2] != '--install':
        raise ValueError('The fixed Source recipe and application must match')
    raise SystemExit(main(install=len(sys.argv) == 3))
