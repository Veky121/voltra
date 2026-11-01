#!/usr/bin/env python3
"""MIT. Factory-game Foundry adapter; App.cfg owns native settings after seed."""
import importlib.util
import os
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('foundry_automation', Path(__file__).with_name('automation-sims.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def validate_launch(env):
    base.options('foundry', env)
    if base.text(env, 'WINETRICKS_RUN', 'mono', 255) != 'mono':
        raise ValueError('Foundry requires WINETRICKS_RUN=mono')
    if base.text(env, 'XVFB', '1') != '1':
        raise ValueError('Foundry requires XVFB=1')
    base.text(env, 'WINEDEBUG', '-all', 255)
    base.shared.roles(env, ['QUERY_PORT'])


def configure(root, env, *, preflight=False):
    root = Path(root).resolve()
    validate_launch(env)
    path = base.shared.confined(root, root / 'App.cfg')
    if not path.exists():
        raise ValueError('Install Foundry before starting')
    with path.open(encoding='utf-8-sig', newline='') as source:
        content = source.read()
    values = {}
    for line in content.splitlines():
        match = re.match(r'^\s*([^#;=\s]+)\s*=(.*)$', line)
        if match:
            key, value = match.groups()
            if key in values:
                raise ValueError('Duplicate Foundry setting requires operator review')
            values[key] = value.strip()
    base.world({'WORLD': values.get('server_world_name', '')}, 'WORLD', '')
    save = values.get('server_persistent_data_override_folder', '')
    prefix = 'Z:' + str(root).replace('/', '\\') + '\\'
    if not save.startswith(prefix):
        raise ValueError('Foundry native save folder must remain in this volume')
    relative = save[len(prefix):].replace('\\', '/')
    if not relative or any(p in ('', '.', '..') for p in relative.split('/')):
        raise ValueError('Unsafe Foundry native save folder')
    base.shared.confined(root, root / relative)
    ports = base.shared.roles(env, ['QUERY_PORT'])
    updated = base.shared.patch_properties(content, {'server_port': ports['primary'], 'server_query_port': ports['QUERY_PORT']})
    if not preflight:
        base.shared.write_config(root, path, updated)
    return ['xvfb-run', '-a', 'wine', str(root / 'FoundryDedicatedServer.exe'), '-log'], [values.get('server_password', '')]


def install(root, env):
    root = Path(root).resolve()
    validate_launch(env)
    existed = base.shared.confined(root, root / 'App.cfg').exists()
    if existed:
        configure(root, env, preflight=True)
    base.install(root, 'foundry', env)
    if not existed:
        base.configure(root, 'foundry', env)


def run(root, env):
    root = Path(root).resolve()
    auto = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))
    if auto not in ('0', '1'):
        raise ValueError('Invalid AUTO_UPDATE')
    if auto == '1':
        install(root, env)
    argv, credentials = configure(root, env)
    base.shared.confined(root, root / '.wine')
    environment = dict(env)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'):
        environment.pop(key, None)
    environment.update(HOME=str(root), WINEPREFIX=str(root / '.wine'), WINEDEBUG=base.text(env, 'WINEDEBUG', '-all', 255))
    code = base.helper('native-console').run(root, argv, environment, '\x03', credentials,
        ready_marker=b'Dedicated server is now running!', terminal_input=True)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    try:
        action = sys.argv[1:]
        if action == ['install']: install(Path.cwd(), dict(os.environ))
        elif action == ['run']: sys.exit(run(Path.cwd(), dict(os.environ)))
        else: raise ValueError('Expected install or run')
    except (ValueError, OSError, KeyError):
        print('Foundry failed: check App.cfg, allocated ports, confined save path and public Steam options.', file=sys.stderr)
        sys.exit(1)
