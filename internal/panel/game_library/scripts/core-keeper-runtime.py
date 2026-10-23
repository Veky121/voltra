#!/usr/bin/env python3
"""MIT. Core Keeper persistent data and native Unity process lifecycle."""
import os
from pathlib import Path
import re
import secrets
import select
import signal
import subprocess
import sys
import threading
import string
import tempfile
from steam_template import Redactor, update


def text(value, maximum=256):
    if len(value.encode()) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Core Keeper settings cannot contain controls or exceed their size limit')
    return value


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix='.voltra-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:stream.write(value+'\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def configure(root, env):
    root = root.resolve()
    data, state = root/'CoreKeeperSaves', root/'.voltra/core-keeper'
    if any(not path.resolve().is_relative_to(root) for path in (data,state)):raise ValueError('Core Keeper data path escapes this volume')
    binary = root/'CoreKeeperServer'
    if not binary.is_file():raise ValueError('Steam installation is missing CoreKeeperServer')
    world = int(env.get('WORLD_INDEX', '0'))
    seed = int(env.get('WORLD_SEED', '0'))
    maximum = int(env.get('MAX_PLAYERS', '100'))
    port = int(env['SERVER_PORT'])
    if not 0 <= world <= 29 or not 0 <= seed <= 4294967295 or not 1 <= maximum <= 100 or not 1 <= port <= 65535:
        raise ValueError('Invalid Core Keeper world, seed, player limit or port')
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if value}
    if port > 65534 or not {port,port+1}.issubset(allocated):
        raise ValueError('Allocate two consecutive Core Keeper ports for gameplay and native Steam query')
    mode = env.get('WORLD_MODE', '0')
    modes = {'0':'Normal', '1':'Hard', 'Normal':'Normal', 'Hard':'Hard', 'Creative':'Creative', 'Casual':'Casual'}
    if mode not in modes:raise ValueError('Choose a supported Core Keeper world mode')
    game_id = env.get('GAME_ID', '')
    game_file, password_file = state/'game-id', state/'direct-password'
    if any(not path.resolve().is_relative_to(root) for path in (game_file,password_file)):
        raise ValueError('Core Keeper credential path escapes this volume')
    alphabet = ''.join(c for c in string.ascii_letters+string.digits if c not in 'Yyx0O')
    if not game_id:game_id = game_file.read_text().strip() if game_file.exists() else ''.join(secrets.choice(alphabet) for _ in range(28))
    if game_id and not re.fullmatch(r'[A-Za-z1-9]{15,28}', game_id) or any(c in game_id for c in 'YyxO'):
        raise ValueError('Invalid Core Keeper game ID')
    password = text(env.get('SERVER_PASSWORD', ''), 28)
    if not password:password = password_file.read_text().strip() if password_file.exists() else ''.join(secrets.choice(alphabet) for _ in range(28))
    text(password, 28)
    season = env.get('SEASON', '')
    if season and season not in ('None','Easter','Halloween','Christmas','Valentine','Anniversary','CherryBlossom','LunarNewYear'):
        raise ValueError('Choose a supported native season')
    platform = env.get('ALLOW_ONLY_PLATFORM', '')
    if platform and platform not in ('Steam','Epic','Microsoft','GOG'):raise ValueError('Choose a supported client platform')
    argv = [str(binary), '-batchmode', '-logfile', '-', '-world', str(world),
            '-worldname', text(env.get('WORLD_NAME', 'Core Keeper Server'), 400), '-worldmode', modes[mode],
            '-maxplayers', str(maximum), '-port', str(port), '-ip', '0.0.0.0', '-datapath', str(data)]
    if seed:argv += ['-worldseed', str(seed)]
    hashed = env.get('HASHED_WORLD_SEED', '')
    if hashed:
        if seed or not 0 <= int(hashed) <= 4294967295:raise ValueError('Choose either the original seed or an unsigned hashed seed')
        argv += ['-hashedworldseed', str(int(hashed))]
    if season:argv += ['-season', season]
    if platform:argv += ['-allowonlyplatform', platform]
    if game_id:argv += ['-gameid', game_id]
    if password:argv += ['-password', password]
    environment = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD'):environment.pop(key, None)
    environment.update({'LD_LIBRARY_PATH':str(root/'linux64')+':'+str(root/'CoreKeeperServer_Data/Plugins/x86_64')+':'+str(root/'.steam/sdk64'), 'HOME':str(root)})
    width,height,depth = (int(env.get(key,default)) for key,default in [('DISPLAY_WIDTH','1'),('DISPLAY_HEIGHT','1'),('DISPLAY_DEPTH','24')])
    if not 1 <= width <= 4096 or not 1 <= height <= 4096 or depth not in (16,24,32):raise ValueError('Invalid Core Keeper virtual display')
    environment['VOLTRA_DISPLAY_GEOMETRY'] = str(width)+'x'+str(height)+'x'+str(depth)
    data.mkdir(exist_ok=True)
    private_write(game_file, game_id);private_write(password_file, password)
    return argv, environment, [password, game_id]


def run(root, argv, environment, credentials):
    read_fd, write_fd = os.pipe()
    display = subprocess.Popen(['/usr/bin/Xvfb', '-displayfd', str(write_fd), '-screen', '0', environment.pop('VOLTRA_DISPLAY_GEOMETRY'), '-nolisten', 'tcp'], pass_fds=(write_fd,), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    os.close(write_fd)
    try:
        if not select.select([read_fd], [], [], 15)[0]:raise ValueError('Core Keeper virtual display did not become ready')
        number = os.read(read_fd, 64).decode().strip()
        if not number.isdigit() or display.poll() is not None:raise ValueError('Core Keeper virtual display failed')
        environment['DISPLAY'] = ':'+number
        child = subprocess.Popen(argv, cwd=root, env=environment, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    except BaseException:
        display.terminate();display.wait(timeout=5);raise
    finally:os.close(read_fd)
    stopping = threading.Event()
    ready = False
    def stop(*_):
        if child.poll() is None and not stopping.is_set():
            stopping.set();child.send_signal(signal.SIGTERM)
    signal.signal(signal.SIGTERM, stop);signal.signal(signal.SIGINT, stop)
    # The publisher's _launch.sh uses SIGTERM. Keep Xvfb alive until the native
    # game finishes rather than allowing Wings' process-group signal to kill it.
    redactor = Redactor(credentials)
    try:
        for line in iter(child.stdout.readline, b''):
            if b'Started session' in line:ready = True
            sys.stdout.buffer.write(redactor.feed(line, final=line.endswith(b'\n')));sys.stdout.buffer.flush()
        sys.stdout.buffer.write(redactor.feed(b'', final=True));sys.stdout.buffer.flush()
        result = child.wait()
        return result if ready else (result or 1)
    finally:
        if display.poll() is None:display.terminate()
        display.wait(timeout=5);child.stdout.close()


def main():
    root = Path.cwd().resolve();environment = dict(os.environ)
    if environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0')) == '1':
        update(root, 1963720, required=('CoreKeeperServer',))
    argv, child_env, credentials = configure(root, environment)
    return run(root, argv, child_env, [*credentials, *[environment.get(key, '') for key in ('STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]])


if __name__ == '__main__':raise SystemExit(main())
