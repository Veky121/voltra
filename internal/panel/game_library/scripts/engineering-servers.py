#!/usr/bin/env python3
"""MIT. Original Space Engineers/Torch and Nitrox typed setup; no native proof."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        path = path.with_name(name.replace('-', '_') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name.replace('-', '_')] = module
    spec.loader.exec_module(module)
    return module


shared = helper('steam-native-next')
steam, native, release = shared.steam, shared.native, shared.release
PINS = json.loads(Path(__file__).with_name('engineering-servers-pins.json').read_text())


def xml(content, expected):
    if len(content.encode('utf-8')) > 16 * 1024**2 or re.search(r'<!\s*(?:DOCTYPE|ENTITY)', content, re.I):
        raise ValueError('Unsupported native XML')
    document = ET.fromstring(content.lstrip(), parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    if document.tag != expected:
        raise ValueError('Unexpected native XML root')
    return document


def set_xml(document, path, value):
    current = document
    for part in path.split('/'):
        children = current.findall(part)
        if len(children) > 1:
            raise ValueError('Duplicate managed native XML field')
        current = children[0] if children else ET.SubElement(current, part)
    current.text = str(value)


def boolean(env, key, default='false', capital=False):
    value = shared.text(env, key, default, 5)
    choices = ('True', 'False') if capital else ('true', 'false')
    if value not in choices:
        raise ValueError('Invalid native boolean ' + key)
    return value


def choice(env, key, default, choices):
    value = shared.text(env, key, default, 128)
    if value not in choices:
        raise ValueError('Invalid original selection ' + key)
    return value


def windows(path):
    return 'Z:' + str(path).replace('/', '\\')


def write_xml(root, path, document):
    shared.write_config(root, path, '<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(document, encoding='unicode') + '\n')


def configure(root, game, env):
    root = Path(root).resolve()
    if game == 'nitrox':
        ports = shared.roles(env, [])
        save = shared.text(env, 'SAVE_NAME', 'nitrox_world', 100)
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', save):
            raise ValueError('Invalid original save name')
        values = {'ServerPort': ports['primary'], 'SaveInterval': shared.integer(env, 'SAVE_INTERVAL', 120000, 0, 2147483647),
                  'DisableAutoSave': boolean(env, 'SAVE_DISABLE', 'False', True),
                  'ServerPassword': shared.text(env, 'SUBNAUTICA_PASSWORD', '', 255),
                  'AdminPassword': shared.text(env, 'SUBNAUTICA_ADMIN_PASSWORD', 'PleaseChangeMe', 255),
                  'GameMode': choice(env, 'SERVER_MODE', 'SURVIVAL', ('SURVIVAL', 'FREEDOM', 'HARDCORE', 'CREATIVE')),
                  'AutoPortForward': boolean(env, 'PORTFORWARD_ENABLE', 'False', True),
                  'SerializerMode': choice(env, 'SERIALIZER_MODE', 'JSON', ('PROTOBUF', 'JSON')),
                  'MaxConnections': shared.integer(env, 'MAX_CONNECTIONS', 10, 1, 200),
                  'DefaultPlayerPerm': choice(env, 'DEFAULT_PERMISSION', 'PLAYER', ('NONE', 'PLAYER', 'MODERATOR', 'ADMIN', 'CONSOLE')),
                  'DisableConsole': boolean(env, 'DISABLE_CONSOLE', 'False', True)}
        path = shared.confined(root, root / 'NitroxData/saves' / save / 'server.cfg')
        content = path.read_text(encoding='utf-8-sig') if path.exists() else 'CreateFullEntityCache=False\nSeed=\nPostSaveCommandPath=\nInitialSyncTimeout=300000\nDefaultOxygenValue=45\nDefaultMaxOxygenValue=45\nDefaultHealthValue=80\nDefaultHungerValue=50.5\nDefaultThirstValue=90.5\nDefaultInfectionValue=0.1\n'
        shared.write_config(root, path, shared.patch_properties(content, values))
        return [str(root / 'nitrox/server'), '--save', save, '--data-path', str(root / 'NitroxData')], [values['ServerPassword'], values['AdminPassword']]
    ports = shared.roles(env, ['STEAM_PORT', 'REMOTEAPI_PORT'])
    instance = root / ('Instance' if game == 'torch' else 'config')
    world = shared.world_name(env, 'World', 20)
    settings = {'GameMode': choice(env, 'SERVER_MODE', 'Survival', ('Survival', 'Creative')),
                'MaxPlayers': shared.integer(env, 'MAX_PLAYERS', 4, 1, 2147483647),
                'AutoSaveInMinutes': shared.integer(env, 'SAVE_INTERVAL', 5, 0, 999),
                'EnableSaving': boolean(env, 'SAVE_ENABLED', 'true')}
    # Torch original never exposed these switches; preserve existing world values.
    if game == 'space':
        settings.update(ExperimentalMode=boolean(env, 'EXPERIMENTAL_ENABLED'), EnableIngameScripts=boolean(env, 'INGAMESCRIPTS_ENABLED'))
    path = shared.confined(root, instance / 'SpaceEngineers-Dedicated.cfg')
    default = Path(__file__).with_name('engineering-space-default.xml').read_text(encoding='utf-8')
    document = xml(path.read_text(encoding='utf-8-sig') if path.exists() else default, 'MyConfigDedicated')
    for key, value in settings.items():
        set_xml(document, 'SessionSettings/' + key, value)
    values = {'LoadWorld': windows(instance / 'Saves' / world / 'Sandbox.sbc'), 'WorldName': world,
              'ServerName': shared.text(env, 'SERVER_NAME', 'A Pterodactyl hosted Space Engineer Server', 64),
              'ServerDescription': shared.text(env, 'SERVER_DESC', 'A Pterodactyl hosted Space Engineer Server', 200),
              'ServerPort': ports['primary'], 'SteamPort': ports['STEAM_PORT'], 'RemoteApiPort': ports['REMOTEAPI_PORT'],
              'RemoteApiEnabled': boolean(env, 'REMOTEAPI_ENABLE')}
    for key, value in values.items():
        set_xml(document, key, value)
    # Fresh instances must not share the original public sample API secret.
    if not path.exists():
        import base64
        set_xml(document, 'RemoteSecurityKey', base64.b64encode(os.urandom(16)).decode())
        set_xml(document, 'ServerPasswordSalt', base64.b64encode(os.urandom(16)).decode())
    pending = [(path, document)]
    for filename, expected in [('Sandbox.sbc', 'MyObjectBuilder_Checkpoint'), ('Sandbox_config.sbc', 'MyObjectBuilder_WorldConfiguration')]:
        target = shared.confined(root, instance / 'Saves' / world / filename)
        if target.exists():
            doc = xml(target.read_text(encoding='utf-8-sig'), expected)
            for key, value in settings.items():
                set_xml(doc, 'Settings/' + key, value)
            pending.append((target, doc))
    for path, doc in pending:
        write_xml(root, path, doc)
    if game == 'torch':
        return ['wine', str(root / 'Torch.Server.exe'), '-noupdate', '-nogui', '-console', '-instancepath', windows(instance)], []
    return ['wine', str(root / 'DedicatedServer64/SpaceEngineersDedicated.exe'), '-path', windows(instance), '-console', '-ignorelastsession'], []


def extract_zip(archive, stage):
    # Complete prevalidation before even staged writes; no links/devices/duplicates.
    with zipfile.ZipFile(archive) as source:
        seen, total = set(), 0
        for entry in source.infolist():
            parts = PurePosixPath(entry.filename).parts
            mode = entry.external_attr >> 16
            if not parts or entry.filename.startswith('/') or '\\' in entry.filename or any(p in ('.', '..') or ':' in p for p in parts) or entry.filename in seen or stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('Unsafe engineering ZIP entry')
            seen.add(entry.filename); total += entry.file_size
            if total > 2 * 1024**3 or len(seen) > 100000:
                raise ValueError('Oversized engineering ZIP')
        for entry in source.infolist():
            path = stage.joinpath(*PurePosixPath(entry.filename).parts)
            if entry.is_dir():
                path.mkdir(parents=True, exist_ok=True)
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            with source.open(entry) as inp, path.open('xb') as out:
                shutil.copyfileobj(inp, out)
            path.chmod(0o755 if (entry.external_attr >> 16) & 0o111 else 0o644)


def install_zip(root, pin, target_name, key, executable=None, wrapper=False):
    state = shared.confined(root, root / '.voltra/engineering' / key)
    state.mkdir(parents=True, exist_ok=True)
    receipt = shared.confined(root, state / 'release.json')
    previous = json.loads(receipt.read_text()) if receipt.exists() else {}
    with tempfile.TemporaryDirectory(prefix='stage-', dir=state) as folder:
        temp = Path(folder)
        release.download(pin, temp / 'archive.zip')
        stage = temp / 'ready'; stage.mkdir()
        extract_zip(temp / 'archive.zip', stage)
        if wrapper:
            entries = list(stage.iterdir())
            if len(entries) == 1 and entries[0].is_dir():
                stage = entries[0]
        if executable and not (stage / executable).is_file():
            raise ValueError('Pinned archive lacks expected original executable')
        target = shared.confined(root, root / target_name)
        files = {p.relative_to(stage).as_posix(): release.sha256(p) for p in stage.rglob('*') if p.is_file()}
        destinations = {}
        for name, digest in files.items():
            destination = shared.confined(root, target / name)
            if destination.exists():
                # Unknown and edited program/plugin/config files stay operator owned.
                old = previous.get('files', {}).get(name)
                if not old or release.sha256(destination) != old:
                    if executable == name and release.sha256(destination) != digest:
                        raise ValueError('Operator executable conflicts with selected publisher release; preserve it for review')
                    continue
            destinations[name] = destination
        backups, applied = {}, []
        try:
            for name, destination in destinations.items():
                if destination.exists():
                    backup = temp / 'backup' / name
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, backup)
                    backups[name] = backup
                else:
                    backups[name] = None
                source = stage / name
                with source.open('rb') as inp:
                    steam._publish(root, destination.relative_to(root).as_posix(), lambda out, stream=inp: shutil.copyfileobj(stream, out), default_mode=source.stat().st_mode & 0o777)
                applied.append(name)
            # Never grant release ownership over unknown uploaded files.
            owned = {name: digest for name, digest in files.items() if name in destinations or name in previous.get('files', {}) and (target / name).is_file() and release.sha256(target / name) == digest}
            native.private_write(receipt, json.dumps({**pin, 'files': owned}, sort_keys=True) + '\n')
        except BaseException:
            for name in reversed(applied):
                destination, backup = destinations[name], backups[name]
                if backup is None:
                    destination.unlink()
                else:
                    with backup.open('rb') as inp:
                        steam._publish(root, destination.relative_to(root).as_posix(), lambda out, stream=inp: shutil.copyfileobj(stream, out))
            raise


def binary(path, linux=False):
    with path.open('rb') as stream:
        data = stream.read(4096)
    if linux:
        if len(data) < 20 or data[:6] != b'\x7fELF\x02\x01' or struct.unpack_from('<H', data, 18)[0] != 62:
            raise ValueError('Expected original x86-64 Linux binary')
    else:
        offset = struct.unpack_from('<I', data, 60)[0] if len(data) >= 64 else 0
        if offset < 64 or offset + 24 > len(data) or data[:2] != b'MZ' or data[offset:offset+4] != b'PE\0\0' or struct.unpack_from('<H', data, offset+4)[0] not in (0x8664, 0x14c):
            raise ValueError('Expected Windows PE binary')


def operator_files(root, game, server=True):
    if game == 'nitrox':
        names = ['subnautica/Subnautica.exe', 'subnautica/Subnautica_Data/Managed/Assembly-CSharp.dll'] + (['nitrox/server'] if server else [])
        directories = ['subnautica/Subnautica_Data/StreamingAssets']
    else:
        names = ['DedicatedServer64/SpaceEngineersDedicated.exe', 'DedicatedServer64/Sandbox.Game.dll']
        if game == 'torch':
            names += ['Torch.Server.exe', 'Torch.dll', 'Torch.API.dll']
        directories = ['Content']
    for name in directories:
        path = shared.confined(root, root / name)
        if not path.is_dir() or not any(path.iterdir()):
            raise ValueError('Missing original licensed game content')
    hashes = {}
    for name in names:
        path = shared.confined(root, root / name)
        if not path.is_file():
            raise ValueError('Missing original operator binary')
        binary(path, linux=game == 'nitrox' and name == 'nitrox/server')
        hashes[name] = {'sha256': release.sha256(path), 'bytes': path.stat().st_size}
    native.private_write(shared.confined(root, root / '.voltra/engineering/operator-files.json'), json.dumps({'game': game, 'files': hashes, 'publisher_authenticity_verified': False, 'runtime_verified': False}, sort_keys=True) + '\n')


def nitrox_release(env):
    version = shared.text(env, 'NITROX_VERSION', 'latest', 32)
    if version in ('latest', PINS['nitrox']['version']):
        return PINS['nitrox']
    if not re.fullmatch(r'[0-9]+(?:\.[0-9]+){2,3}', version) or tuple(int(p) for p in version.split('.')) < (1, 8, 0):
        raise ValueError('Nitrox original Linux interface requires version 1.8 or newer')
    request = urllib.request.Request('https://api.github.com/repos/SubnauticaNitrox/Nitrox/releases/tags/' + version, headers={'User-Agent': 'Voltra-engineering-installer'})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(2 * 1024**2 + 1)
    if len(data) > 2 * 1024**2:
        raise ValueError('Oversized publisher release metadata')
    metadata = json.loads(data)
    assets = [a for a in metadata.get('assets', []) if a.get('name') == 'Nitrox_' + version + '_linux_x64.zip']
    if metadata.get('tag_name') != version or len(assets) != 1:
        raise ValueError('Exact publisher version/architecture unavailable; never fall back silently')
    asset = assets[0]
    digest = asset.get('digest') or ''
    url = asset.get('browser_download_url', '')
    expected = 'https://github.com/SubnauticaNitrox/Nitrox/releases/download/' + version + '/' + asset['name']
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', digest) or url != expected or not 0 < asset.get('size', 0) <= 256 * 1024**2:
        raise ValueError('Publisher version lacks a verified SHA256 identity; use explicit operator Nitrox files')
    return {'version': version, 'url': url, 'sha256': digest[7:], 'bytes': asset['size'], 'license': 'GPL-3.0'}


def install_nitrox(root, env):
    mode = choice(env, 'NITROX_INSTALL_MODE', 'publisher', ('publisher', 'operator_files'))
    if mode == 'operator_files':
        operator_files(root, 'nitrox')
        return
    pin = nitrox_release(env)
    # Public OSS acquisition is independent of the licensed base game.
    install_zip(root, pin, 'nitrox', 'nitrox', wrapper=True)
    candidates = [shared.confined(root, root / 'nitrox' / name) for name in ('Nitrox.Server.Subnautica', 'NitroxServer-Subnautica')]
    found = [p for p in candidates if p.is_file()]
    if len(found) != 1:
        raise ValueError('Pinned Nitrox release lacks one original Linux server apphost')
    binary(found[0], linux=True)
    server = shared.confined(root, root / 'nitrox/server')
    marker = shared.confined(root, root / '.voltra/engineering/nitrox-launcher.json')
    old = json.loads(marker.read_text()) if marker.exists() else {}
    if server.exists() and not old:
        if release.sha256(server) != release.sha256(found[0]):
            raise ValueError('Preserve conflicting operator server launcher for review')
        return  # Unknown same-byte operator launcher is still not ours to replace.
    if server.exists() and release.sha256(server) != old.get('sha256'):
        raise ValueError('Preserve edited operator server launcher for review')
    with found[0].open('rb') as inp:
        steam._publish(root, 'nitrox/server', lambda out: shutil.copyfileobj(inp, out), default_mode=0o755)
    server.chmod(server.stat().st_mode | 0o100)
    native.private_write(marker, json.dumps({'version': pin['version'], 'sha256': release.sha256(server), 'source': found[0].name}) + '\n')


def steam_sdk(root):
    state = shared.confined(root, root / '.voltra/engineering/sdk')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='sdk-', dir=state) as folder:
        stage = Path(folder)
        steam.update(stage, 1007, {'WINDOWS_INSTALL': '1'}, required=(), platform='windows')
        payloads = {}
        for name in ('steamclient.dll', 'steamclient64.dll', 'tier0_s.dll', 'tier0_s64.dll', 'vstdlib_s.dll', 'vstdlib_s64.dll'):
            found = [p for p in stage.rglob('*') if p.is_file() and p.name.lower() == name]
            if len(found) != 1:
                raise ValueError('Missing or ambiguous original Steam SDK DLL')
            source = shared.confined(stage, found[0]); binary(source)
            data = source.read_bytes(); offset = struct.unpack_from('<I', data, 60)[0]
            if struct.unpack_from('<H', data, offset + 4)[0] != (0x8664 if '64' in name else 0x14c):
                raise ValueError('Original Steam SDK architecture mismatch')
            for target in (name, 'DedicatedServer64/' + name):
                shared.confined(root, root / target)
                payloads[target] = data
        for arch in ('32', '64'):
            source = shared.confined(root, root / ('.voltra/steamcmd/linux' + arch + '/steamclient.so'))
            if not source.is_file():
                raise ValueError('Missing original Linux Steam SDK client')
            target = '.steam/sdk' + arch + '/steamclient.so'
            shared.confined(root, root / target)
            payloads[target] = source.read_bytes()
        for name, data in payloads.items():
            target = root / name
            if not target.exists():
                steam._publish(root, name, lambda out, value=data: out.write(value))
            # Existing operator DLLs are retained without granting release ownership.


def install(root, game, env):
    root = Path(root).resolve()
    mode = choice(env, 'INSTALL_MODE', 'steam', ('steam', 'operator_files'))
    appkey, app = ('APPID', '264710') if game == 'nitrox' else ('SRCDS_APPID', '298740')
    if env.get(appkey, app) != app or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Wrong original application or platform')
    if mode == 'operator_files':
        operator_files(root, game, server=False)
        if game == 'nitrox':
            install_nitrox(root, env)
        return
    if game == 'nitrox':
        # Never launch private credentials through SteamCMD's unverified parser.
        raise ValueError('Private Subnautica Steam transport unsupported; select legitimate operator_files mode')
    steam.arguments(root, 298740, env, platform='windows')
    with shared.preserve(root):
        steam.update(root, 298740, env, required=('DedicatedServer64/SpaceEngineersDedicated.exe',), platform='windows')
        steam_sdk(root)
        if game == 'torch':
            install_zip(root, PINS['torch'], '.', 'torch', 'Torch.Server.exe')
        instance = 'Instance' if game == 'torch' else 'config'
        target = shared.confined(root, root / instance / 'Saves/World')
        if not target.exists():
            install_zip(root, PINS['world'], instance + '/Saves', 'default-world')


def prepare_wine(root, game, env):
    supplied = env.get('WINEPREFIX', str(root / '.wine'))
    prefix = shared.confined(root, Path(supplied))
    if not prefix.is_absolute():
        raise ValueError('Wine prefix must be an absolute private path')
    if env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('Space Engineers requires win64')
    registry = shared.confined(root, prefix / 'system.reg')
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix preserved, requires win64')
    original = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022 corefonts dotnet48' if game == 'torch' else 'win11 vcrun2022 mono corefonts'))
    verbs = original.split()
    if not verbs or len(verbs) != len(set(verbs)) or any(v not in ('win11', 'vcrun2022', 'mono', 'corefonts', 'dotnet48') for v in verbs):
        raise ValueError('Unsupported Wine prerequisite; no shell fragments accepted')
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Review and explicitly accept Microsoft/font runtime licenses before installing prerequisites')
    environment = dict(os.environ)
    for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'STEAM_USERNAME', 'STEAM_PASSWORD', 'STEAM_GUARDCODE', 'PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
        environment.pop(key, None)
    environment.update(HOME=str(root), WINEPREFIX=str(prefix), WINEARCH='win64', WINEDEBUG=shared.text(env, 'WINEDEBUG', '-all', 32), WINEDLLOVERRIDES='mscoree,mshtml=')
    winepath = Path(env.get('WINEPATH', str(root)))
    shared.confined(root, winepath)
    environment['WINEPATH'] = str(winepath)
    marker = shared.confined(root, prefix / '.voltra-prerequisites.json')
    identity = {'verbs': verbs, 'mono_sha256': PINS['mono']['sha256'], 'runtime_image': PINS['wine_runtime']}
    if marker.exists() and json.loads(marker.read_text()) == identity:
        environment['WINEDLLOVERRIDES'] = 'mscoree=n,b;mshtml=n,b'
        return environment
    prefix.mkdir(parents=True, exist_ok=True)
    subprocess.run(['xvfb-run', '-a', 'wineboot', '-u'], env=environment, cwd=root, check=True, timeout=300)
    for verb in verbs:
        if verb == 'mono':
            state = shared.confined(root, root / '.voltra/engineering/runtime-downloads'); state.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='mono-', dir=state) as folder:
                msi = Path(folder) / 'mono.msi'
                release.download(PINS['mono'], msi)
                subprocess.run(['xvfb-run', '-a', 'wine', 'msiexec', '/i', str(msi), '/qn', '/norestart'], env=environment, cwd=root, check=True, timeout=600)
        else:
            subprocess.run(['xvfb-run', '-a', 'winetricks', '-q', verb], env=environment, cwd=root, check=True, timeout=1800)
    native.private_write(marker, json.dumps(identity, sort_keys=True) + '\n')
    environment['WINEDLLOVERRIDES'] = 'mscoree=n,b;mshtml=n,b'
    return environment


def run(root, game, env):
    root = Path(root).resolve()
    mode = choice(env, 'INSTALL_MODE', 'steam', ('steam', 'operator_files'))
    if game == 'nitrox':
        if mode != 'operator_files':
            raise ValueError('Private Steam acquisition unsupported; use licensed operator files')
        operator_files(root, game)
        environment = dict(os.environ)
        environment.update(SUBNAUTICA_INSTALLATION_PATH=str(root / 'subnautica'), XDG_CONFIG_HOME=str(root / '.config'))
    else:
        automatic = choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ('0', '1'))
        if mode == 'operator_files' or automatic == '1':
            install(root, game, env)
        environment = prepare_wine(root, game, env)
    for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'STEAM_USERNAME', 'STEAM_PASSWORD', 'STEAM_GUARDCODE', 'SRCDS_BETAPASS', 'PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH'):
        environment.pop(key, None)
    argv, credentials = configure(root, game, env)
    credentials += [env.get(k, '') for k in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'STEAM_USERNAME', 'STEAM_PASSWORD', 'STEAM_GUARDCODE', 'SRCDS_BETAPASS')]
    if game == 'nitrox':
        (root / '.config').mkdir(exist_ok=True)
    code = helper('native-console').run(root, argv, environment, '\x03', credentials, terminal_input=True)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    try:
        action, game = sys.argv[1:3]
        if game not in ('space', 'torch', 'nitrox'):
            raise ValueError('Unknown game')
        if action == 'install':
            install(Path.cwd(), game, dict(os.environ))
        elif action == 'run':
            sys.exit(run(Path.cwd(), game, dict(os.environ)))
        else:
            raise ValueError('Unknown action')
    except (ValueError, OSError, KeyError, ET.ParseError, subprocess.SubprocessError):
        print('Engineering server setup failed: review original config/allocations, legitimate supplied files, private Steam restriction and explicit Windows runtime license prerequisite.', file=sys.stderr)
        sys.exit(1)
