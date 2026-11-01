#!/usr/bin/env python3
"""No One Survived only: refuse invalid prerequisites before depot mutation."""
import importlib.util
import os
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('noone_family', Path(__file__).with_name('wasteland-servers.py'))
family = importlib.util.module_from_spec(spec)
spec.loader.exec_module(family)


def preflight(root, env):
    root = Path(root).resolve()
    family.original_gate(root, 'noone', env)
    family.ports(env, 27015)
    family.choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ['0', '1'])
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Explicit Microsoft/font runtime license acceptance required before depot installation')
    if env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('Private Wine runtime requires win64; existing prefix preserved')
    prefix = Path(env.get('WINEPREFIX', str(root / '.wine')))
    if not prefix.is_absolute():
        raise ValueError('Wine prefix must be absolute')
    family.shared.confined(root, prefix)
    registry = family.shared.confined(root, prefix / 'system.reg')
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix preserved; requires win64')
    family.shared.confined(root, Path(env.get('WINEPATH', str(root))))
    verbs = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022 corefonts')).split()
    if not verbs or len(verbs) != len(set(verbs)) or any(v not in ('vcrun2022', 'corefonts') for v in verbs):
        raise ValueError('Unsupported Wine prerequisites')
    family.text(env, 'WINEDEBUG', '-all', 32)
    family.save_name(env, 'SERVER_SAVE_NAME', 'MySave')
    family.text(env, 'SERVER_NAME', 'Test', 32)
    family.text(env, 'SERVER_PASSWORD', '', 32)
    family.text(env, 'SERVER_ADMIN_PASSWORD', '', 32)
    family.choice(env, 'SERVER_NEED_PASSWORD', 'False', ['False', 'True'])
    family.choice(env, 'STEAM_NETWORKING', 'False', ['False', 'True'])
    family.choice(env, 'SERVER_REGION', 'All', ['All', 'AF', 'AS', 'EU', 'NA', 'OC', 'SA'])
    family.integer(env, 'SERVER_PLAYERS', 50, 1, 100)
    family.integer(env, 'SERVER_NUM_ZOMBIES', 50, 25, 100)
    # Validate original files without publishing or normalizing operator bytes.
    for name in ('Engine.ini', 'Game.ini'):
        target = family.path(root, 'WRSH/Saved/Config/WindowsServer/' + name)
        if target.exists():
            if not target.is_file() or target.stat().st_size > 8 * 1024**2:
                raise ValueError('Native INI is not a bounded regular file')
            target.read_bytes().decode('utf-8-sig')


def execute(action, root, env):
    if action not in ('run', 'install'):
        raise ValueError('Expected install/run')
    preflight(root, env)
    if action == 'install':
        family.install(root, 'noone', env)
        return 0
    return family.run(root, 'noone', env)


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected install/run')
        sys.exit(execute(sys.argv[1], Path.cwd(), dict(os.environ)))
    except (ValueError, OSError) as error:
        # Errors must never interpolate environment values or native file contents.
        print('No One Survived preflight/setup refused: ' + type(error).__name__, file=sys.stderr)
        sys.exit(2)
