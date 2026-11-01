#!/usr/bin/env python3
"""Black Mesa/Contagion preflight; acquisition and supervision stay shared."""
import importlib
import os
from pathlib import Path
import re
import shutil
import sys

GAMES = {'346680': ('bms', 'dm_crossfire', 128, 'srcds_run'),
         '293030': ('contagion', 'ce_barlowe', 32, 'contagion_dedicated')}


def bounded_text(value, limit=128):
    if not isinstance(value, str) or len(value.encode()) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value) or any(c in value for c in '"\\;'):
        raise ValueError('Invalid Source native text')


def safe_path(root, relative, directory=False):
    target = root / relative
    current = root
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Source managed path uses a symbolic link')
        if current != target and current.exists() and not current.is_dir():
            raise ValueError('Source managed parent is not a directory')
    if not target.resolve().is_relative_to(root):
        raise ValueError('Source managed path leaves the volume')
    if target.exists() and (not target.is_dir() if directory else not target.is_file()):
        raise ValueError('Source managed path has the wrong file type')
    return target


def preflight(root, environment, require_binary=True, wine_available=None):
    """Pure validation and explicit-first port selection; no files are changed."""
    root = Path(root).resolve()
    env = dict(environment)
    app = env.get('SRCDS_APPID')
    if app not in GAMES:
        raise ValueError('This adapter supports Black Mesa and Contagion only')
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
    maximum = int(env.get(max_key, '8' if app == '293030' else '32'))
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
    if app == '293030':
        windows = env.get('WINDOWS_INSTALL', '0')
        if windows not in ('0', '1'):
            raise ValueError('Unsupported Contagion platform')
        launcher = 'contagionds.exe' if windows == '1' else launcher
        config = env.get('SRV_CONFIG', 'server.cfg')
        if not re.fullmatch(r'[A-Za-z0-9_/-]{1,124}\.cfg', config) or any(p in ('', '.', '..') for p in config.split('/')) or config.startswith('voltra-'):
            raise ValueError('Invalid native configuration selector')
        safe_path(root, game + '/cfg/' + config)
        if windows == '1':
            if env.get('WINEARCH', 'win32') not in ('win32', 'win64'):
                raise ValueError('Invalid Wine architecture')
            if not re.fullmatch(r'[A-Za-z0-9_+,-]{0,256}', env.get('WINEDEBUG', '-all')):
                raise ValueError('Invalid Wine debug channels')
            value = env.get('WINEPATH', '/home/container')
            if len(value) > 1024 or any(ord(c) < 32 for c in value):
                raise ValueError('Invalid Wine library path')
            tricks = env.get('WINETRICKS_RUN', 'vcrun2013 vcrun2015 corefonts').split()
            if len(tricks) != len(set(tricks)) or any(t not in ('vcrun2013', 'vcrun2015', 'corefonts') for t in tricks):
                raise ValueError('Invalid Wine component list')
            if not (shutil.which('wine') if wine_available is None else wine_available):
                raise ValueError('Choose the supported Wine runtime image')
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
    return env, launcher, automatic


def main(root=None, environment=None, runtime=None):
    root = Path.cwd() if root is None else Path(root)
    environment = dict(os.environ if environment is None else environment)
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0' if environment.get('SRCDS_APPID') == '293030' else '1'))
    env, launcher, automatic = preflight(root, environment, require_binary=automatic != '1')
    app = env['SRCDS_APPID']
    runtime = runtime or importlib.import_module('source_next_runtime' if app == '293030' else 'source_variant_runtime')
    if automatic == '1':
        options = {'validate': False, 'required': (launcher,)}
        if app == '293030':
            options['platform'] = 'windows' if env.get('WINDOWS_INSTALL', '0') == '1' else 'linux'
        runtime.update(root, int(app), **options)
    env, _, _ = preflight(root, env)
    argv, child_environment = runtime.launch(root, env)
    credentials = [env.get(k, '') for k in ('SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_TOKEN', 'STEAM_GSLT', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    if app == '293030':
        native_runner = importlib.import_module('source_wine_runtime').run if env.get('WINDOWS_INSTALL', '0') == '1' else None
        return runtime.run_ready(root, argv, child_environment, credentials, env, native_runner=native_runner)
    return runtime.run(root, argv, child_environment, 'quit', credentials, terminal_input=True)


if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in GAMES or os.environ.get('SRCDS_APPID') != sys.argv[1]:
        raise ValueError('The fixed Source recipe and application must match')
    raise SystemExit(main())
