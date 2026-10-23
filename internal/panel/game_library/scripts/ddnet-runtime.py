#!/usr/bin/env python3
"""MIT. Bridge dashboard input to DDNet's supported private native FIFO."""
import errno
import os
from pathlib import Path
import queue
import secrets
import signal
import stat
import subprocess
import sys
import threading
import time
from ddnet_install import install


def quote(value, limit):
    if len(value.encode('utf-8')) > limit or any(c in value for c in '\x00\r\n'):
        raise ValueError('Native setting exceeds its UTF-8 byte limit or contains a control character')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def arguments(env, root):
    port, maximum = int(env['SERVER_PORT']), int(env.get('MAX_PLAYERS', '64'))
    if not 1 <= port <= 65535 or not 1 <= maximum <= 128:
        raise ValueError('Invalid allocated port or player limit')
    public, sixup, testing = env.get('PUBLIC_SERVER', '0'), env.get('SIXUP', '1'), env.get('TEST_COMMANDS', '0')
    if any(value not in ('0', '1') for value in (public, sixup, testing)):
        raise ValueError('Listing, 0.7 support and test commands must be 0 or 1')
    game_map = env.get('SERVER_MAP', 'Sunny Side Up')
    if game_map in ('.', '..') or any(c in game_map for c in '/\\\x00\r\n'):
        raise ValueError('Choose a map basename without .map')
    if not any((root / 'ddnet' / p / (game_map + '.map')).is_file() for p in ('maps', 'data/maps')):
        raise ValueError('Selected map is missing from ddnet/maps or ddnet/data/maps')
    commands = ['bindaddr 0.0.0.0', 'sv_port ' + str(port), 'sv_max_clients ' + str(maximum),
                'sv_name ' + quote(env.get('SERVER_NAME', 'DDNet server'), 127),
                'sv_map ' + quote(game_map, 127), 'sv_register ' + public,
                'password ' + quote(env.get('SERVER_PASS', ''), 255), 'sv_sixup ' + sixup,
                'sv_test_cmds ' + testing]
    password = env.get('RCON_PASSWORD', '')
    credential = root / '.voltra/ddnet/rcon-password'
    if not password:
        credential.parent.mkdir(parents=True, exist_ok=True)
        if not credential.exists():
            with open(credential, 'x', opener=lambda p, f: os.open(p, f, 0o600)) as out:
                out.write(secrets.token_hex(24))
        password = credential.read_text()
    return [str(root / 'ddnet/DDNet-Server'), *commands,
            'sv_rcon_password ' + quote(password, 127),
            'sv_input_fifo ' + quote(str(root / '.voltra/ddnet/console.fifo'), 127)]


def run(root, argv):
    fifo = root / '.voltra/ddnet/console.fifo'
    child = subprocess.Popen(argv, cwd=root / 'ddnet', stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    commands = queue.Queue(maxsize=128)
    stopping = threading.Event()
    native_ready = threading.Event()
    def stop(*_):
        stopping.set()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    def input_lines():
        for line in sys.stdin:
            if '\x00' in line or len(line.encode('utf-8')) > 4096:
                continue
            commands.put(line.rstrip('\r\n') + '\n')
    def output_lines():
        for line in iter(child.stdout.readline, b''):
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
            if (b'server: version ' in line or b'[server]: version ' in line):
                native_ready.set()
    threading.Thread(target=input_lines, daemon=True).start()
    output = threading.Thread(target=output_lines, daemon=True)
    output.start()
    writer, shutdown_sent, reported, pending = None, False, False, None
    try:
        while child.poll() is None:
            if writer is None:
                try:
                    if fifo.exists() and stat.S_ISFIFO(fifo.lstat().st_mode):
                        writer = os.open(fifo, os.O_WRONLY | os.O_NONBLOCK)
                except OSError as error:
                    if error.errno not in (errno.ENXIO, errno.ENOENT):
                        raise
            if writer is not None:
                if native_ready.is_set() and not reported:
                    print('Voltra DDNet console ready', flush=True)
                    reported = True
                if stopping.is_set() and not shutdown_sent:
                    pending = 'shutdown\n'
                    shutdown_sent = True
                elif pending is None:
                    try:
                        pending = commands.get_nowait()
                    except queue.Empty:
                        pass
                if pending:
                    try:
                        os.write(writer, pending.encode('utf-8'))
                        pending = None
                    except BlockingIOError:
                        pass
            time.sleep(0.02)
        return child.returncode
    finally:
        if child.poll() is None:
            child.send_signal(signal.SIGINT)
            child.wait(timeout=15)
        output.join(timeout=5)
        if writer is not None:
            os.close(writer)


if __name__ == '__main__':
    root = Path.cwd()
    automatic = os.environ.get('AUTO_UPDATE', '1')
    if automatic not in ('0', '1'):
        raise SystemExit('Auto update must be 0 or 1')
    if automatic == '1':
        install(root)
    raise SystemExit(run(root, arguments(os.environ, root)))
