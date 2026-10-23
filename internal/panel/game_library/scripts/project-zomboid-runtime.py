#!/usr/bin/env python3
"""MIT. Native Zomboid setup without overwriting publisher launchers or worlds."""
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from steam_template import Redactor, update


def single_line(value, limit):
    if len(value.encode('utf-8')) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Zomboid settings must fit the UTF-8 byte limit and contain no control characters')
    return value


def patch_ini(content, values):
    newline = '\r\n' if '\r\n' in content else '\n'
    result, seen = [], set()
    for line in content.splitlines(keepends=True):
        if not line.lstrip().startswith(('#', ';')) and '=' in line:
            key = line.split('=', 1)[0].strip()
            if key in values:
                if key in seen:
                    raise ValueError('Duplicate managed Zomboid setting: ' + key)
                seen.add(key)
                result.append(line.split('=', 1)[0] + '=' + values[key] + newline)
                continue
        result.append(line)
    if result and not result[-1].endswith(('\r', '\n')):
        result[-1] += newline
    for key, value in values.items():
        if key not in seen:
            result.append(key + '=' + value + newline)
    return ''.join(result)


def atomic_private(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            output.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def administrator_exists(path, username):
    if not path.exists():
        return False
    # Native account state is authoritative. Never delete or rewrite it to make
    # administrator bootstrap appear successful.
    try:
        with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as database:
            return database.execute('SELECT 1 FROM whitelist WHERE username=? LIMIT 1', (username,)).fetchone() is not None
    except sqlite3.Error:
        raise ValueError('Existing Zomboid authentication database needs native recovery; it was not changed') from None


def available_memory(env):
    limits = []
    value = env.get('SERVER_MEMORY', '')
    if value.isascii() and value.isdigit() and int(value) > 0:
        limits.append(int(value))
    for name in ('/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'):
        try:
            value = Path(name).read_text().strip()
            if value.isdigit() and 0 < int(value) < 2**60:
                limits.append(int(value) // 1024**2)
        except OSError:
            pass
    return min(limits) if limits else 6144


def configure(root, env):
    root = root.resolve()
    prefix = env.get('SERVER_NAME', 'Pterodactyl')
    if not re.fullmatch(r'[A-Za-z0-9]{1,64}', prefix):
        raise ValueError('SERVER_NAME is the original alphanumeric save/configuration prefix')
    port = int(env['SERVER_PORT'])
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    secondary = int(env.get('STEAM_PORT', '0'))
    if secondary == 0:
        candidates = sorted(allocated - {port})
        if not candidates:
            raise ValueError('Allocate a second UDP port to this Zomboid server')
        secondary = candidates[0]
    if port == secondary or not all(1 <= value <= 65535 and value in allocated for value in (port, secondary)):
        raise ValueError('The game and UDP ports must be distinct actual server allocations')
    maximum = int(env.get('MAX_PLAYERS', '16'))
    if not 1 <= maximum <= 100:
        raise ValueError('Choose a player limit from 1 to 100')
    values = {'DefaultPort': str(port), 'UDPPort': str(secondary), 'MaxPlayers': str(maximum),
              'PublicName': single_line(env.get('PUBLIC_NAME', 'Project Zomboid server'), 255),
              'Password': single_line(env.get('SERVER_PASSWORD', ''), 128)}
    for key, variable, default in [('Public', 'PUBLIC_SERVER', '0'), ('PVP', 'PVP', '1'), ('PauseEmpty', 'PAUSE_EMPTY', '1'), ('UPnP', 'UPNP', '0')]:
        value = env.get(variable, default)
        if value not in ('0', '1'):
            raise ValueError(variable + ' must be 0 or 1')
        values[key] = 'true' if value == '1' else 'false'
    user = single_line(env.get('ADMIN_USER', 'admin'), 80)
    if not user.strip():
        raise ValueError('Choose an administrator username')
    requested_heap = int(env.get('JAVA_HEAP_MB', '0'))
    memory = available_memory(env)
    heap = requested_heap or (memory * 3 // 4 // 64 * 64)
    if not 512 <= heap <= 524288 or heap > memory - 512:
        raise ValueError('Leave at least 512 MiB outside the Java heap within the server memory limit')
    metadata = json.loads((root / 'ProjectZomboid64.json').read_text(encoding='utf-8'))
    classpath = metadata.get('classpath', metadata.get('classPath'))
    vmargs, main = metadata.get('vmArgs'), metadata.get('mainClass', '')
    if not isinstance(classpath, list) or not classpath or not isinstance(vmargs, list) or not isinstance(main, str) or not re.fullmatch(r'zombie[./]network[./]GameServer', main):
        raise ValueError('Publisher launcher metadata has an unsupported structure')
    if any(not isinstance(value, str) or not value or any(c in value for c in '\r\n\x00') for value in [*classpath, *vmargs]):
        raise ValueError('Publisher launcher metadata contains invalid arguments')
    vmargs = [value for value in vmargs if not value.startswith(('-Xms', '-Xmx'))]
    vmargs += ['-Xms256m', '-Xmx' + str(heap) + 'm']
    java = root / 'jre64/bin/java'
    if not java.is_file():
        raise ValueError('Steam installation is missing the bundled Java runtime')
    cache, state = root / '.cache', root / '.voltra/project-zomboid'
    ini, database = cache / 'Server' / (prefix + '.ini'), cache / 'db' / (prefix + '.db')
    if any(not path.resolve().is_relative_to(root) for path in (ini, database, state)):
        raise ValueError('Zomboid configuration or database escapes the server volume')
    argv = [str(java), *vmargs, '-cp', ':'.join(classpath), main.replace('/', '.'),
            '-port', str(port), '-udpport', str(secondary), '-cachedir=' + str(cache),
            '-servername', prefix, '-adminusername', user]
    if not administrator_exists(database, user):
        password = single_line(env.get('ADMIN_PASSWORD', ''), 128)
        if not password:
            credential = state / 'admin-password'
            if not credential.resolve().is_relative_to(root):
                raise ValueError('Administrator credential escapes the server volume')
            if not credential.exists():
                atomic_private(credential, secrets.token_hex(24))
            credential.chmod(0o600)
            password = credential.read_text()
        argv += ['-adminpassword', password]
    if ini.exists():
        with ini.open(encoding='utf-8', newline='') as stream:
            original = stream.read()
    else:
        original = ''
    content = patch_ini(original, values)
    if original != content:
        if ini.exists():
            backup = state / 'config-backups' / (str(time.time_ns()) + '-' + prefix + '.ini')
            atomic_private(backup, original)
        atomic_private(ini, content)
    else:
        ini.chmod(0o600)
    child_env = dict(os.environ)
    child_env.pop('PYTHONHOME', None); child_env.pop('PYTHONPATH', None)
    child_env['LD_LIBRARY_PATH'] = ':'.join(str(root / name) for name in ('linux64', 'natives', '.', 'jre64/lib', 'jre64/lib/amd64'))
    for name in ('jre64/lib/libjsig.so', 'jre64/lib/amd64/libjsig.so'):
        if (root / name).is_file():
            child_env['LD_PRELOAD'] = str(root / name)
            break
    else:
        child_env.pop('LD_PRELOAD', None)
    return argv, child_env


def run(root, env):
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('AUTO_UPDATE must be 0 or 1')
    if automatic == '1':
        update(root, 380870, env, validate=False, required=('ProjectZomboid64.json', 'jre64/bin/java'))
    argv, child_env = configure(root, env)
    child = subprocess.Popen(argv, cwd=root, env=child_env, stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    def forward():
        try:
            # A daemon thread blocked in BufferedReader.readline holds stdin's
            # lock during interpreter finalization and can abort after a clean
            # game exit. Raw descriptor reads do not hold that Python lock.
            for block in iter(lambda: os.read(sys.stdin.fileno(), 65536), b''):
                child.stdin.write(block); child.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
    def stop(*_):
        if child.poll() is None:
            try:
                child.stdin.write(b'quit\n'); child.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
    threading.Thread(target=forward, daemon=True).start()
    values = [env.get(key, '') for key in ('ADMIN_PASSWORD', 'SERVER_PASSWORD', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    if '-adminpassword' in argv:
        values.append(argv[argv.index('-adminpassword') + 1])
    redactor = Redactor(values)
    for line in iter(child.stdout.readline, b''):
        # Credentials are single-line values, so complete log lines can flush
        # immediately without delaying the native readiness marker.
        sys.stdout.buffer.write(redactor.feed(line, final=line.endswith(b'\n'))); sys.stdout.buffer.flush()
    sys.stdout.buffer.write(redactor.feed(b'', final=True)); sys.stdout.buffer.flush()
    return child.wait()


if __name__ == '__main__':
    raise SystemExit(run(Path.cwd(), os.environ))
