#!/usr/bin/env python3
"""MIT. Native OpenArena configuration, stdin console and private readiness."""
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import zipfile


def quoted(value, limit, info=False):
    if len(value.encode('utf-8')) > limit or any(c in value for c in '\x00\r\n"'):
        raise ValueError('Native OpenArena values cannot contain quotes, line breaks or NUL, and must fit the byte limit')
    if info and any(c in value for c in '\\;'):
        raise ValueError('Native server-info values cannot contain backslashes or semicolons')
    # This engine does not support backslash-escaped quotation marks.
    return '"' + value + '"'


def map_exists(game, mod, name):
    for folder in [game / 'userdata' / mod, game / mod, game / 'userdata/baseoa', game / 'baseoa']:
        if (folder / 'maps' / (name + '.bsp')).is_file():
            return True
        for package in folder.glob('*.pk3'):
            with zipfile.ZipFile(package) as archive:
                if 'maps/' + name + '.bsp' in archive.namelist():
                    return True
    return False


NATIVE_DEFAULTS = ('// OpenArena 0.8.8 extra native tuning. Original form controls load afterward.\n'
                   'set fraglimit "20"\nset timelimit "0"\nset capturelimit "8"\n'
                   'set g_friendlyFire "0"\nset g_allowVote "1"\nset g_doWarmup "0"\n'
                   'set g_warmup "20"\nset g_inactivity "0"\n')


def planned_paths(root, paths):
    root = root.resolve()
    for path in paths:
        relative = path.relative_to(root)
        current = root
        for index, part in enumerate(relative.parts):
            current = current / part
            if current.is_symlink():
                raise ValueError('OpenArena configuration paths must not use symlinks')
            if current.exists() and (not current.is_file() if index == len(relative.parts)-1 else not current.is_dir()):
                raise ValueError('OpenArena configuration path has an invalid file kind')


def seed_native(folder):
    target = folder / 'server.cfg'
    if not target.exists():
        with open(target, 'x', opener=lambda p, f: os.open(p, f | os.O_NOFOLLOW, 0o600)) as out:
            out.write(NATIVE_DEFAULTS)


def configure(env, root):
    port, maximum = int(env['SERVER_PORT']), int(env.get('MAX_PLAYERS', '16'))
    kind, minimum = int(env.get('GAME_TYPE', '0')), int(env.get('MIN_PLAYERS', '0'))
    public, mod = env.get('PUBLIC_SERVER', '0'), env.get('GAME_MOD', 'baseoa')
    if not 1 <= port <= 65535 or not 1 <= maximum <= 64 or kind not in (0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13) or not 0 <= minimum <= maximum:
        raise ValueError('Invalid allocated port, player count or game type')
    if public not in ('0', '1') or mod not in ('baseoa', 'missionpack'):
        raise ValueError('Invalid listing or game folder')
    game_map = env.get('GAME_MAP', 'aggressor')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', game_map):
        raise ValueError('Choose a map basename without .bsp')
    game = root / 'openarena'
    if not map_exists(game, mod, game_map):
        raise ValueError('The selected map is missing from the active game packages')
    lines = ['set sv_hostname ' + quoted(env.get('SERVER_NAME', 'OpenArena server'), 255, True),
             'set sv_maxclients ' + str(maximum), 'set g_gametype ' + str(kind),
             'set bot_minplayers ' + str(minimum),
             'set g_password ' + quoted(env.get('SERVER_PASSWORD', ''), 127, True)]
    password = env.get('RCON_PASSWORD', '')
    credential = root / '.voltra/openarena/rcon-password'
    if password:
        quoted(password, 127)
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if allocated and port not in allocated:
        raise ValueError('OpenArena needs an allocated primary port')
    folder = game / 'userdata' / mod
    planned_paths(root, [credential, folder / 'server.cfg', folder / 'voltra-managed.cfg'])
    if not password:
        credential.parent.mkdir(parents=True, exist_ok=True)
        if not credential.exists():
            with open(credential, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as out:
                out.write(secrets.token_hex(24))
        password = credential.read_text()
    lines.append('set rconPassword ' + quoted(password, 127))
    folder = game / 'userdata' / mod
    folder.mkdir(parents=True, exist_ok=True)
    seed_native(folder)
    config = folder / 'voltra-managed.cfg'
    content = '\n'.join(lines) + '\n'
    if not config.is_file() or config.read_text() != content:
        fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=folder)
        try:
            with os.fdopen(fd, 'w') as out:
                out.write(content)
            os.replace(temporary, config)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    argv = [str(game / 'oa_ded.x86_64'), '+set', 'fs_basepath', str(game),
            '+set', 'fs_homepath', str(game / 'userdata'), '+set', 'ttycon', '0',
            '+set', 'dedicated', '2' if public == '1' else '1',
            '+set', 'net_ip', '0.0.0.0', '+set', 'net_port', str(port)]
    if mod != 'baseoa':
        argv += ['+set', 'fs_game', mod]
    return argv + ['+exec', 'server.cfg', '+exec', 'voltra-managed.cfg', '+map', game_map]


def run(root, argv):
    from native_console import run as supervise
    environment = dict(os.environ)
    credentials = [environment.get('SERVER_PASSWORD', ''), environment.get('RCON_PASSWORD', '')]
    if not credentials[1]:
        credentials[1] = (root / '.voltra/openarena/rcon-password').read_text()
    finished = threading.Event()
    def readiness():
        token = secrets.token_hex(8).encode()
        port = int(environment['SERVER_PORT'])
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.settimeout(0.2)
            while not finished.is_set():
                probe.sendto(b'\xff\xff\xff\xffgetinfo ' + token + b'\n', ('127.0.0.1', port))
                try:
                    packet, address = probe.recvfrom(8192)
                    if address == ('127.0.0.1', port) and packet.startswith(b'\xff\xff\xff\xffinfoResponse\n') and b'\\challenge\\' + token in packet:
                        print('OpenArena native UDP server ready', flush=True)
                        return
                except socket.timeout:
                    pass
                finished.wait(0.1)
    worker = threading.Thread(target=readiness, daemon=True)
    worker.start()
    try:
        result = supervise(root / 'openarena', argv, environment, 'quit', credentials=credentials)
        return result if result >= 0 else 128 - result
    finally:
        finished.set()
        worker.join(timeout=1)


if __name__ == '__main__':
    root = Path.cwd()
    raise SystemExit(run(root, configure(os.environ, root)))
