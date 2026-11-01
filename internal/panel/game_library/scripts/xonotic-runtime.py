#!/usr/bin/env python3
"""MIT. DarkPlaces configuration, native stdin console and UDP readiness."""
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


def quoted(value, limit=255):
    if len(value.encode('utf-8')) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Xonotic values must fit the UTF-8 byte limit and contain no control characters')
    # DarkPlaces Cmd_QuoteString / Cmd_PreprocessString, pinned 0.8.6 source.
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('$', '$$') + '"'


def map_exists(root, name):
    for folder in [root / '.xonotic/data', root / 'xonotic/data']:
        if (folder / 'maps' / (name + '.bsp')).is_file():
            return True
        for package in folder.glob('*.pk3'):
            with zipfile.ZipFile(package) as source:
                if 'maps/' + name + '.bsp' in source.namelist():
                    return True
    return False


def planned_paths(root, paths, maximum=8 * 1024 * 1024):
    root = Path(root)
    if root.is_symlink() or root.resolve() != root:
        raise ValueError('Xonotic volume must be canonical')
    for target in paths:
        relative = target.relative_to(root)
        current = root
        for index, part in enumerate(relative.parts):
            current = current / part
            if current.is_symlink():
                raise ValueError('Xonotic configuration paths must not be symlinks')
            if current.exists() and index < len(relative.parts) - 1 and not current.is_dir():
                raise ValueError('Xonotic configuration parent must be a directory')
        if target.exists():
            if not target.is_file() or maximum is not None and target.stat().st_size > maximum:
                raise ValueError('Invalid or oversized Xonotic native file')


def preflight(env, root):
    credential = root / '.voltra/xonotic/rcon-password'
    files = [credential, root / '.xonotic/data/server.cfg', root / '.xonotic/data/voltra-managed.cfg', root / 'xonotic/server/server.cfg']
    planned_paths(root, files)
    for file in files:
        if file.is_file():
            file.read_bytes().decode('utf-8')
    selected_map = env.get('GAME_MAP', 'stormkeep')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', selected_map):
        raise ValueError('Invalid native map basename')
    for folder in [root / '.xonotic/data', root / 'xonotic/data']:
        planned_paths(root, [folder / 'maps' / (selected_map + '.bsp')], maximum=None)
        if folder.is_symlink() or folder.exists() and (not folder.is_dir() or not folder.resolve().is_relative_to(root)):
            raise ValueError('Xonotic data must stay inside the volume')
        for package in folder.glob('*.pk3'):
            if package.is_symlink() or not package.is_file():
                raise ValueError('Xonotic packages must be regular files')
    # Complete predictable validation before credential or configuration writes.
    name = env.get('SERVER_NAME', 'Xonotic server')
    quoted(name)
    if '\\' in name:
        raise ValueError('Native server-info names cannot contain backslashes')
    if env.get('SERVER_PASSWORD', ''):
        raise ValueError('This Xonotic adapter cannot enforce a join password; leave SERVER_PASSWORD empty. Public listing off is not join access control.')
    password = env.get('RCON_PASSWORD', '')
    if not password and credential.is_file():
        password = credential.read_text()
    if password:
        quoted(password, 127)
        if ' ' in password:
            raise ValueError('Use a single native RCON password')
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if allocated and int(env['SERVER_PORT']) not in allocated:
        raise ValueError('Xonotic primary port must be allocated')


NATIVE_DEFAULTS = (('sv_taunt', '1'), ('sv_autotaunt', '1'), ('sv_autopause', '1'),
                   ('g_footsteps', '1'), ('g_friendlyfire', '0.5'),
                   ('g_warmup_limit', '180'), ('g_maplist_shuffle', '1'), ('sv_maxidle', '0'))


def native_seed():
    return '\n// Additional native gameplay tuning; existing files remain authoritative.\n' + ''.join(key + ' "' + value + '"\n' for key, value in NATIVE_DEFAULTS)


def configure(env, root):
    root = Path(root)
    preflight(env, root)
    port, maximum = int(env['SERVER_PORT']), int(env.get('MAX_PLAYERS', '16'))
    minimum, skill = int(env.get('MIN_PLAYERS', '0')), int(env.get('BOT_SKILL', '5'))
    per_team, empty_bots = int(env.get('MIN_PLAYERS_PER_TEAM', '0')), env.get('BOT_JOIN_EMPTY', '0')
    public, game_map, kind = env.get('PUBLIC_SERVER', '0'), env.get('GAME_MAP', 'stormkeep'), env.get('GAME_TYPE', 'dm')
    if not 1 <= port <= 65535 or not 1 <= maximum <= 99 or not 0 <= minimum <= maximum or not 0 <= per_team <= maximum or not 0 <= skill <= 10:
        raise ValueError('Invalid allocated port, player count or bot skill')
    if public not in ('0', '1') or empty_bots not in ('0', '1') or kind not in ('dm', 'tdm', 'ctf', 'ca', 'ft', 'kh', 'as', 'dom', 'lms', 'ka', 'inv', 'ons', 'rc', 'cts', 'nb'):
        raise ValueError('Invalid public listing or game type')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}', game_map) or not map_exists(root, game_map):
        raise ValueError('Choose an installed Xonotic map basename without .bsp')
    name = env.get('SERVER_NAME', 'Xonotic server')
    if '\\' in name:
        raise ValueError('The native Xonotic server-info protocol cannot encode backslashes in the server name')
    password = env.get('RCON_PASSWORD', '')
    credential = root / '.voltra/xonotic/rcon-password'
    if not password:
        credential.parent.mkdir(parents=True, exist_ok=True)
        if not credential.exists():
            with open(credential, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as output:
                output.write(secrets.token_hex(24))
        credential.chmod(0o600)
        password = credential.read_text()
    if ' ' in password:
        raise ValueError('Choose a single native RCON password without spaces')
    lines = ['hostname ' + quoted(name),
             'maxplayers ' + str(maximum), 'minplayers ' + str(minimum), 'skill ' + str(skill),
             'minplayers_per_team ' + str(per_team), 'bot_join_empty ' + empty_bots,
             'sv_public ' + public, 'gametype ' + kind,
             'rcon_password ' + quoted(password, 127), 'rcon_secure 2',
             'net_address 0.0.0.0', 'port ' + str(port), 'log_file latest.log']
    folder = root / '.xonotic/data'
    folder.mkdir(parents=True, exist_ok=True)
    # Preserve the native editable example and never replace operator server.cfg.
    original = root / 'xonotic/server/server.cfg'
    config = folder / 'server.cfg'
    if not config.exists() and original.is_file():
        with config.open('x', encoding='utf-8') as output:
            output.write(original.read_text(encoding='utf-8') + native_seed())
    if not config.exists():
        with config.open('x', encoding='utf-8') as output:
            output.write(native_seed())
    managed, content = folder / 'voltra-managed.cfg', '\n'.join(lines) + '\n'
    if not managed.is_file() or managed.read_text(encoding='utf-8') != content:
        fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=folder)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as output:
                output.write(content)
            os.replace(temporary, managed)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    managed.chmod(0o600)
    return [str(root / 'xonotic/xonotic-linux64-dedicated'), '-basedir', str(root / 'xonotic'),
            '-userdir', str(root / '.xonotic'), '+net_address', '0.0.0.0',
            '+port', str(port), '+sv_public', public, '+maxplayers', str(maximum),
            # Native startmap_dm loads _init/_init, executes server.cfg, and sets
            # _sv_init=1. Only then can QC gametype and bot logic initialize.
            '+startmap_dm', '+exec', 'voltra-managed.cfg', '+map', game_map]


def ready_response(packet, address, port, token, selected_map):
    prefix = b'\xff\xff\xff\xffinfoResponse\n'
    if address != ('127.0.0.1', port) or not packet.startswith(prefix):
        return False
    fields = packet[len(prefix):].split(b'\n', 1)[0].split(b'\\')
    if not fields or fields[0] != b'' or len(fields) % 2 != 1:
        return False
    values = {}
    for index in range(1, len(fields) - 1, 2):
        if fields[index] in values:
            return False
        values[fields[index]] = fields[index + 1]
    return values.get(b'challenge') == token and values.get(b'gamename') == b'Xonotic' and values.get(b'mapname') == selected_map.encode('ascii')


def run(root, argv):
    from native_console import run as supervise
    environment = dict(os.environ)
    credentials = [environment.get('SERVER_PASSWORD', ''), environment.get('RCON_PASSWORD', '')]
    if not credentials[1]:
        credentials[1] = (root / '.voltra/xonotic/rcon-password').read_text()
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
                    if ready_response(packet, address, port, token, environment.get('GAME_MAP', 'stormkeep')):
                        print('Xonotic native UDP server ready', flush=True)
                        return
                except socket.timeout:
                    pass
                finished.wait(0.1)
    worker = threading.Thread(target=readiness, daemon=True)
    worker.start()
    try:
        return supervise(root / 'xonotic', argv, environment, 'quit', credentials=credentials)
    finally:
        finished.set()
        worker.join(timeout=1)


if __name__ == '__main__':
    root = Path.cwd()
    raise SystemExit(run(root, configure(os.environ, root)))
