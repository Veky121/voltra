#!/usr/bin/env python3
"""Dead Matter startup preflight, retaining shared licensed install/supervision."""
import importlib.util
import os
from pathlib import Path
import stat
import sys


def load_shared():
    source = Path(__file__).with_name('zombie-native.py')
    if not source.is_file():
        source = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/zombie-native.py'
    spec = importlib.util.spec_from_file_location('deadmatter_shared', source)
    shared = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(shared)
    return shared


def checked_path(root, relative, directory=False):
    target = root / relative
    cursor = root
    for part in Path(relative).parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError('Dead Matter paths cannot use symbolic links')
        if cursor != target and cursor.exists() and not cursor.is_dir():
            raise ValueError('Dead Matter path parent is not a directory')
    if not target.resolve().is_relative_to(root):
        raise ValueError('Dead Matter path leaves volume')
    if target.exists() and (not target.is_dir() if directory else not stat.S_ISREG(target.stat().st_mode)):
        raise ValueError('Dead Matter path has an unsupported type')
    return target


def preflight(shared, root, env, require_payload=True, acquiring=False):
    root = Path(root).absolute()
    if root.resolve() != root or root.is_symlink():
        raise ValueError('Dead Matter root must be a real directory')
    if env.get('SRCDS_APPID', '2584780') != '2584780' or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Dead Matter requires its reviewed Windows application')
    shared.ports(env, [('QUERY_PORT', 7002)])
    available = [int(port) for port in env['VOLTRA_ALLOCATED_PORTS'].split(',')]
    if any(not 1 <= port <= 65535 for port in available):
        raise ValueError('Allocated Dead Matter ports are outside native range')
    shared.text(env, 'SERVER_NAME', 'A Pterodactyl hosted server', 128)
    shared.boolean(env, 'VALIDATE')
    binary = checked_path(root, shared.GAMES['dead-matter'][2])
    checked_path(root, 'DeadMatter/Saved/Logs/DeadMatter.log')
    for relative in ('.steam/steam', '.steam/steam/steamapps/compatdata/2584780',
                     '.voltra/dead-matter-sdk', '.voltra/proton'):
        checked_path(root, relative, directory=True)
    proton = shared.helper('enshrouded-proton')
    checked_path(root, '.voltra/proton/' + proton.VERSION + '/proton')
    if require_payload:
        if not binary.is_file():
            raise ValueError('Dead Matter publisher executable is missing')
        proton.location(root)
    if acquiring:
        # Retain the shared explicit private-account gate. No login or
        # filesystem operation happens inside arguments().
        shared.steam.arguments(root, 2584780, env, validate=shared.boolean(env, 'VALIDATE'),
                               platform='windows', force_platform=True)


def main(shared=None):
    shared = shared or load_shared()
    root, env = Path.cwd(), dict(os.environ)
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Invalid original automatic-update control')
    preflight(shared, root, env, require_payload=automatic != '1', acquiring=automatic == '1')
    if automatic == '1':
        shared.install(root, 'dead-matter', env, validate=shared.boolean(env, 'VALIDATE'))
        preflight(shared, root, env)
    # Shared run still owns argv, log following, child environment, terminal,
    # signals and real exit code. Prevent a second updater after preflight.
    return shared.run(root, 'dead-matter', {**env, 'VOLTRA_STEAM_AUTO_UPDATE': '0'})


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError):
        print('Dead Matter startup refused. Review native controls, allocations, paths and legitimate installation prerequisites.', file=sys.stderr)
        sys.exit(1)
