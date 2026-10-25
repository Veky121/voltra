#!/usr/bin/env python3
"""MIT. Native Linux Tower/Pavlov/OHD controls and exact operator-state retention."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import urllib.request


def helper(name):
    path = Path(__file__).with_name(name + '.py')
    if not path.exists():
        path = path.with_name(name.replace('_', '-') + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec);sys.modules[name] = module;spec.loader.exec_module(module)
    return module


common = helper('ark_family')
native, steam = common.native, common.steam
sys.modules['steam_template'] = steam
console = helper('native_console')
text, integer, boolean, confined = common.text, common.integer, common.boolean, common.confined
GAMES = {'tower': (439660, 'Tower', 'Tower/Binaries/Linux/TowerServer-Linux-Shipping'),
         'pavlov': (622970, 'Pavlov', 'Pavlov/Binaries/Linux/PavlovServer-Linux-Shipping'),
         'ohd': (950900, 'HarshDoorstop', 'HarshDoorstop/Binaries/Linux/HarshDoorstopServer-Linux-Shipping')}
TOWER_SECTION = '/Script/TowerNetworking.DedicatedServerOptions'


def pavlov_libraries(root, build=False):
    """Private Bookworm closure, never overwrite publisher libraries or glibc."""
    if Path('/etc/debian_version').read_text().strip().split('.')[0] != '12':
        raise ValueError('Pavlov private libraries require the pinned Debian12 runtime/installer ABI')
    relative = '.voltra/pavlov-libraries'
    directory = confined(root, relative)
    receipt = confined(root, relative + '/receipt.json')
    if build:
        sources = [Path('/usr/lib/x86_64-linux-gnu') / name for name in ('libc++.so.1','libc++abi.so.1','libunwind.so.1','libatomic.so.1')]
        dependencies = set(sources)
        for source in sources:
            if not source.is_file():
                raise ValueError('Missing Debian Pavlov libc++/libc++abi/libunwind/libatomic package')
            result = subprocess.run(['ldd', str(source)],capture_output=True,text=True,check=True)
            if 'not found' in result.stdout:
                raise ValueError('Missing Pavlov private library dependency')
            dependencies.update(Path(name) for name in re.findall(r'=>\s+(/[^\s]+)',result.stdout))
        records = {}
        glibc = ('libc.so.','libm.so.','libdl.so.','libpthread.so.','librt.so.','libresolv.so.','libutil.so.')
        for source in sorted(dependencies):
            if source.name.startswith(glibc):
                continue
            payload = source.read_bytes();name = relative + '/' + source.name
            steam._publish(root,name,lambda output,data=payload: output.write(data),0o644)
            records[source.name] = hashlib.sha256(payload).hexdigest()
        packages = subprocess.check_output(['dpkg-query','-W','-f=${binary:Package}\t${Version}\n'],text=True)
        steam._publish(root,relative+'/packages.txt',lambda output:output.write(packages.encode()),0o644)
        for source in Path('/usr/share/doc').glob('*/copyright'):
            data=source.read_bytes()
            steam._publish(root,relative+'/licenses/'+source.parent.name.replace(':','_')+'.copyright',lambda output,data=data:output.write(data),0o644)
        data=json.dumps({'debian_major':12,'files':records,'packages_sha256':hashlib.sha256(packages.encode()).hexdigest()},sort_keys=True).encode()
        steam._publish(root,relative+'/receipt.json',lambda output:output.write(data),0o644)
    if not receipt.is_file():
        raise ValueError('Install the private Pavlov Debian12 dependency closure before starting')
    record=json.loads(receipt.read_text())
    if record.get('debian_major') != 12 or not record.get('files'):
        raise ValueError('Invalid Pavlov private dependency receipt')
    for name,digest in record['files'].items():
        if not re.fullmatch(r'[A-Za-z0-9_.+-]+',name) or hashlib.sha256(confined(root,relative+'/'+name).read_bytes()).hexdigest()!=digest:
            raise ValueError('Pavlov private library checksum mismatch; reinstall required')
    return str(directory)


def existing_tower_file(root):
    path = confined(root, 'Tower/Saved/Config/TowerServer.ini')
    if not path.exists():
        return ''
    section = ''
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        header = re.match(r'^\s*\[([^\]]+)\]', line)
        if header:
            section = header[1].casefold()
        elif section == 'dedicatedcondooptions':
            match = re.match(r'^\s*CondoFile\s*=\s*(.*?)\s*$', line, re.I)
            if match:
                return match[1].strip('"')
    return ''


def secret(env, key, limit):
    value = text(env, key, '', limit)
    if not value or set(value) == {'0'} or value.upper() in ('CHANGE_ME', 'REPLACE_ME', 'ABC123FALSEKEYDONTUSEME'):
        raise ValueError('Supply your actual private ' + key + '; no credential is created or substituted')
    return value


def quoted(value):
    if '"' in value or '\\' in value:
        raise ValueError('Native Unreal quoted values cannot contain quotes or backslashes')
    return '"' + value + '"'


def ports(env, game):
    primary = integer(env, 'SERVER_PORT', 7777)
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch('[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Missing native allocated ports')
    available = {int(value) for value in raw.split(',')}
    if any(not 1 <= value <= 65535 for value in available) or primary not in available:
        raise ValueError('Invalid native allocations')
    offset = 400 if game == 'pavlov' else 1
    peer = primary + offset
    if peer > 65535 or peer not in available:
        raise ValueError('This native server requires game port plus' + str(offset) + ' on the same address')
    used = {primary, peer}
    result = {'SERVER_PORT': primary}
    roles = ('RCON_PORT',) if game == 'pavlov' else ('QUERY_PORT', 'RCON_PORT') if game == 'ohd' else ('QUERY_PORT',)
    for key in roles:
        default = 8188 if game == 'pavlov' else 27005 if key == 'QUERY_PORT' and game == 'ohd' else 7779 if game == 'ohd' else 27015
        value = integer(env, key, default)
        if value not in available or value in used:
            raise ValueError('Native query/RCON needs a distinct selected allocation')
        used.add(value);result[key] = value
    return result


def plan(root, game, env):
    selected = ports(env, game)
    result = {'binary': confined(root, GAMES[game][2]), 'configs': {}, 'credentials': [], 'ports': selected}
    if game == 'tower':
        steam_token = secret(env, 'STEAM_LOGIN_TOKEN', 100)
        admin = text(env, 'STEAM_ADMIN_ID', '', 17)
        if not re.fullmatch('[0-9]{17}', admin) or not 76561197960265728 <= int(admin) <= 76561202255233023:
            raise ValueError('STEAM_ADMIN_ID needs your actual SteamID64; no administrator account is fabricated')
        mode = text(env, 'TOWER_MODE', 'legacy', 16)
        if mode not in ('legacy', 'condo'):
            raise ValueError('Unknown Tower mode')
        values = {'MaxPlayers': str(integer(env, 'SERVER_MAX_PLAYER', 40, 1, 512)),
                  'ServerTitle': text(env, 'SERVER_TITLE', 'Tower Unite Server', 512), 'SteamLoginToken': steam_token}
        result['credentials'].append(steam_token)
        args = ['-log', '-Port=' + str(selected['SERVER_PORT']), '-MULTIHOME=0.0.0.0',
                '-TowerServerINI=../../Saved/Config/TowerServer.ini', '-QueryPort=' + str(selected['QUERY_PORT'])]
        sections = {TOWER_SECTION: values}
        if mode == 'condo':
            token = secret(env, 'TOWER_LOGIN_TOKEN', 100)
            game_map = text(env, 'CONDO_MAP', '/Game/Maps/C_Condo', 128)
            if not re.fullmatch('/Game/Maps/C_[A-Za-z0-9_]+', game_map):
                raise ValueError('Choose a publisher Tower condo map path')
            filename = text(env, 'CONDO_FILE', '', 100) or existing_tower_file(root)
            if filename and (filename in ('.', '..') or filename.endswith('.map') or not re.fullmatch('[A-Za-z0-9_. -]+', filename)):
                raise ValueError('CondoFile is a native basename without the .map extension')
            map_name = game_map.rsplit('/', 1)[1]
            data = confined(root, 'Tower/Condos/' + map_name + '/' + (filename or map_name) + '.map')
            if not data.is_file():
                raise ValueError('Export and upload your own condo .map to the selected Tower/Condos map folder before starting condo mode')
            values['TowerLoginToken'] = token;result['credentials'].append(token)
            sections['DedicatedCondoOptions'] = {'CondoAutoSave': str(boolean(env, 'CONDO_AUTO_SAVE', True)),
                                                'CondoBackupsEnabled': str(boolean(env, 'CONDO_BACKUPS', True))}
            if filename:
                sections['DedicatedCondoOptions']['CondoFile'] = filename
            args = [game_map, *args, '-nosteamclient']
        result.update(args=args, configs={'Tower/Saved/Config/TowerServer.ini': sections}, admin=admin,
                      ready=b'Match State Changed from EnteringMap to WaitingToStart')
    elif game == 'pavlov':
        api = secret(env, 'API_KEY', 64)
        password = secret(env, 'RCON_PASSWORD', 20)
        result['credentials'] += [api, password]
        result.update(args=['Pavlov', '-PORT=' + str(selected['SERVER_PORT']), '-KEY=' + quoted(api)],
                      configs={'Pavlov/Saved/Config/LinuxServer/Game.ini': {'/Script/Pavlov.DedicatedServer': {'ApiKey': quoted(api)}}},
                      flat_config=('Pavlov/Saved/Config/RconSettings.txt', {'Password': password, 'Port': str(selected['RCON_PORT'])}),
                      ready=b'Starting Server Status Helper on Port')
    else:
        password = secret(env, 'RCON_PASSWORD', 32)
        name = text(env, 'SERVER_NAME', 'Harsh Doorstop Dedicated Server', 200)
        maximum = integer(env, 'MAX_PLAYERS', 32, 1, 2147483647)
        attempts = integer(env, 'RCON_MAX_AUTH_ATTEMPTS', 3, 1, 2147483647)
        connections = integer(env, 'RCON_MAX_CONNECTIONS', 5, 1, 2147483647)
        result['credentials'].append(password)
        result.update(args=['HarshDoorstop', 'AAS-TestMap?MaxPlayers=' + str(maximum), '-SteamServerName=' + quoted(name),
                    '-Port=' + str(selected['SERVER_PORT']), '-MULTIHOME=0.0.0.0', '-QueryPort=' + str(selected['QUERY_PORT']),
                    '-RCONPort=' + str(selected['RCON_PORT']), '-EnableRCON', '-RCONMaxAuthAttempts=' + str(attempts),
                    '-RCONPassword=' + quoted(password), '-RCONMaxActiveConnections=' + str(connections),
                    '-stdout', '-forcelogflush'],
                    configs={'HarshDoorstop/Saved/Config/LinuxServer/Game.ini': {
                        '/Script/RCON.RCONServerSystem': {'bEnabled': 'True', 'ListenPort': str(selected['RCON_PORT']), 'Password': quoted(password),
                                                       'MaxActiveConnections': str(connections), 'MaxAuthAttempts': str(attempts)},
                        '/Script/Engine.GameSession': {'MaxPlayers': str(maximum), 'ServerName': quoted(name)}}},
                    ready=b'LogRCON: RCON server listening on')
    result['credentials'] += [env.get(key, '') for key in ('STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    return result


def canonical_sections(content, sections):
    canonical = {key.casefold(): key for key in sections}
    seen = set();output = []
    for line in content.splitlines(keepends=True):
        match = re.fullmatch(r'(\s*)\[([^\]]+)\](.*?)(\r?\n)?', line)
        if match and match[2].casefold() in canonical:
            key = canonical[match[2].casefold()]
            if key in seen:
                raise ValueError('Duplicate managed native INI section')
            seen.add(key);line = match[1] + '[' + key + ']' + match[3] + (match[4] or '')
        output.append(line)
    return ''.join(output)


def tower_admin(content, value):
    # Tower supports repeated admin entries. Update only the original primary
    # owner setting and retain additional real administrators and comments.
    section = None;found = False;output = []
    for line in content.splitlines(keepends=True):
        header = re.match(r'^\s*\[([^\]]+)\]', line)
        if header:
            if section == 'administration' and not found:
                output.append('AdminSteamID=' + value + '\n');found = True
            section = header[1].casefold()
        elif section == 'administration' and re.match(r'^\s*AdminSteamID\s*=', line, re.I) and not found:
            line = 'AdminSteamID=' + value + '\n';found = True
        output.append(line)
    if section == 'administration' and not found:
        if output and not output[-1].endswith('\n'):
            output[-1] += '\n'
        output.append('AdminSteamID=' + value + '\n');found = True
    result = ''.join(output)
    if not found:
        result += ('\n' if result and not result.endswith('\n') else '') + '[Administration]\nAdminSteamID=' + value + '\n'
    return result


def flat_config(content, values):
    output = [];seen = set()
    for line in content.splitlines(keepends=True):
        match = re.match(r'^\s*([A-Za-z0-9_]+)\s*=', line)
        if match and match[1] in values:
            if match[1] in seen:
                raise ValueError('Duplicate managed native text setting')
            seen.add(match[1]);line = match[1] + '=' + values[match[1]] + '\n'
        output.append(line)
    result = ''.join(output)
    if result and not result.endswith('\n'):
        result += '\n'
    return result + ''.join(key + '=' + value + '\n' for key, value in values.items() if key not in seen)


def configure(root, game, env):
    selected = plan(root, game, env)
    for name, sections in selected['configs'].items():
        path = confined(root, name)
        before = path.read_text(encoding='utf-8-sig') if path.exists() else ''
        for match in re.finditer(r'(?mi)^\s*(?:\w*(?:Token|Password)|ApiKey)\s*=\s*([^\r\n]+)', before):
            selected['credentials'] += [match[1], match[1].strip('"')]
        after = native.patch_ini(canonical_sections(before, sections), sections)
        if game == 'tower':
            after = tower_admin(after, selected['admin'])
        if after != before:
            native.private_write(path, after)
        else:
            path.chmod(0o600)
    if game == 'pavlov':
        name, values = selected['flat_config'];path = confined(root, name)
        before = path.read_text() if path.exists() else ''
        selected['credentials'] += re.findall(r'(?mi)^\s*Password\s*=\s*([^\r\n]+)',before)
        native.private_write(path, flat_config(before, values))
    return selected


def seed_pavlov(root):
    records = json.loads(Path(__file__).with_name('vr-tower-ohd-releases.json').read_text())
    for name, relative in [('Game.ini', 'Pavlov/Saved/Config/LinuxServer/Game.ini'), ('RconSettings.txt', 'Pavlov/Saved/Config/RconSettings.txt')]:
        path = confined(root, relative)
        if path.exists():
            continue
        record = records[name]
        with urllib.request.urlopen(record['url'], timeout=30) as response:
            data = response.read(1048577)
        if len(data) > 1048576 or hashlib.sha256(data).hexdigest() != record['sha256']:
            raise ValueError('Pinned original Pavlov config failed checksum validation')
        native.private_write(path, data.decode('utf-8'))


def steam_options(root, game, env):
    app, folder, binary = GAMES[game]
    if integer(env, 'SRCDS_APPID', app, 1, 2147483647) != app or boolean(env, 'WINDOWS_INSTALL'):
        raise ValueError('This exact recipe requires its native Linux dedicated Steam tool')
    options = {key: env.get(key, '') for key in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAID', 'SRCDS_BETAPASS', 'INSTALL_FLAGS')}
    if game == 'pavlov' and options['SRCDS_BETAID'] not in ('', 'beta_server'):
        raise ValueError('Original Pavlov branch choices are public or beta_server')
    steam.arguments(root, app, options, platform='linux', force_platform=True)
    return app, folder, binary, options


def install(root, game, env):
    app, folder, binary, options = steam_options(root, game, env)
    saved = confined(root, folder + '/Saved')
    protected = [path for path in saved.rglob('*') if path.is_file() and path.suffix.lower() in ('.ini', '.cfg', '.txt')] if saved.exists() else []
    with tempfile.TemporaryDirectory(prefix='voltra-native-retention-') as directory:
        backups = []
        for index, path in enumerate(protected):
            path = confined(root, str(path.relative_to(root)));backup = Path(directory) / str(index)
            shutil.copy2(path, backup);backups.append((path.relative_to(root), backup))
        try:
            steam.update(root, app, options, validate=True, required=(binary,), platform='linux', force_platform=True)
        finally:
            for name, backup in backups:
                target = confined(root, str(name));target.parent.mkdir(parents=True, exist_ok=True);shutil.copy2(backup, target)
    if game == 'pavlov':
        seed_pavlov(root)
        for name in ('Pavlov/Saved/Logs', 'Pavlov/Saved/maps'):
            confined(root, name).mkdir(parents=True, exist_ok=True)
        # Keep the original publisher wrapper script; there is no reason to delete it.
    if game == 'tower':
        source = confined(root, '.steam/sdk64/steamclient.so')
        if not source.is_file():
            raise ValueError('Validated Steam SDK64 is required beside the Tower server binary')
        def copy(output):
            with source.open('rb') as data:
                shutil.copyfileobj(data, output)
        steam._publish(root, 'Tower/Binaries/Linux/steamclient.so', copy, 0o644)


def main():
    action, game = sys.argv[1:]
    if action == 'bundle-libraries' and game == 'pavlov':
        pavlov_libraries(Path.cwd().resolve(),build=True);return 0
    if action not in ('install', 'run') or game not in GAMES:
        raise ValueError('Unknown Tower/Pavlov/OHD recipe action')
    root = Path.cwd().resolve();env = dict(os.environ)
    if action == 'install':
        install(root, game, env);return 0
    plan(root, game, env)
    if game == 'pavlov':
        pavlov_libraries(root)
    if boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        install(root, game, env)
    selected = configure(root, game, env)
    child_env = {key: value for key, value in env.items() if key not in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH')
                 and not any(word in key for word in ('PASSWORD', 'TOKEN', 'API_KEY', 'STEAM_PASS', 'STEAM_AUTH', 'BETAPASS'))}
    child_env['HOME'] = str(root)
    if game == 'pavlov':
        child_env['LD_LIBRARY_PATH'] = pavlov_libraries(root)
    return console.run(root, [str(selected['binary']), *selected['args']], child_env, '',
                       credentials=selected['credentials'], ready_marker=selected['ready'], stop_signal=signal.SIGINT)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Tower/Pavlov/OHD operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
