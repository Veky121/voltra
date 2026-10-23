#!/usr/bin/env python3
"""MIT. Typed Arma configuration, original mod roles and native process ownership."""
import copy
import hashlib
from html.parser import HTMLParser
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        path = path.with_name(name.replace('_', '-') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


native = helper('native-config')
steam = helper('steam_template')
PRIVATE = ('Arma 3 private Steam and Workshop transport is not enabled. A real Steam account '
           'is required for app233780; Workshop app107410 also requires game ownership. '
           'Install/update legitimately outside this adapter, upload the files, select '
           'INSTALL_MODE=existing, UPDATE_SERVER=0 and DISABLE_MOD_UPDATES=1. '
           'Do not enter a password into shell flags. No credentials have been sent.')


def confined(root, relative):
    root = Path(root).resolve()
    path = root / relative
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('Arma path leaves the server volume')
    for parent in path.parents:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError('Arma path uses symbolic links')
    return path


def text(env, key, default='', limit=4096):
    value = env.get(key, default)
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Invalid ' + key)
    return value


def integer(env, key, default, low=1, high=65535):
    value = str(env.get(key, default))
    if not re.fullmatch('[0-9]+', value) or not low <= int(value) <= high:
        raise ValueError('Invalid ' + key)
    return int(value)


def boolean(env, key, default=False):
    value = str(env.get(key, '1' if default else '0')).lower()
    if value not in ('0', '1', 'true', 'false'):
        raise ValueError('Invalid ' + key)
    return value in ('1', 'true')


def allocated(env, offsets=(), roles=()):
    primary = integer(env, 'SERVER_PORT', 2302)
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Missing allocated ports')
    available = {int(p) for p in raw.split(',')}
    if any(not 1 <= p <= 65535 for p in available) or primary not in available:
        raise ValueError('Invalid allocated ports')
    used = {primary}
    for offset in offsets:
        port = primary + offset
        if port not in available or port in used:
            raise ValueError('Missing distinct Arma offset allocation')
        used.add(port)
    for key in roles:
        port = integer(env, key, 0, 0)
        if port:
            if port not in available or port in used:
                raise ValueError('Arma listener needs a distinct additional allocation')
            used.add(port)
    return primary


def object_at(value, key):
    child = value.setdefault(key, {})
    if not isinstance(child, dict):
        raise ValueError('Expected native JSON object: ' + key)
    return child


def reforger_config(previous, env):
    result = copy.deepcopy(previous)
    if not isinstance(result, dict):
        raise ValueError('Reforger config must be an object')
    port = allocated(env, roles=('A2S_PORT', 'RCON_PORT'))
    address = text(env, 'PUBLIC_ADDRESS', '', 64)
    if address and address != 'local':
        if ipaddress.ip_address(address).version != 4:
            raise ValueError('Reforger requires IPv4 or local')
    result.update(bindAddress='0.0.0.0', bindPort=port, publicAddress=address, publicPort=port)
    game = object_at(result, 'game')
    game.update(name=text(env, 'SERVER_NAME', 'Arma Reforger Server', 255),
                password=text(env, 'SERVER_PASS', '', 32),
                passwordAdmin=text(env, 'ADMIN_PASS', '', 32),
                scenarioId=text(env, 'SCENARIO_ID', '{ECC61978EDCC2B5A}Missions/23_Campaign.conf'),
                maxPlayers=integer(env, 'MAX_PLAYERS', 32, 1, 256),
                visible=boolean(env, 'VISIBLE', True))
    if ' ' in game['passwordAdmin']:
        raise ValueError('Publisher admin passwords cannot contain spaces')
    game.setdefault('admins', [])
    game.setdefault('mods', [])
    properties = object_at(game, 'gameProperties')
    for key, default in {'serverMaxViewDistance': 2500, 'serverMinGrassDistance': 50,
                         'networkViewDistance': 1000, 'VONDisableUI': False,
                         'VONDisableDirectSpeechUI': False}.items():
        properties.setdefault(key, default)
    properties.update(disableThirdPerson=boolean(env, 'DISABLE_THIRD'), fastValidation=True,
                      battlEye=boolean(env, 'BATTLEYE', True))
    for role, name in [('A2S_PORT', 'a2s'), ('RCON_PORT', 'rcon')]:
        number = integer(env, role, 0, 0)
        if not number:
            # Explicitly disable native listeners, retaining operator policy/password settings.
            if name in result:
                object_at(result, name)['port'] = 0
            continue
        listener = object_at(result, name)
        listener.update(address='0.0.0.0', port=number)
        if name == 'rcon':
            password = text(env, 'RCON_PASSWORD', '', 128)
            if len(password) < 8 or ' ' in password:
                raise ValueError('RCON needs an operator password of at least eight non-space characters')
            listener['password'] = password
            listener.setdefault('permission', 'monitor')
    return result


def cfg_string(value):
    return '"' + value.replace('"', '""') + '"'


def patch_cfg(content, values):
    """Replace only top-level assignments. Mask comments/strings, preserving byte offsets."""
    masked = list(content)
    i = 0
    while i < len(content):
        if content.startswith('//', i):
            end = content.find('\n', i)
            end = len(content) if end < 0 else end
        elif content.startswith('/*', i):
            end = content.find('*/', i + 2)
            if end < 0:
                raise ValueError('Unterminated CFG comment')
            end += 2
        elif content[i] == '"':
            end = i + 1
            while end < len(content):
                if content[end] == '"':
                    if end + 1 < len(content) and content[end + 1] == '"':
                        end += 2
                        continue
                    break
                end += 1
            if end == len(content):
                raise ValueError('Unterminated CFG string')
            end += 1
        else:
            i += 1
            continue
        for j in range(i, end):
            if masked[j] not in '\r\n':
                masked[j] = ' '
        i = end
    mask = ''.join(masked)
    depth, seen, edits = 0, set(), []
    tokens = re.finditer(r'[{}]|\b([A-Za-z_][A-Za-z0-9_]*(?:\[\])?)\s*=', mask)
    for token in tokens:
        if token[0] == '{':
            depth += 1
        elif token[0] == '}':
            depth -= 1
            if depth < 0:
                raise ValueError('Unbalanced native CFG braces')
        elif depth == 0 and token[1] in values:
            key = token[1]
            if key in seen:
                raise ValueError('Duplicate managed CFG setting: ' + key)
            seen.add(key)
            end = mask.find(';', token.end())
            if end < 0:
                raise ValueError('Missing managed CFG semicolon')
            edits.append((token.start(), end + 1, key + ' = ' + values[key] + ';'))
    if depth:
        raise ValueError('Unbalanced native CFG braces')
    for start, end, value in reversed(edits):
        content = content[:start] + value + content[end:]
    return content + ('\n' if not content.endswith('\n') else '') + ''.join(
        key + ' = ' + value + ';\n' for key, value in values.items() if key not in seen)


class Launcher(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attrs):
        if tag != 'a':
            return
        url = urllib.parse.urlsplit(dict(attrs).get('href', ''))
        if url.hostname not in ('steamcommunity.com', 'www.steamcommunity.com'):
            return
        for value in urllib.parse.parse_qs(url.query).get('id', []):
            if re.fullmatch('[0-9]+', value):
                self.ids.append('@' + value)


def mod_list(raw):
    result = []
    for entry in raw.split(';'):
        entry = entry.strip().rstrip('/')
        if not entry:
            continue
        if entry.startswith('/') or '\\' in entry or ':' in entry or any(
                p in ('', '.', '..') for p in entry.split('/')) or any(ord(c) < 32 for c in entry):
            raise ValueError('Mods must use volume-relative native directory names')
        if entry not in result:
            result.append(entry)
    return result


def mods(root, env):
    client = mod_list(text(env, 'MODIFICATIONS'))
    filename = text(env, 'MOD_FILE', 'modlist.html', 255)
    if filename:
        file = confined(root, filename)
        if file.exists():
            if file.stat().st_size > 2 * 1024 * 1024:
                raise ValueError('Launcher HTML exceeds 2MiB')
            content = file.read_text(encoding='utf-8-sig')
            if 'Created by Arma 3 Launcher' in content:
                parser = Launcher()
                parser.feed(content)
                client = list(dict.fromkeys(client + parser.ids))
            else:
                print('Launcher HTML is not an Arma 3 export; retaining manual mod lists.')
    server = mod_list(text(env, 'SERVERMODS'))
    optional = mod_list(text(env, 'OPTIONALMODS'))
    for name in dict.fromkeys(client + server + optional):
        if not confined(root, name).is_dir():
            raise ValueError('Missing uploaded Arma mod: ' + name)
    return client, server, optional


def lowercase_tree(path):
    # Preflight the entire tree before renaming anything; never follow linked content.
    directories = []
    for directory, children, files in os.walk(path, followlinks=False):
        directory = Path(directory)
        names = children + files
        if len({name.lower() for name in names}) != len(names):
            raise ValueError('Mod lowercase repair would overwrite a case collision')
        if any((directory / name).is_symlink() for name in names):
            raise ValueError('Mod lowercase repair refuses symbolic links')
        directories.append((directory, names))
    for directory, names in reversed(directories):
        for name in names:
            if name != name.lower():
                (directory / name).rename(directory / name.lower())


def publish_keys(root, lists):
    keys = confined(root, 'keys')
    keys.mkdir(exist_ok=True)
    ledger_path = confined(root, '.voltra/arma-keys.json')
    previous = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    planned = {}
    for index, group in enumerate(lists):
        for name in group:
            directory = confined(root, name)
            for source in directory.rglob('*'):
                if source.suffix.lower() != '.bikey':
                    continue
                source = confined(root, source.relative_to(root))
                destination = ('optional_' + Path(name).name.lstrip('@') + '_' if index == 2 else '') + source.name
                data = source.read_bytes()
                digest = hashlib.sha256(data).hexdigest()
                if destination in planned and planned[destination][1] != digest:
                    raise ValueError('Conflicting Arma signature keys')
                target = confined(root, 'keys/' + destination)
                if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() not in (digest, previous.get(destination)):
                    raise ValueError('Arma signature key conflicts with operator file')
                planned[destination] = (data, digest)
    for name, digest in previous.items():
        path = confined(root, 'keys/' + name)
        if name not in planned and path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest:
            path.unlink()
    owned = {}
    for name, (data, digest) in planned.items():
        target = confined(root, 'keys/' + name)
        if not target.exists() or hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            target.write_bytes(data)
            owned[name] = digest
        elif name in previous:
            owned[name] = digest
    native.private_write(ledger_path, json.dumps(owned))


def arma_arguments(root, env):
    allocated(env, offsets=(1, 2, 3, 4))
    binary = text(env, 'SERVER_BINARY', 'arma3server_x64', 40)
    if binary not in ('arma3server', 'arma3server_x64', 'arma3serverprofiling', 'arma3serverprofiling_x64'):
        raise ValueError('Invalid Arma binary')
    extra = shlex.split(text(env, 'STARTUP_PARAMS', '-noLogs'))
    # Preserve literal native argv; one runtime owns listeners, profile and mod roles.
    for arg in extra:
        if arg.lower().split('=')[0] in ('-port', '-ip', '-profiles', '-cfg', '-config', '-mod', '-servermod', '-client', '-connect', '-password'):
            raise ValueError('Configure managed Arma roles through their dedicated controls')
    client, server, optional = mods(root, env)
    executable = str(confined(root, binary))
    base = ['-port=' + str(integer(env, 'SERVER_PORT', 2302)), '-profiles=./serverprofile']
    main = [executable, '-ip=0.0.0.0', *base, '-bepath=./', '-cfg=basic.cfg', '-config=server.cfg',
            '-mod=' + ';'.join(client), '-serverMod=' + ';'.join(server), *extra]
    hc = [executable, '-client', '-connect=127.0.0.1', *base, '-password=' + text(env, 'SERVER_PASSWORD'),
          '-bepath=./battleye', '-mod=' + ';'.join(client), *extra]
    return main, hc, (client, server, optional)


def branch(env):
    integer(env, 'STEAMCMD_ATTEMPTS', 3, 1, 100)
    flags = shlex.split(text(env, 'STEAMCMD_EXTRA_FLAGS'))
    if not flags:
        return 'creatordlc' if boolean(env, 'CDLC') else ''
    if len(flags) not in (2, 4) or flags[0] != '-beta' or not re.fullmatch('[A-Za-z0-9_.-]+', flags[1]):
        raise ValueError('Steam extra flags support only -beta branch and optional -betapassword value')
    if len(flags) == 4 and flags[2] != '-betapassword':
        raise ValueError('Invalid Steam branch password flag')
    return flags[1]


def private_gate(env):
    branch(env)
    if env.get('INSTALL_MODE', 'steam') != 'existing' or boolean(env, 'UPDATE_SERVER', True) or not boolean(env, 'DISABLE_MOD_UPDATES'):
        raise ValueError(PRIVATE)


def fetch(pin):
    with urllib.request.urlopen(pin['url'], timeout=60) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != pin['sha256']:
        raise ValueError('Pinned Arma dependency checksum mismatch')
    return data


def seed_arma(root, env):
    pins = json.loads(Path(__file__).with_name('arma-releases.json').read_text())
    basic_url = text(env, 'BASIC_URL', pins['basic.cfg']['url'], 2048)
    # The imported mutable URL is an alias for its reviewed exact catalog revision.
    original = 'https://raw.githubusercontent.com/ptero-eggs/game-eggs/main/arma/arma3/egg-arma3-config/basic.cfg'
    custom = basic_url not in ('', original, pins['basic.cfg']['url'])
    for name in ('basic.cfg', 'server.cfg'):
        path = confined(root, name)
        if path.exists():
            continue
        pin = pins[name]
        if custom:
            checksum = text(env, 'BASIC_SHA256' if name == 'basic.cfg' else 'SERVER_CFG_SHA256')
            if not re.fullmatch('[a-fA-F0-9]{64}', checksum) or not basic_url.startswith('https://'):
                raise ValueError('Custom BASIC_URL needs HTTPS plus BASIC_SHA256 and SERVER_CFG_SHA256')
            pin = {'url': basic_url if name == 'basic.cfg' else basic_url.rsplit('/', 1)[0] + '/server.cfg', 'sha256': checksum.lower()}
        native.private_write(path, fetch(pin).decode('utf-8'))


def dependency_files(root):
    pins = json.loads(Path(__file__).with_name('arma-releases.json').read_text())
    for arch, name in [('amd64', 'tbb64'), ('i386', 'tbb32')]:
        with tempfile.TemporaryDirectory(prefix='voltra-arma-deb-') as temporary:
            package = Path(temporary) / 'tbb.deb'
            package.write_bytes(fetch(pins[name]))
            unpacked = Path(temporary) / 'unpacked'
            subprocess.run(['dpkg-deb', '-x', str(package), str(unpacked)], check=True)
            destination = confined(root, '.voltra/arma/' + ('lib64' if arch == 'amd64' else 'lib32'))
            destination.mkdir(parents=True, exist_ok=True)
            binaries = []
            for prefix in [unpacked / 'usr/lib', Path('/usr/lib')]:
                for source in prefix.glob(('x86_64-linux-gnu' if arch == 'amd64' else 'i386-linux-gnu') + '/lib*'):
                    if not (source.name.startswith('libtbb') if prefix == unpacked / 'usr/lib' else source.name.startswith(('libnss_wrapper', 'libSDL2'))):
                        continue
                    shutil.copy2(source.resolve(), destination / source.name)
                    binaries.append(source.resolve())
            glibc = ('libc.so.', 'libm.so.', 'libdl.so.', 'libpthread.so.', 'librt.so.', 'libresolv.so.', 'libutil.so.')
            for binary in binaries:
                probe = subprocess.run(['ldd', str(binary)], capture_output=True, text=True, check=True)
                if 'not found' in probe.stdout:
                    raise ValueError('Arma Debian compatibility dependency is missing')
                for name in re.findall(r'=>\s+(/[^\s]+)', probe.stdout):
                    source = Path(name)
                    if not source.name.startswith(glibc):
                        shutil.copy2(source, destination / source.name)
            legal = confined(root, '.voltra/arma/licenses/' + name)
            legal.mkdir(parents=True, exist_ok=True)
            shutil.copy2(unpacked / 'usr/share/doc/libtbb2/copyright', legal / 'copyright')
    copyright_file = Path('/usr/share/doc/libnss-wrapper/copyright')
    if copyright_file.exists():
        shutil.copy2(copyright_file, confined(root, '.voltra/arma/licenses/nss-wrapper-copyright'))
    for source in Path('/usr/share/doc').glob('*/copyright'):
        shutil.copy2(source, confined(root, '.voltra/arma/licenses/' + source.parent.name.replace(':', '_') + '.copyright'))
    directory = confined(root, '.voltra/arma')
    files = {str(path.relative_to(directory)): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in directory.glob('lib*/*') if path.is_file()}
    packages = subprocess.check_output(['dpkg-query', '-W', '-f=${binary:Package}\t${Version}\n'], text=True)
    native.private_write(directory / 'packages.txt', packages)
    native.private_write(directory / 'runtime.json', json.dumps({'files': files, 'pins': pins}, indent=2))


def update_reforger(root, env, installing=False):
    app = integer(env, 'SRCDS_APPID', 1874900, 1, 2147483647)
    if app not in (1874900, 1890870):
        raise ValueError('This adapter supports only official Reforger stable/experimental tools')
    # Steam may ship a new sample at config.json; restore exact operator bytes and metadata.
    config = confined(root, 'config.json')
    with tempfile.TemporaryDirectory(prefix='voltra-arma-config-') as temporary:
        backup = Path(temporary) / 'config.json'
        if config.exists():
            shutil.copy2(config, backup)
        try:
            steam.update(root, app, {}, validate=installing or str(env.get('VALIDATE', '')).lower() in ('1', 'true'), required=('ArmaReforgerServer',))
        finally:
            if backup.exists():
                shutil.copy2(backup, confined(root, 'config.json'))


def install(root, game, env):
    if game == 'arma3':
        private_gate(env)
        binary = text(env, 'SERVER_BINARY', 'arma3server_x64', 40)
        if binary not in ('arma3server', 'arma3server_x64', 'arma3serverprofiling', 'arma3serverprofiling_x64') or not confined(root, binary).is_file():
            raise ValueError('Upload the selected legitimate Arma server binary before existing-mode installation')
        seed_arma(root, env)
        dependency_files(root)
    else:
        update_reforger(root, env, installing=True)
    for name in ('profile', 'tmp') if game == 'reforger' else ('serverprofile',):
        confined(root, name).mkdir(parents=True, exist_ok=True)


def configure(root, game, env):
    if game == 'reforger':
        path = confined(root, 'config.json')
        previous = json.loads(path.read_text(encoding='utf-8-sig')) if path.exists() else {}
        native.private_write(path, json.dumps(reforger_config(previous, env), indent=2) + '\n')
        args = [str(confined(root, 'ArmaReforgerServer')), '-gproj', './addons/data/ArmaReforger.gproj',
                '-config', './config.json', '-profile', './profile', '-backendlog', '-nothrow',
                '-listScenarios', '-logStats', str(integer(env, 'LOG_INTERVAL', 0, 0, 2147483) * 1000),
                '-addonTempDir', './tmp']
        if env.get('MAX_FPS', '120'):
            args += ['-maxFPS', str(integer(env, 'MAX_FPS', 120, 1, 100000))]
        return args, []
    private_gate(env)
    if integer(env, 'STEAMCMD_APPID', 233780, 1, 2147483647) != 233780:
        raise ValueError('This adapter owns only Arma3 app233780')
    main, hc, lists = arma_arguments(root, env)
    if boolean(env, 'MODS_LOWERCASE'):
        for name in dict.fromkeys(sum((list(group) for group in lists), [])):
            lowercase_tree(confined(root, name))
    publish_keys(root, lists)
    path = confined(root, 'server.cfg')
    native.private_write(path, patch_cfg(path.read_text(), {
        'password': cfg_string(text(env, 'SERVER_PASSWORD')),
        'maxPlayers': str(integer(env, 'MAX_PLAYERS', 32, 1, 2147483647)),
        'headlessClients[]': '{"127.0.0.1"}', 'localClient[]': '{"127.0.0.1"}'}))
    if boolean(env, 'CLEAR_CACHE'):
        home = confined(root, 'serverprofile/home')
        if home.is_dir():
            for child in home.iterdir():
                if child.name != 'Player':
                    target = confined(root, child.relative_to(root))
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
    return main, [hc] * integer(env, 'HC_NUM', 0, 0, 5)


def child_environment(root, game, env):
    result = {key: value for key, value in env.items() if key not in
              ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'STEAM_PASS', 'STEAM_USER', 'STEAMCMD_EXTRA_FLAGS', 'SERVER_PASSWORD', 'SERVER_PASS', 'ADMIN_PASS', 'RCON_PASSWORD')}
    result['HOME'] = str(root)
    if game == 'arma3':
        architecture = 'lib64' if env.get('SERVER_BINARY', 'arma3server_x64').endswith('_x64') else 'lib32'
        library = confined(root, '.voltra/arma/' + architecture)
        wrapper = library / 'libnss_wrapper.so'
        if not wrapper.is_file():
            raise ValueError('Arma compatibility runtime missing; reinstall dependencies')
        state = confined(root, '.voltra/arma')
        native.private_write(state / 'passwd', 'container:x:' + str(os.getuid()) + ':' + str(os.getgid()) + ':Arma:' + str(root) + ':/bin/sh\n')
        native.private_write(state / 'group', 'container:x:' + str(os.getgid()) + ':\n')
        result.update(LD_LIBRARY_PATH=str(library), LD_PRELOAD=str(wrapper), NSS_WRAPPER_PASSWD=str(state / 'passwd'), NSS_WRAPPER_GROUP=str(state / 'group'))
    return result


def supervise(root, main, clients, env, hidden=False):
    processes = []
    readers = []
    lock = threading.RLock()
    stopping = threading.Event()
    secrets = [value for key, value in os.environ.items() if any(word in key for word in ('PASS', 'AUTH', 'TOKEN')) and value]

    def send(sig):
        with lock:
            for process in processes:
                if process.poll() is None:
                    try:
                        os.killpg(process.pid, sig)
                    except ProcessLookupError:
                        pass

    def stop(signum, frame):
        if not stopping.is_set():
            stopping.set()
            send(signal.SIGINT)

    def output(process, hide):
        redactor = steam.Redactor(secrets)
        for line in iter(process.stdout.readline, b''):
            if not hide:
                sys.stdout.buffer.write(redactor.feed(line, final=True))
                sys.stdout.buffer.flush()

    old = {sig: signal.signal(sig, stop) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        for index, argv in enumerate([main] + clients):
            if stopping.is_set():
                break
            process = subprocess.Popen(argv, cwd=root, env=env, stdin=subprocess.PIPE if index == 0 else subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            with lock:
                processes.append(process)
                if stopping.is_set():
                    os.killpg(process.pid, signal.SIGINT)
            reader = threading.Thread(target=output, args=(process, hidden and index > 0), daemon=True)
            reader.start()
            readers.append(reader)

        if not processes:
            return 130

        def console():
            try:
                for line in sys.stdin.buffer:
                    if processes[0].poll() is not None:
                        break
                    processes[0].stdin.write(line)
                    processes[0].stdin.flush()
            except (BrokenPipeError, OSError):
                pass
        threading.Thread(target=console, daemon=True).start()
        deadline = None
        while processes[0].poll() is None:
            if stopping.is_set():
                deadline = deadline or time.monotonic() + 60
                if time.monotonic() >= deadline:
                    send(signal.SIGTERM)
                    break
            time.sleep(.1)
        if processes[0].poll() is None:
            try:
                processes[0].wait(timeout=10)
            except subprocess.TimeoutExpired:
                send(signal.SIGKILL)
        code = processes[0].wait()
        return 128 - code if code < 0 else code
    finally:
        send(signal.SIGINT)
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        for reader in readers:
            reader.join(timeout=2)
        for process in processes:
            if process.stdin:
                process.stdin.close()
            if process.stdout:
                process.stdout.close()
        for sig, handler in old.items():
            signal.signal(sig, handler)


def main():
    action, game = sys.argv[1:]
    if game not in ('arma3', 'reforger') or action not in ('install', 'run'):
        raise ValueError('Unknown Arma action')
    root = Path.cwd().resolve()
    env = dict(os.environ)
    if action == 'install':
        install(root, game, env)
        return 0
    if game == 'reforger' and boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        update_reforger(root, env)
    args, clients = configure(root, game, env)
    return supervise(root, args, clients, child_environment(root, game, env), boolean(env, 'HC_HIDE', True))


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        # Only controlled validation labels. urllib/subprocess errors may contain private URLs/argv.
        print(str(error) if isinstance(error, ValueError) else 'Arma operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
