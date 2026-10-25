#!/usr/bin/env python3
"""MIT. Original Conan/MoE controls, native INIs, ordered mods and scoped lifecycle."""
import hashlib
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


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        path = path.with_name(name.replace('_', '-') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


common = helper('ark_family')
steam, native = common.steam, common.native
confined, text, integer, boolean = common.confined, common.text, common.integer, common.boolean
GAMES = {'conan': (443030, 'windows', 'ConanSandbox/Binaries/Win64/ConanSandboxServer-Win64-Shipping.exe'),
         'enhanced': (443030, 'linux', 'ConanSandbox/Binaries/Linux/ConanSandboxServer-Linux-Shipping'),
         'empires': (1794810, 'windows', 'MOE/Binaries/Win64/MOEServer.exe')}


def quoted(value):
    if any(c in value for c in '"\\'):
        raise ValueError('Native Unreal quoted settings cannot contain quotes or backslashes')
    return '"' + value + '"'


def ids(value):
    values = [item.strip() for item in value.split(',')] if value else []
    if len(values) > 64 or any(not re.fullmatch('[1-9][0-9]{0,19}', value) for value in values):
        raise ValueError('Conan mod IDs require at most64 comma-separated numeric Workshop IDs')
    return list(dict.fromkeys(values))


def ports(env, game):
    primary = integer(env, 'SERVER_PORT', 12888 if game == 'empires' else 7777, 1024 if game == 'empires' else 1)
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Missing Conan/MoE allocations')
    available = {int(value) for value in raw.split(',')}
    used = {primary}
    if primary not in available or any(not 1 <= value <= 65535 for value in available):
        raise ValueError('Invalid Conan/MoE allocations')
    if game != 'empires':
        if primary + 1 not in available:
            raise ValueError('Conan pinger requires primary-plus-one UDP allocation')
        used.add(primary + 1)
    result = {'SERVER_PORT': primary}
    for key in ('QUERY_PORT', 'RCON_PORT'):
        enabled = key == 'QUERY_PORT' or game == 'conan' or boolean(env, 'SHUTDOWN_SERVICE' if game == 'empires' else 'RCON_ENABLED', game == 'empires')
        if not enabled:
            continue
        raw = env.get(key, '')
        if raw:
            value = integer(env, key, 0, 1024 if game == 'empires' else 1)
        else:
            candidates = sorted(available - used)
            if not candidates:
                raise ValueError('Missing distinct allocation for ' + key)
            value = candidates[0]
        if value not in available or value in used:
            raise ValueError('Conan/MoE listeners require distinct allocations')
        used.add(value);result[key] = value
    return result


def configure_plan(root, game, env):
    selected = ports(env, game)
    plan = {'binary': confined(root, GAMES[game][2]), 'ports': selected, 'configs': {}, 'credentials': [],
            'rcon_enabled': False, 'rcon_password': '', 'ready': b'Started SourceServerQueries'}
    if game != 'empires':
        name = text(env, 'SRV_NAME' if game == 'conan' else 'SERVER_NAME', 'Conan Server', 256)
        password = text(env, 'SRV_PW' if game == 'conan' else 'SERVER_PASSWORD', '', 255)
        admin = text(env, 'ADMIN_PASSWORD', '', 20)
        rcon = text(env, 'RCON_PASSWORD', '', 128)
        enabled = boolean(env, 'RCON_ENABLED')
        if enabled and not rcon:
            raise ValueError('Choose an actual RCON_PASSWORD before enabling RCON')
        args = ['-Port=' + str(selected['SERVER_PORT']), '-QueryPort=' + str(selected['QUERY_PORT']),
                '-ServerName=' + quoted(name), '-console', '-log']
        if game == 'conan' or password:
            args += ['-ServerPassword=' + quoted(password)]
        if 'RCON_PORT' in selected:
            args += ['-RconPort=' + str(selected['RCON_PORT'])]
        if game == 'enhanced':
            args += ['-MaxPlayers=' + str(integer(env, 'MAX_PLAYERS', 10, 1, 1024)),
                     '-Multihome=0.0.0.0', '-MultihomeHTTP=0.0.0.0']
        prefix = 'ConanSandbox/Saved/Config/' + ('WindowsServer' if game == 'conan' else 'LinuxServer') + '/'
        plan['configs'][prefix + 'Engine.ini'] = {
            'URL': {'Port': str(selected['SERVER_PORT'])},
            'OnlineSubsystem': {'ServerName': name, **({'ServerPassword': password} if game == 'conan' or password else {})},
            'OnlineSubsystemNull': {'GameServerQueryPort': str(selected['QUERY_PORT'])}}
        plan['configs'][prefix + 'ServerSettings.ini'] = {'ServerSettings': {'AdminPassword': admin, **({'ServerPassword': password} if game == 'conan' or password else {})}}
        plan['configs'][prefix + 'Game.ini'] = {'RconPlugin': {'RconEnabled': 'True' if enabled else 'False', 'RconPassword': rcon,
                                             'RconPort': str(selected.get('RCON_PORT', 0))}}
        if game == 'enhanced':
            plan['configs'][prefix + 'Game.ini']['/Script/Engine.GameSession'] = {'MaxPlayers': str(integer(env, 'MAX_PLAYERS', 10, 1, 1024))}
        plan.update(args=args, rcon_enabled=enabled, rcon_password=rcon, credentials=[password, admin, rcon],
                    log=confined(root, 'ConanSandbox/Saved/Logs/ConanSandbox.log'))
    else:
        game_map = text(env, 'MAP_NAME', 'LargeTerrain_Central_Main', 80)
        if game_map not in ('LargeTerrain_Central_Main', 'LargeTerrain_Central2_Main'):
            raise ValueError('Choose one of the original Myth of Empires maps')
        name = text(env, 'SERVER_NAME', 'Myth of Empires Server', 80)
        key = text(env, 'RCON_PASSWORD', '', 32)
        if not re.fullmatch('[A-Za-z0-9_-]{5,32}', key):
            raise ValueError('Choose an actual private MoE shutdown-service key, five to32 alpha-dash characters')
        admins = text(env, 'ADMIN_IDS', '', 128)
        if admins and not re.fullmatch('[0-9]{17}(?:;[0-9]{17})*', admins):
            raise ValueError('MoE GM accounts must be semicolon-separated real SteamID64 values')
        address = text(env, 'OUT_ADDRESS', '', 64) or text(env, 'SERVER_IP', '', 64)
        if not address or ipaddress.ip_address(address).version != 4:
            raise ValueError('Set OUT_ADDRESS to the real reachable LAN/Tailscale/public IPv4')
        server_id = integer(env, 'SERVER_ID', 100, 1, 2147483647)
        values = {'OutAddress': address, 'SessionName': quoted(name), 'GameServerPVPType': str(int(boolean(env, 'PVP', True))),
                  'MaxPlayers': str(integer(env, 'MAX_PLAYERS', 25, 1, 150)), 'MapDifficultyRate': '1',
                  'EnableVACBan': '1', 'ServerId': str(server_id), 'ClusterId': str(integer(env, 'CLUSTER_ID', 1, 1, 2147483647)),
                  'Port': str(selected['SERVER_PORT']), 'QueryPort': str(selected['QUERY_PORT']),
                  'bStartShutDownServiceInPrivateServer': str(int(boolean(env, 'SHUTDOWN_SERVICE', True))),
                  'ShutDownServiceIP': '127.0.0.1', 'ShutDownServicePort': str(selected['RCON_PORT'] if 'RCON_PORT' in selected else integer(env, 'RCON_PORT', 13888) if env.get('RCON_PORT') else 13888),
                  'ShutDownServiceKey': quoted(key), 'ServerAdminAccounts': quoted(admins)}
        extra = shlex.split(text(env, 'EXTRA_FLAGS', '', 4096))
        for arg in extra:
            if not arg.startswith('-') or arg.lstrip('-').split('=', 1)[0].lower() in {key.lower() for key in values} | {'multihome'}:
                raise ValueError('Use dedicated MoE identity/listener controls; extras must be native -flags')
        args = [game_map, '-game', '-server', '-DataLocalFile', '-NotCheckServerSteamAuth', '-LOCALLOGTIMES',
                '-PrivateServer', '-MultiHome=0.0.0.0', '-UseACE', *('-' + key + '=' + value for key, value in values.items()), *extra]
        plan.update(args=args, credentials=[key], log=confined(root, 'MOE/Saved/Logs/MOE.log'),
                    ready=re.compile(rb'ServerId\s*[:=]\s*' + str(server_id).encode() + rb'\b.*SERVER_STATE_OPENED'))
        for arg in extra:
            key, separator, value = arg.partition('=')
            if separator and any(word in key.lower() for word in ('pass', 'token', 'auth', 'secret', 'key')):
                plan['credentials'].append(value)
    plan['credentials'] += [env.get(key, '') for key in ('STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    return plan


def configure(root, game, env):
    plan = configure_plan(root, game, env)
    for name, sections in plan['configs'].items():
        path = confined(root, name)
        before = path.read_text(encoding='utf-8-sig') if path.exists() else ''
        for match in re.finditer(r'(?mi)^\s*(?:ServerPassword|AdminPassword|RconPassword)\s*=\s*([^\r\n]+)', before):
            plan['credentials'] += [match[1], match[1].strip('"')]
        after = native.patch_ini(before, sections)
        if after != before:
            if before:
                native.private_write(confined(root, '.voltra/conan-empires/config-backups/' + str(time.time_ns()) + '-' + path.name), before)
            native.private_write(path, after)
        else:
            path.chmod(0o600)
    return plan


def steam_options(root, game, env):
    app, platform, binary = GAMES[game]
    if integer(env, 'SRCDS_APPID', app, 1, 2147483647) != app or boolean(env, 'WINDOWS_INSTALL', platform == 'windows') != (platform == 'windows'):
        raise ValueError('Use the matching Conan/MoE recipe and original Linux/Windows depot')
    options = {key: env.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAID', 'SRCDS_BETAPASS', 'INSTALL_FLAGS')}
    steam.arguments(root, app, options, platform=platform, force_platform=True)
    return app, platform, binary, options


def download_mods(root, env, selected):
    if not selected:
        return
    _, platform, _, options = steam_options(root, 'enhanced', env)
    argv = steam.arguments(root, 443030, options, platform=platform, force_platform=True)
    argv = argv[:argv.index('+app_update')]
    for identifier in selected:
        argv += ['+workshop_download_item', '440900', identifier, 'validate']
    argv += ['+quit']
    steam.bootstrap(root)
    child_env = dict(os.environ)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
        child_env.pop(key, None)
    child_env['HOME'] = str(root)
    child = subprocess.Popen(['timeout', '--signal=TERM', '--kill-after=30s', '7200s', *argv], cwd=root, env=child_env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    redactor = steam.Redactor([options.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')])
    successes, tail = set(), b''
    try:
        for block in iter(lambda: child.stdout.read1(16384), b''):
            tail = (tail + block)[-65536:]
            successes.update(value.decode() for value in re.findall(rb'Success\. Downloaded item ([0-9]+)', tail))
            sys.stdout.buffer.write(redactor.feed(block));sys.stdout.buffer.flush()
        if child.wait() != 0 or not set(selected) <= successes:
            raise ValueError('Conan public Workshop download failed. Check publisher output and entitlement; no private-account fallback is used.')
    finally:
        sys.stdout.buffer.write(redactor.feed(b'', final=True));sys.stdout.buffer.flush()
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL);child.wait()


def digest(path):
    hasher = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1048576), b''):
            hasher.update(block)
    return hasher.hexdigest()


def cache_snapshot(root):
    folder = confined(root, 'ConanSandbox/Saved/ExtractedMods')
    if not folder.exists():
        return {}
    result = {}
    for path in folder.iterdir():
        path = confined(root, str(path.relative_to(root)))
        if path.is_file():
            result[path.name] = digest(path)
        if len(result) > 30000:
            raise ValueError('Conan extracted mod cache exceeds its file limit')
    return result


def record_mod_cache(root, before):
    """Claim only cache files created/changed during this owned native run."""
    state = confined(root, '.voltra/conan-empires/mods.json')
    if not state.exists():
        return
    record = json.loads(state.read_text())
    after = cache_snapshot(root)
    owners = {}
    for identifier, entry in record.get('managed', {}).items():
        for name in entry.get('files', {}):
            if Path(name).suffix.lower() == '.pak':
                owners.setdefault(Path(name).stem, set()).add(identifier)
    extracted = record.setdefault('extracted', {})
    for name, checksum in after.items():
        matches = set().union(*(owners[base] for base in owners if name.startswith((base + '.', base + '-'))))
        if len(matches) == 1 and before.get(name) != checksum:
            identifier, = matches
            extracted.setdefault(identifier, {})[name] = checksum
    native.private_write(state, json.dumps(record, indent=2) + '\n')


def sync_mods(root, env):
    selected = ids(text(env, 'MOD_IDS'))
    folder = confined(root, 'ConanSandbox/Mods');folder.mkdir(parents=True, exist_ok=True)
    state = confined(root, '.voltra/conan-empires/mods.json')
    previous = json.loads(state.read_text()) if state.exists() else {'managed': {}}
    managed = previous.get('managed', {})
    current, lines, discovered, desired_files = {}, [], [], {}
    # Validate every source and conflict before publishing any file or retiring mods.
    plans = []
    for identifier in selected:
        candidates = [confined(root, prefix + identifier) for prefix in ('steamapps/workshop/content/440900/', '.voltra/steamcmd/steamapps/workshop/content/440900/')]
        available = [path for path in candidates if path.is_dir()]
        destination = folder / identifier
        if not available:
            if destination.is_dir() and not destination.is_symlink():
                available = [confined(root, str(destination.relative_to(root)))]
            else:
                raise ValueError('Requested Conan mod is unavailable; upload it legitimately or enable public UPDATE_MODS: ' + identifier)
        if len(available) != 1:
            raise ValueError('Ambiguous Conan Workshop caches; retain both for operator review')
        source = available[0]
        files = {}
        for path in source.rglob('*'):
            path = confined(root, str(path.relative_to(root)))
            if path.is_file():
                name = str(path.relative_to(source))
                if any(ord(c) < 32 or c in ':\\' for c in name):
                    raise ValueError('Conan mod file cannot be represented by a native modlist path')
                files[name] = (path, digest(path))
        if len(files) > 30000 or not any(Path(name).suffix.lower() == '.pak' for name in files):
            raise ValueError('Conan Workshop payload has no native .pak or exceeds its file limit')
        if destination.is_symlink():
            if destination.resolve() != source:
                raise ValueError('Foreign Conan mod link is not owned by this recipe')
            plans.append(('legacy_link', destination, None))
        elif destination.exists():
            confined(root, str(destination.relative_to(root)))
        for name, (incoming, checksum) in files.items():
            target = destination / name
            if not destination.is_symlink() and target.exists():
                target = confined(root, str(target.relative_to(root)))
                actual = digest(target)
                old = managed.get(identifier, {}).get('files', {}).get(name)
                if actual not in (checksum, old):
                    raise ValueError('Conan mod update conflicts with an operator edit; preserve it and review before updating')
            plans.append(('file', target, (incoming, checksum, identifier, name)))
        current[identifier] = {'files': {}, 'pak_lines': ['*' + identifier + '/' + name for name in sorted(files) if Path(name).suffix.lower() == '.pak']}
        desired_files[identifier] = set(files)
        lines += current[identifier]['pak_lines']
    for action, target, value in plans:
        if action == 'legacy_link':
            target.unlink();target.mkdir()
            continue
        incoming, checksum, identifier, name = value
        target = confined(root, str(target.relative_to(root)))
        old = managed.get(identifier, {}).get('files', {}).get(name)
        if target.exists() and digest(target) == checksum:
            if old == checksum:
                current[identifier]['files'][name] = checksum
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        def write(output, source=incoming):
            with source.open('rb') as data:
                shutil.copyfileobj(data, output)
        steam._publish(root, str(target.relative_to(root)), write, 0o644)
        current[identifier]['files'][name] = checksum
    retired_lines = set()
    for identifier in managed:
        for name, checksum in managed[identifier].get('files', {}).items():
            if name in desired_files.get(identifier, set()):
                continue
            target = confined(root, 'ConanSandbox/Mods/' + identifier + '/' + name)
            if target.is_file() and digest(target) == checksum:
                archive = confined(root, '.voltra/conan-empires/retired-mods/' + str(time.time_ns()) + '/' + identifier + '/' + name)
                archive.parent.mkdir(parents=True, exist_ok=True);os.replace(target, archive)
                if Path(name).suffix.lower() == '.pak':
                    retired_lines.add('*' + identifier + '/' + name)
    # Retain operator ordering/comments. Remove only prior managed entries that
    # vanished; append missing managed/custom paks without renaming them.
    modlist = confined(root, 'ConanSandbox/Mods/modlist.txt')
    before = modlist.read_text() if modlist.exists() else ''
    output = [line for line in before.splitlines() if line not in retired_lines]
    for path in sorted(folder.rglob('*.pak')):
        if path.parts[len(folder.parts)] in current:
            continue
        confined(root, str(path.relative_to(root)))
        discovered.append('*' + str(path.relative_to(folder)))
    for line in lines + discovered:
        if line not in output:
            output.append(line)
    after = '\n'.join(output) + ('\n' if output else '')
    if after != before:
        native.private_write(modlist, after)
    extracted = {}
    for identifier, entries in previous.get('extracted', {}).items():
        if identifier in current:
            extracted[identifier] = entries
            continue
        for name, checksum in entries.items():
            cache = confined(root, 'ConanSandbox/Saved/ExtractedMods/' + name)
            if cache.is_file() and digest(cache) == checksum:
                archive = confined(root, '.voltra/conan-empires/retired-mod-cache/' + str(time.time_ns()) + '/' + name)
                archive.parent.mkdir(parents=True, exist_ok=True);os.replace(cache, archive)
    native.private_write(state, json.dumps({'workshop_app': 440900, 'managed': current, 'extracted': extracted}, indent=2) + '\n')


def install(root, game, env):
    app, platform, binary, options = steam_options(root, game, env)
    saved = confined(root, ('MOE' if game == 'empires' else 'ConanSandbox') + '/Saved')
    protected = [path for path in saved.rglob('*.ini') if path.is_file()] if saved.exists() else []
    with tempfile.TemporaryDirectory(prefix='voltra-conan-retention-', dir=confined(root, '.')) as directory:
        backups = []
        for index, path in enumerate(protected):
            path = confined(root, str(path.relative_to(root)));backup = Path(directory) / str(index)
            shutil.copy2(path, backup);backups.append((path.relative_to(root), backup))
        try:
            steam.update(root, app, options, validate=True, required=(binary,), platform=platform, force_platform=True)
        finally:
            for name, backup in backups:
                target = confined(root, str(name));target.parent.mkdir(parents=True, exist_ok=True);shutil.copy2(backup, target)
    if game == 'empires':
        helper('enshrouded_proton').provision(root)


def environment(root, game, env):
    result = {key: value for key, value in env.items() if key not in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')
              and not any(word in key for word in ('PASSWORD', 'STEAM_PASS', 'STEAM_AUTH', 'BETAPASS', 'SRV_PW'))}
    result['HOME'] = str(root)
    if game == 'conan':
        requested = text(env, 'VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022 corefonts'))
        choices = requested.split()
        if len(set(choices)) != len(choices) or any(value not in ('vcrun2022', 'corefonts') for value in choices):
            raise ValueError('Conan typed prerequisites allow only original vcrun2022/corefonts, never arbitrary Winetricks commands')
        prefix = confined(root, '.voltra/conan-empires/wine-prefix')
        if choices:
            if not boolean(env, 'WINE_PREREQUISITES_READY') or not confined(root, str((prefix / 'system.reg').relative_to(root))).is_file():
                raise ValueError('Prepare the confined Conan Wine prefix with legitimate original vcrun2022/corefonts prerequisites, then explicitly set WINE_PREREQUISITES_READY=1; no external installer agreement is accepted automatically')
            for name in ('drive_c/windows/system32/vcruntime140.dll', 'drive_c/windows/system32/msvcp140.dll') if 'vcrun2022' in choices else ():
                if not confined(root, str((prefix / name).relative_to(root))).is_file():
                    raise ValueError('Requested Conan VC runtime is absent from the prepared private prefix')
            if 'corefonts' in choices:
                fonts = confined(root, str((prefix / 'drive_c/windows/Fonts').relative_to(root)))
                if not fonts.is_dir() or not any(confined(root, str(path.relative_to(root))).is_file() and path.name.lower() == 'arial.ttf' for path in fonts.iterdir()):
                    raise ValueError('Requested Conan core font is absent from the prepared private prefix')
        prefix.mkdir(parents=True, exist_ok=True)
        result.update(WINEPREFIX=str(prefix), WINEDEBUG=text(env, 'WINEDEBUG', '-all'), WINEPATH=text(env, 'WINEPATH', '/home/container'))
    if game == 'empires':
        for key, name in [('STEAM_COMPAT_CLIENT_INSTALL_PATH', '.steam/steam'), ('STEAM_COMPAT_DATA_PATH', '.steam/steam/steamapps/compatdata/1794810')]:
            path = confined(root, name);path.mkdir(parents=True, exist_ok=True);result[key] = str(path)
        result.update(PROTON_USE_WINED3D='1', PROTON_NO_ESYNC='1', WINEPREFIX=str(confined(root, '.steam/steam/steamapps/compatdata/1794810/pfx')),
                      LD_LIBRARY_PATH=str(confined(root, '.voltra/proton/lib')) + ':' + str(confined(root, '.steam/sdk64')))
    return result


def native_pids(root, binary, proc=Path('/proc')):
    expected = {str(binary).casefold(), ('Z:' + str(binary).replace('/', '\\')).casefold()}
    result = []
    for path in proc.iterdir():
        if not path.name.isdigit():
            continue
        try:
            if path.stat().st_uid == os.getuid() and (path / 'cmdline').read_bytes().split(b'\0', 1)[0].decode('utf-8', 'strict').casefold() in expected:
                result.append(int(path.name))
        except (OSError, UnicodeError):
            pass
    return result


def run(root, game, plan, env):
    if not plan['binary'].is_file():
        raise ValueError('Selected Conan/MoE native binary is missing; install the exact matching recipe/depot')
    argv = [str(plan['binary']), *plan['args']]
    if game == 'conan':
        wine = shutil.which('wine')
        if not wine:
            raise ValueError('Pinned Wine host is missing wine')
        argv = [wine, *argv]
    elif game == 'empires':
        argv = [str(helper('enshrouded_proton').location(root)), 'run', *argv]
    stopped, done = threading.Event(), threading.Event()
    previous = {sig: signal.signal(sig, lambda *_: stopped.set()) for sig in (signal.SIGINT, signal.SIGTERM)}
    lock = threading.Lock();ready = threading.Event();threads = [];child = None
    initial_offset = plan['log'].stat().st_size if plan['log'].exists() else 0
    def emit(data, redactor):
        if (plan['ready'].search(data) if isinstance(plan['ready'], re.Pattern) else plan['ready'] in data) and not ready.is_set():
            ready.set();data += b'\nVOLTRA_CONAN_EMPIRES_READY native publisher initialization marker; client/persistence not tested.\n'
        with lock:
            sys.stdout.buffer.write(redactor.feed(data, final=data.endswith(b'\n')));sys.stdout.buffer.flush()
    def output():
        redactor = steam.Redactor(plan['credentials'])
        for line in iter(child.stdout.readline, b''):
            emit(line, redactor)
        emit(b'\n', redactor)
    def logs():
        redactor = steam.Redactor(plan['credentials']);pending = b''
        offset = initial_offset
        identity = None
        while not done.wait(.1):
            try:
                path = confined(root, str(plan['log'].relative_to(root)));stat = path.stat()
                current = (stat.st_dev, stat.st_ino)
                if identity is not None and current != identity or stat.st_size < offset:
                    offset = 0;pending = b''
                identity = current
                with path.open('rb') as stream:
                    stream.seek(offset);pending += stream.read(65536);offset = stream.tell()
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1);emit(line + b'\n', redactor)
                if len(pending) > 65536:
                    emit(pending, redactor);pending = b''
            except FileNotFoundError:
                pass
        if pending:
            emit(pending + b'\n', redactor)
    def console():
        redactor = steam.Redactor(plan['credentials'])
        try:
            for line in sys.stdin:
                if done.is_set():
                    return
                if plan['rcon_enabled']:
                    try:
                        reply = common.command(plan['ports']['RCON_PORT'], plan['rcon_password'], line.rstrip('\r\n'))
                        emit((reply + '\n').encode(), redactor)
                    except (OSError, ValueError, EOFError):
                        emit(b'Conan authenticated RCON command failed.\n', redactor)
                else:
                    child.stdin.write(line.encode());child.stdin.flush()
        except (BrokenPipeError, OSError):
            pass
    try:
        child = subprocess.Popen(argv, cwd=root, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        for target in (output, logs, console):
            thread = threading.Thread(target=target, daemon=True);thread.start();threads.append(thread)
        deadline = None;started = time.monotonic();redactor = steam.Redactor(plan['credentials'])
        while True:
            live = native_pids(root, plan['binary']) if game != 'enhanced' else []
            if child.poll() is not None and not live:
                if game == 'enhanced' or child.returncode != 0 or ready.is_set() or time.monotonic() - started > 15:
                    break
            if stopped.is_set() and deadline is None:
                deadline = time.monotonic() + 120
                if plan['rcon_enabled']:
                    try:
                        common.command(plan['ports']['RCON_PORT'], plan['rcon_password'], 'shutdown', allow_disconnect=True, timeout=5)
                        emit(b'Conan native shutdown requested; waiting for actual exit.\n', redactor)
                        continue
                    except (OSError, ValueError, EOFError):
                        emit(b'Conan RCON shutdown unavailable; forwarding original native Ctrl-C, persistence unconfirmed.\n', redactor)
                # MoE private shutdown protocol has no reviewed wire implementation.
                # Preserve original Ctrl-C rather than guessing Source-RCON packets.
                for pid in live:
                    try:
                        os.kill(pid, signal.SIGINT)
                    except ProcessLookupError:
                        pass
                if child.poll() is None:
                    os.killpg(child.pid, signal.SIGINT)
            if deadline and time.monotonic() >= deadline:
                emit(b'Conan/MoE native stop timeout; save completion is unconfirmed.\n', redactor)
                return 1
            time.sleep(.1)
        code = child.returncode
        return code if code >= 0 else 128 - code
    finally:
        done.set()
        if child is not None and child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL);child.wait()
        for pid in native_pids(root, plan['binary']) if game != 'enhanced' else []:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        for thread in threads[:2]:
            thread.join(timeout=2)
        if child is not None:
            if child.stdin:
                child.stdin.close()
            if child.stdout:
                child.stdout.close()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main():
    action, game = sys.argv[1:]
    if action not in ('install', 'run') or game not in GAMES:
        raise ValueError('Unknown Conan/MoE recipe action')
    root = Path.cwd().resolve();env = dict(os.environ)
    if action == 'install':
        install(root, game, env);return 0
    configure_plan(root, game, env)
    child_env = environment(root, game, env)
    if boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        install(root, game, env)
    if game == 'enhanced':
        if boolean(env, 'UPDATE_MODS', True):
            download_mods(root, env, ids(text(env, 'MOD_IDS')))
        sync_mods(root, env)
    before = cache_snapshot(root) if game == 'enhanced' else {}
    try:
        return run(root, game, configure(root, game, env), child_env)
    finally:
        if game == 'enhanced':
            record_mod_cache(root, before)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Conan/MoE operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
