#!/usr/bin/env python3
"""CS2D-only refusal-before-write preflight, retaining native CFG and console."""
import importlib.util
import os
from pathlib import Path
import re
import sys


def load_shared():
    file = Path(__file__).with_name('small-native-runtime.py')
    if not file.exists():
        file = Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/small-native-runtime.py'
    spec = importlib.util.spec_from_file_location('cs2d_shared_native', file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def safe_file(root, name, maximum=None):
    current = root
    parts = Path(name).parts
    for index, part in enumerate(parts):
        if part in ('.', '..') or Path(part).is_absolute():
            raise ValueError('Unsafe CS2D native path')
        current = current / part
        if current.is_symlink():
            raise ValueError('CS2D managed paths cannot use symlinks')
        if current.exists() and index < len(parts) - 1 and not current.is_dir():
            raise ValueError('CS2D managed parent must be a directory')
    if not current.resolve().is_relative_to(root):
        raise ValueError('CS2D managed path leaves server volume')
    if current.exists() and (not current.is_file() or maximum is not None and current.stat().st_size > maximum):
        raise ValueError('CS2D managed target must be a bounded regular file')
    return current


def preflight(root, environment, shared):
    root = Path(root).resolve()
    keys = ('SERVER_PORT', 'SERVER_PLAYERS', 'SERVER_NAME', 'SERVER_PASSWORD', 'SERVER_MAP', 'PUBLIC_SERVER', 'RCON_PASSWORD', 'GAME_MODE', 'BOT_COUNT')
    if any(key in environment and not isinstance(environment[key], str) for key in keys):
        raise ValueError('CS2D launch controls must be strings')
    if environment.get('AUTO_UPDATE', '0') != '0':
        raise ValueError('CS2D uses its reviewed native publisher installer')
    port = shared.integer(environment, 'SERVER_PORT', 36963, 1, 65535)
    raw = environment.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[1-9][0-9]{0,4}(?:,[1-9][0-9]{0,4})*', raw):
        raise ValueError('Choose canonical allocated CS2D ports')
    ports = [int(value) for value in raw.split(',')]
    if port not in ports or len(ports) != len(set(ports)) or any(value > 65535 for value in ports):
        raise ValueError('CS2D port must use a selected allocation')
    maximum = shared.integer(environment, 'SERVER_PLAYERS', 12, 1, 32)
    game_map = environment.get('SERVER_MAP', 'de_dust2')
    if not re.fullmatch(r'[A-Za-z0-9 _-]{1,100}', game_map):
        raise ValueError('Invalid CS2D map basename')
    selected_map = safe_file(root, 'cs2d/maps/' + game_map + '.map')
    binary = safe_file(root, 'cs2d/cs2d_dedicated')
    if not selected_map.is_file() or not binary.is_file():
        raise ValueError('Install CS2D and an actual selected map before starting')
    public = environment.get('PUBLIC_SERVER', '0')
    if public not in ('0', '1'):
        raise ValueError('Invalid CS2D public flag')
    credential = safe_file(root, '.voltra/cs2d/rcon-password', 8192)
    rcon = environment.get('RCON_PASSWORD', '')
    if not rcon and credential.exists():
        rcon = credential.read_text(encoding='utf-8')
        if not rcon:
            raise ValueError('Persisted CS2D RCON credential is empty; review it before restart')
    # Validate with a harmless placeholder when the shared writer will generate
    # the first persistent credential. Preflight never generates or publishes it.
    values = {
        'sv_hostport': str(port), 'sv_name': shared.cs_quoted(environment.get('SERVER_NAME', 'CS2D Server'), 64),
        'sv_password': shared.cs_quoted(environment.get('SERVER_PASSWORD', ''), 32),
        'sv_maxplayers': str(maximum), 'sv_map': shared.cs_quoted(game_map, 100),
        'sv_lan': '0' if public == '1' else '1', 'sv_rcon': shared.cs_quoted(rcon or 'preflight-placeholder', 64),
        'sv_gamemode': str(shared.integer(environment, 'GAME_MODE', 0, 0, 5)),
        'bot_count': str(shared.integer(environment, 'BOT_COUNT', 0, 0, 32)),
    }
    config = safe_file(root, 'cs2d/sys/server.cfg', 8 * 1024 * 1024)
    previous = config.read_text(encoding='utf-8') if config.exists() else ''
    for line in previous.splitlines():
        command = line.strip().split(' ', 1)[0].split('\t', 1)[0]
        if command.lower() in values and command != command.lower():
            raise ValueError('Ambiguous CS2D managed command casing')
    shared.patch_commands(previous, values)
    safe_file(root, '.voltra/cs2d/previous-server.cfg', 8 * 1024 * 1024)
    for name in ('console-command', 'console-command.tmp'):
        safe_file(root, '.voltra/cs2d/' + name, 65536)
    adapter = safe_file(root, 'cs2d/sys/lua/autorun/voltra-console.lua', 1024 * 1024)
    expected = Path(shared.__file__).with_name('cs2d-console.lua').read_bytes()
    if adapter.exists() and adapter.read_bytes() != expected:
        raise ValueError('CS2D reserved console adapter was modified; review it before restart')
    return root


def main(root=None, environment=None, shared=None):
    shared = shared or load_shared()
    root = Path.cwd() if root is None else Path(root)
    environment = dict(os.environ if environment is None else environment)
    root = preflight(root, environment, shared)
    argv, cwd = shared.configure_cs2d(root, environment)
    credentials = [environment.get(key, '') for key in ('SERVER_PASSWORD', 'RCON_PASSWORD')]
    credential = root / '.voltra/cs2d/rcon-password'
    if credential.is_file():
        credentials.append(credential.read_text(encoding='utf-8'))
    original = dict(os.environ)
    try:
        os.environ.pop('PYTHONHOME', None)
        os.environ.pop('PYTHONPATH', None)
        return shared.run_native(argv, cwd, credentials, root / '.voltra/cs2d/console-command')
    finally:
        os.environ.clear()
        os.environ.update(original)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, TypeError):
        print('CS2D setup refused. Review selected allocations, native files and controls.', file=sys.stderr)
        raise SystemExit(1)
