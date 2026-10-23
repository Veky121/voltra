#!/usr/bin/env python3
"""MIT. Typed vanilla GoldSrc launcher; advanced files stay operator owned."""
import os
from pathlib import Path
import re
import tempfile
import time
import socket
import threading
from native_console import run
from steam_template import update


def text(value, maximum=128):
    if len(value.encode('utf-8')) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value) or any(c in value for c in '"\\;'):
        raise ValueError('GoldSrc settings cannot contain quotes, backslashes, semicolons or control characters')
    return '"' + value + '"'


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            output.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def selection(env):
    if env.get('SRCDS_APPID', '90') != '90':
        raise ValueError('Vanilla GoldSrc uses dedicated application 90')
    flavor = env.get('VOLTRA_GOLDSRC_RECIPE', 'generic')
    if flavor not in ('cs16', 'generic', 'rehlds'):
        raise ValueError('Unsupported GoldSrc recipe')
    game = env.get('HLDS_GAME', 'cstrike')
    if not re.fullmatch(r'[A-Za-z0-9_]{1,32}', game) or flavor == 'cs16' and game != 'cstrike':
        raise ValueError('Choose a native GoldSrc mod directory; CS 1.6 requires cstrike')
    return flavor, game


def configure(root, env):
    root = root.resolve()
    flavor, game = selection(env)
    game_map = env.get('SRV_STARTMAP' if flavor == 'cs16' else 'SRCDS_MAP', 'de_dust2')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', game_map):
        raise ValueError('Choose a native map name without traversal or console commands')
    main = int(env['SERVER_PORT'])
    allocated = {int(port) for port in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if port}
    if main not in allocated or any(not 1025 <= port <= 65535 for port in allocated):
        raise ValueError('GoldSrc ports must be allocated and above 1024')
    extra = sorted(allocated - {main})
    vac = int(env.get('VAC_PORT', '0'))
    if not vac:
        if not extra: raise ValueError('Allocate a distinct Steam service port')
        vac = extra[0]
    if vac not in extra:
        raise ValueError('VAC_PORT must be a distinct additional allocation')
    maximum = int(env.get('SRV_SLOTS', '32'))
    boost = int(env.get('SRV_PINGBOOST', '2' if flavor == 'cs16' else '0'))
    tickrate = int(env.get('SYS_TICRATE', '1200' if flavor == 'cs16' else '100'))
    secure = env.get('SRV_SECURE', 'secure')
    public = env.get('PUBLIC_SERVER', '0')
    if not 1 <= maximum <= 32 or boost not in (0, 1, 2, 3) or not 10 <= tickrate <= 2000:
        raise ValueError('Invalid native player, pingboost or ticrate setting')
    if secure not in ('secure', 'insecure') or public not in ('0', '1'):
        raise ValueError('Invalid VAC or Internet setting')
    values = {'hostname': text(env.get('HOSTNAME', 'GoldSrc dedicated server')),
              'sv_password': text(env.get('SERVER_PASSWORD', '')),
              'rcon_password': text(env.get('RCON_PASSWORD', '')),
              'sv_lan': '0' if public == '1' else '1', 'sys_ticrate': str(tickrate)}
    folder = root / game
    managed = folder / 'voltra_managed.cfg'
    wrapper = folder / 'voltra_server.cfg'
    startup = folder / 'voltra_bootstrap.cfg'
    state = root / '.voltra/goldsrc'
    executable = root / 'hlds_run'
    for path in (managed, wrapper, startup, state, executable, folder / 'maps' / (game_map + '.bsp')):
        if not path.resolve().is_relative_to(root):
            raise ValueError('GoldSrc path escapes the server volume')
    if not executable.is_file() or not (root / 'hlds_linux').is_file():
        raise ValueError('Steam installation is missing the native GoldSrc launcher')
    if not (folder / 'liblist.gam').is_file() or not (folder / 'maps' / (game_map + '.bsp')).is_file():
        raise ValueError('The selected mod or map is not installed; reinstall after changing HLDS_GAME')
    content = '// Managed by the setup form. Advanced settings remain in server.cfg.\n' + ''.join(key + ' ' + value + '\n' for key, value in values.items())
    previous = managed.read_text(encoding='utf-8') if managed.exists() else None
    if content != previous:
        if previous is not None: write(state / 'config-backups' / (str(time.time_ns()) + '.cfg'), previous)
        write(managed, content)
    else:
        managed.chmod(0o600)
    write(wrapper, 'exec server.cfg\nexec voltra_managed.cfg\n')
    # GoldSrc's startup command splitter treats '-' and '+' inside values as
    # command delimiters. Put operator strings and map names in a native config.
    write(startup, 'maxplayers ' + str(maximum) + '\nservercfgfile voltra_server.cfg\nsv_lan ' + values['sv_lan'] + '\nmap ' + text(game_map, 64) + '\nexec voltra_managed.cfg\n')
    argv = [str(executable), '-console', '-game', game, '-port', str(main), '-sport', str(vac),
            '-ip', '0.0.0.0', '-strictportbind', '-norestart', '-' + secure,
            '-pingboost', str(boost), '+exec', 'voltra_bootstrap.cfg']
    environment = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD'):
        environment.pop(key, None)
    environment['LD_LIBRARY_PATH'] = str(root) + ':' + str(root / game / 'dlls')
    return argv, environment


def info_identity(packet):
    if not packet.startswith(b'\xff\xff\xff\xff') or len(packet) < 7:
        raise ValueError('Not an unfragmented native info reply')
    if packet[4] == 0x49:
        offset, fields = 6, []  # A2S_INFO protocol byte
        count = 4
    elif packet[4] == 0x6d:
        offset, fields = 5, []  # Old GoldSrc reply starts with an address string
        count = 5
    else:
        raise ValueError('Not a native server info reply')
    for _ in range(count):
        end = packet.find(b'\0', offset)
        if end < 0: raise ValueError('Truncated native info reply')
        fields.append(packet[offset:end].decode('utf-8', errors='replace'))
        offset = end + 1
    return (fields[1], fields[2]) if count == 4 else (fields[2], fields[3])


def await_native_info(env, finished):
    flavor, game = selection(env)
    game_map = env.get('SRV_STARTMAP' if flavor == 'cs16' else 'SRCDS_MAP', 'de_dust2')
    request = b'\xff\xff\xff\xffTSource Engine Query\0'
    endpoint = ('127.0.0.1', int(env['SERVER_PORT']))
    deadline = time.monotonic() + 180
    while not finished.is_set() and time.monotonic() < deadline:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
                connection.settimeout(1)
                connection.connect(endpoint)
                connection.send(request)
                packet = connection.recv(32768)
                if packet.startswith(b'\xff\xff\xff\xffA') and len(packet) == 9:
                    connection.send(request + packet[5:9])
                    packet = connection.recv(32768)
                if info_identity(packet) == (game_map, game):
                    print('VOLTRA_GOLDSRC_READY', flush=True)
                    return
        except (OSError, ValueError):
            pass
        finished.wait(0.5)


if __name__ == '__main__':
    root = Path.cwd()
    _, game = selection(os.environ)
    automatic = os.environ.get('VOLTRA_STEAM_AUTO_UPDATE', os.environ.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'): raise ValueError('AUTO_UPDATE must be 0 or 1')
    if automatic == '1':
        from goldsrc_install import install
        validate = os.environ.get('VALIDATE', '0')
        if validate not in ('0', '1'): raise ValueError('VALIDATE must be 0 or 1')
        install(root, os.environ, validate=validate == '1')
    argv, environment = configure(root, os.environ)
    credentials = [os.environ.get(key, '') for key in ('SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    finished = threading.Event()
    threading.Thread(target=await_native_info, args=(os.environ, finished), daemon=True).start()
    try:
        result = run(root, argv, environment, 'quit', credentials, terminal_input=True)
    finally:
        finished.set()
    raise SystemExit(result)
