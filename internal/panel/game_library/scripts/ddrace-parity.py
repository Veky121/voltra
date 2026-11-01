#!/usr/bin/env python3
"""DDRaceNetwork seed-once configuration. Shared engine helpers stay unchanged."""
import os
from pathlib import Path
import secrets
import sys
from ddrace_legacy import install, migrate_legacy_data
from ddnet_runtime import quote
from ddrace_console import run


def safe_path(root, relative):
    path = root / relative
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('DDRace path escapes the server volume')
    return path


def configuration(root, env):
    # Existing configuration is authoritative, including exec, votes and secrets.
    for name in ('ddnet/autoexec_server.cfg', 'ddnet/data/autoexec_server.cfg'):
        path = safe_path(root, name)
        if path.exists():
            if not path.is_file():
                raise ValueError('Native configuration must be a regular file')
            return path
    name = env.get('SERVER_NAME', 'My DDNet server')
    game_map = env.get('SERVER_MAP', 'Tutorial')
    if game_map in ('.', '..') or any(c in game_map for c in '/\\'):
        raise ValueError('Map must be a basename without .map')
    registration = env.get('SERVER_REGISTER', '0')
    if registration not in ('0', 'ipv4'):
        raise ValueError('Registration must be 0 or ipv4')
    maximum = int(env.get('MAX_PLAYERS', '64'))
    if not 1 <= maximum <= 128:
        raise ValueError('Invalid player limit')
    sixup, testing = env.get('SIXUP', '1'), env.get('TEST_COMMANDS', '0')
    if sixup not in ('0', '1') or testing not in ('0', '1'):
        raise ValueError('Protocol and test toggles must be 0 or 1')
    password = env.get('RCON_PASSWORD') or secrets.token_hex(24)
    lines = ['# Seeded once. Edit this native file in Game settings.',
             'sv_name ' + quote(name, 127), 'sv_map ' + quote(game_map, 127),
             'password ' + quote(env.get('SERVER_PASSWORD', ''), 255),
             'sv_register ' + registration, 'sv_max_clients ' + str(maximum),
             'sv_sixup ' + sixup, 'sv_test_cmds ' + testing,
             'sv_rcon_password ' + quote(password, 127)]
    path = safe_path(root, 'ddnet/autoexec_server.cfg')
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'x', encoding='utf-8', opener=lambda p, f: os.open(p, f, 0o600)) as out:
        out.write('\n'.join(lines) + '\n')
    return path


def arguments(root, env):
    port = int(env['SERVER_PORT'])
    if not 1 <= port <= 65535:
        raise ValueError('Invalid allocated UDP port')
    cfg = configuration(root, env)
    state = safe_path(root, '.voltra/ddnet')
    state.mkdir(parents=True, exist_ok=True)
    fifo = safe_path(root, '.voltra/ddnet/console.fifo')
    return [str(safe_path(root, 'ddnet/DDNet-Server')), '-f',
            cfg.relative_to(root / 'ddnet').as_posix(),
            'bindaddr 0.0.0.0', 'sv_port ' + str(port),
            'sv_input_fifo ' + quote(str(fifo), 127)]


def prepare(root, env):
    migrate_legacy_data(root)
    configuration(root, env)
    install(root, env)


if __name__ == '__main__':
    root = Path.cwd().resolve()
    if sys.argv[1:] == ['install']:
        prepare(root, os.environ)
    else:
        update = os.environ.get('AUTO_UPDATE', '0')
        if update not in ('0', '1'):
            raise ValueError('Auto update must be 0 or 1')
        if update == '1':
            prepare(root, os.environ)
        raise SystemExit(run(root, arguments(root, os.environ)))
