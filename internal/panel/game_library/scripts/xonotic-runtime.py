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


def configure(env, root):
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
             'password ' + quoted(env.get('SERVER_PASSWORD', ''), 127),
             'rcon_password ' + quoted(password, 127), 'rcon_secure 2',
             'net_address 0.0.0.0', 'port ' + str(port), 'log_file latest.log']
    folder = root / '.xonotic/data'
    folder.mkdir(parents=True, exist_ok=True)
    # Preserve the native editable example and never replace operator server.cfg.
    original = root / 'xonotic/server/server.cfg'
    config = folder / 'server.cfg'
    if not config.exists() and original.is_file():
        with config.open('x', encoding='utf-8') as output:
            output.write(original.read_text(encoding='utf-8'))
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


def run(root, argv):
    child = subprocess.Popen(argv, cwd=root / 'xonotic', stdin=sys.stdin,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    def stop(*_):
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def output():
        for line in iter(child.stdout.readline, b''):
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
    reader = threading.Thread(target=output, daemon=True)
    reader.start()
    token, ready = secrets.token_hex(8).encode(), False
    port = int(os.environ['SERVER_PORT'])
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.settimeout(0.2)
            while child.poll() is None:
                if not ready:
                    probe.sendto(b'\xff\xff\xff\xffgetinfo ' + token + b'\n', ('127.0.0.1', port))
                    try:
                        packet, address = probe.recvfrom(8192)
                        if address == ('127.0.0.1', port) and packet.startswith(b'\xff\xff\xff\xffinfoResponse\n') and b'\\challenge\\' + token in packet:
                            ready = True
                            print('Xonotic native UDP server ready', flush=True)
                    except socket.timeout:
                        pass
                time.sleep(0.1)
        return child.returncode
    finally:
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
            child.wait(timeout=15)
        reader.join(timeout=5)


if __name__ == '__main__':
    root = Path.cwd()
    raise SystemExit(run(root, configure(os.environ, root)))
