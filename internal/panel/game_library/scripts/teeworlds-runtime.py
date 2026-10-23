#!/usr/bin/env python3
"""MIT. Serialize native console values and retain operator configuration."""
import os
from pathlib import Path
import re
import secrets


def quote(value, limit):
    if len(value.encode('utf-8')) > limit or any(c in value for c in '\x00\r\n'):
        raise ValueError('Native text field exceeds its UTF-8 limit or contains a control character')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def arguments(env, root):
    port, players = int(env['SERVER_PORT']), int(env.get('MAX_PLAYERS', '16'))
    if not 1 <= port <= 65535 or not 1 <= players <= 64:
        raise ValueError('Invalid game port or player limit')
    register = env.get('PUBLIC_SERVER', '0')
    if register not in ('0', '1'):
        raise ValueError('Public server must be 0 or 1')
    game_map = env.get('SERVER_MAP', 'dm1')
    if not re.fullmatch(r'[A-Za-z0-9 _-]{1,100}', game_map):
        raise ValueError('Choose a map basename without an extension')
    if not any((root / p / (game_map + '.map')).is_file() for p in ('maps', 'data/maps')):
        raise ValueError('Selected map does not exist in maps or data/maps')
    kind = env.get('GAME_TYPE', 'dm')
    if kind not in ('dm', 'tdm', 'ctf', 'lms', 'lts'):
        raise ValueError('Unsupported native game type')
    commands = ['bindaddr 0.0.0.0', 'sv_port ' + str(port),
                'sv_name ' + quote(env.get('SERVER_NAME', 'Teeworlds server'), 127),
                'sv_motd ' + quote(env.get('SERVER_MOTD', ''), 899),
                'sv_map ' + quote(game_map, 127), 'sv_gametype ' + quote(kind, 15),
                'sv_max_clients ' + str(players), 'sv_register ' + register,
                'password ' + quote(env.get('SERVER_PASSWORD', ''), 31)]
    # An empty native RCON password otherwise generates and prints a random one.
    # Persist a generated credential privately; never print it in our launcher.
    credential = root / '.voltra/teeworlds-rcon-password'
    password = env.get('RCON_PASSWORD', '')
    if not password:
        credential.parent.mkdir(parents=True, exist_ok=True)
        if not credential.exists():
            with open(credential, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as out:
                out.write(secrets.token_hex(15))
        password = credential.read_text()
    commands.append('sv_rcon_password ' + quote(password, 31))
    # The native engine loads autoexec.cfg itself before processing arguments.
    # Passing -f again would execute operator commands twice.
    return [str(root / 'teeworlds_srv'), *commands]


if __name__ == '__main__':
    root = Path.cwd()
    argv = arguments(os.environ, root)
    os.execv(argv[0], argv)
