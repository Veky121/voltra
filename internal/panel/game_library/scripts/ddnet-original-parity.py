#!/usr/bin/env python3
"""Original DDNet native-file authority; retain shared acquisition and console."""
import os
from pathlib import Path
import secrets
import sys
from ddnet_install import install
from ddnet_runtime import quote, run


def safe_path(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('DDNet native path escapes its server volume')
    return path


def plan(root, env):
    port = int(env['SERVER_PORT'])
    if not 1 <= port <= 65535:
        raise ValueError('Invalid allocated UDP port')
    cfg = safe_path(root, 'ddnet/autoexec_server.cfg')
    state = safe_path(root, '.voltra/ddnet')
    fifo = safe_path(root, '.voltra/ddnet/console.fifo')
    if cfg.exists():
        if not cfg.is_file():
            raise ValueError('Native configuration must be a regular file')
        return cfg, None, state, fifo, port
    base = safe_path(root, 'ddnet/data/autoexec_server.cfg')
    if base.exists() and not base.is_file():
        raise ValueError('Native base configuration must be a regular file')
    maximum = int(env.get('MAX_PLAYERS', '64'))
    if not 1 <= maximum <= 128:
        raise ValueError('Invalid player limit')
    public, sixup, testing = (env.get(k, d) for k, d in [('PUBLIC_SERVER', '0'), ('SIXUP', '1'), ('TEST_COMMANDS', '0')])
    if any(value not in ('0', '1') for value in (public, sixup, testing)):
        raise ValueError('Listing, protocol and test toggles must be 0 or 1')
    game_map = env.get('SERVER_MAP', 'Sunny Side Up')
    if game_map in ('.', '..') or any(c in game_map for c in '/\\'):
        raise ValueError('Map must be a basename without .map')
    password = env.get('RCON_PASSWORD', '')
    credential = safe_path(root, '.voltra/ddnet/rcon-password')
    if not password and credential.exists():
        if not credential.is_file() or credential.stat().st_size > 127:
            raise ValueError('Existing private RCON credential is not a bounded regular file')
        password = credential.read_text(encoding='utf-8')
    password = password or secrets.token_hex(24)
    lines = ['# Seeded once from setup. Edit this native file in Game settings.',
             '# Existing base/custom configuration remains untouched.',
             'exec data/autoexec_server.cfg',
             'sv_name ' + quote(env.get('SERVER_NAME', 'A Pterodactyl DDNet Server'), 127),
             'sv_map ' + quote(game_map, 127),
             'password ' + quote(env.get('SERVER_PASS', ''), 255),
             'sv_register ' + public, 'sv_max_clients ' + str(maximum),
             'sv_sixup ' + sixup, 'sv_test_cmds ' + testing,
             'sv_rcon_password ' + quote(password, 127)]
    return cfg, '\n'.join(lines) + '\n', state, fifo, port


def prepare(root, env, acquisition=False):
    cfg, contents, state, fifo, port = plan(root, env)
    if acquisition:
        install(root)
    binary = safe_path(root, 'ddnet/DDNet-Server')
    if not binary.is_file():
        raise ValueError('Install the verified DDNet server before starting')
    if contents is not None:
        cfg.parent.mkdir(parents=True, exist_ok=True)
        with open(cfg, 'x', encoding='utf-8', opener=lambda p, f: os.open(p, f, 0o600)) as out:
            out.write(contents)
    state.mkdir(parents=True, exist_ok=True)
    # DDNet implicitly executes autoexec_server.cfg before CLI parsing. Passing
    # -f here would execute operator commands twice; only allocation/FIFO stay CLI.
    return [str(binary), 'bindaddr 0.0.0.0', 'sv_port ' + str(port),
            'sv_input_fifo ' + quote(str(fifo), 127)]


if __name__ == '__main__':
    root = Path.cwd().resolve()
    automatic = os.environ.get('AUTO_UPDATE', '1')
    if automatic not in ('0', '1'):
        raise ValueError('Auto update must be 0 or 1')
    installation = sys.argv[1:] == ['install']
    argv = prepare(root, os.environ, installation or automatic == '1')
    if not installation:
        raise SystemExit(run(root, argv))
