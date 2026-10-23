#!/usr/bin/env python3
"""Read-only native evidence from one game mount and its PID namespace."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import xml.etree.ElementTree as ET


def native_ini(data, selected):
    section = ''
    result = {}
    for line in data.decode('utf-8-sig').splitlines():
        line = line.strip()
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
        elif '=' in line and not line.startswith((';', '#')):
            key, value = line.split('=', 1)
            if key.strip() in selected.get(section, ()):
                result.setdefault(section, {}).setdefault(key.strip(), []).append(value.strip())
    return result


def console_package(root, expected=None):
    binary = root/'.voltra/console-client'
    if not binary.exists():
        return {'installed': False}
    report = {'installed': True, 'files': {}}
    for name in ('.voltra', '.voltra/console-client', '.voltra/console-client.manifest.json',
                 '.voltra/console-client.LICENSE', '.voltra/sevendays-console.yaml', 'serverconfig.xml'):
        path = root/name
        metadata = path.lstat()
        if not (stat.S_ISREG(metadata.st_mode) or name == '.voltra' and stat.S_ISDIR(metadata.st_mode)):
            raise ValueError('Regular private package paths required')
        report['files'][name] = {'mode': stat.S_IMODE(metadata.st_mode), 'uid': metadata.st_uid, 'gid': metadata.st_gid}
    report['sha256'] = hashlib.sha256(binary.read_bytes()).hexdigest()
    if expected and expected.get('console_sha256'):
        report['matches_reviewed_artifact'] = report['sha256'] == expected['console_sha256']
    return report


def config(root, game, expected=None):
    if game == '7days':
        document = ET.fromstring((root/'serverconfig.xml').read_bytes())
        allowed = {'ServerName', 'ServerPort', 'ServerMaxPlayerCount', 'GameDifficulty',
                   'ServerDisabledNetworkProtocols', 'TelnetEnabled', 'TelnetPort',
                   'GameWorld', 'GameName', 'WorldGenSeed', 'WorldGenSize'}
        values = {}
        for element in document.findall('property'):
            name, value = element.get('name'), element.get('value')
            if name in allowed:
                values.setdefault(name, []).append(value)
            if name == 'TelnetPassword':
                values['TelnetPassword_configured'] = bool(value)
                if expected is not None:
                    values['expected_console_matches_native_xml'] = value == expected.get('console_password')
        if expected is not None:
            client = json.loads((root/'.voltra/sevendays-console.yaml').read_text())
            values['expected_console_matches_client_config'] = client.get('default', {}).get('password', '') == expected.get('console_password')
        return values
    directory = root/'FactoryGame/Saved/Config/LinuxServer'
    result = {}
    for name, selected in {
        'Game.ini': {'/Script/Engine.GameSession': {'MaxPlayers'}},
        'Engine.ini': {'/Script/FactoryGame.FGSaveSession': {'mNumRotatingAutosaves'},
                       '/Script/OnlineSubsystemUtils.IpNetDriver': {'InitialConnectTimeout', 'ConnectionTimeout'}},
    }.items():
        file = directory/name
        # The publisher can remove Game.ini on clean shutdown. Preserve that
        # absence as evidence instead of preventing all remaining inspection.
        result[name] = native_ini(file.read_bytes(), selected) if file.exists() else {'missing': True}
    return result


def snapshot(root, game):
    protected = ['serverconfig.xml', 'saves', '.voltra'] if game == '7days' else ['FactoryGame/Saved', '.config/Epic/FactoryGame/Saved']
    result = {}
    for name in protected:
        base = root/name
        if base.is_symlink():
            raise ValueError('Protected native root is a symlink')
        if not base.exists():
            continue
        files = [base] if base.is_file() else base.rglob('*')
        for file in files:
            info = file.lstat()
            if stat.S_ISLNK(info.st_mode) or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)):
                raise ValueError('Protected native path contains a link or special file')
            if file.is_dir():
                continue
            digest = hashlib.sha256()
            with file.open('rb') as source:
                for block in iter(lambda: source.read(1048576), b''):
                    digest.update(block)
            result[file.relative_to(root).as_posix()] = {'sha256': digest.hexdigest(), 'size': info.st_size,
                'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
            if len(result) > 100000:
                raise ValueError('Native protected snapshot exceeds file limit')
    return result


def processes():
    result, owners = [], {}
    for directory in Path('/proc').iterdir():
        if not directory.name.isdigit() or int(directory.name) == os.getpid():
            continue
        try:
            arguments = (directory/'cmdline').read_bytes().decode('utf-8', errors='replace').strip('\0').split('\0')
            if not arguments or not arguments[0]:
                continue
            environment = dict(pair.split('=', 1) for pair in (directory/'environ').read_bytes().decode('utf-8', errors='replace').split('\0') if '=' in pair)
            selected = {key: environment[key] for key in ('LD_LIBRARY_PATH', 'AUTO_UPDATE', 'VALIDATE', 'USER', 'HOME') if key in environment}
            result.append({'pid': int(directory.name), 'argv': arguments, 'environment': selected,
                'forbidden_environment_keys': [key for key in ('PASSWORD', 'SRCDS_BETAPASS', 'STEAM_PASS', 'STEAM_AUTH') if key in environment]})
            for descriptor in (directory/'fd').iterdir():
                try:
                    link = descriptor.readlink().as_posix()
                    if link.startswith('socket:['):
                        owners.setdefault(link[8:-1], []).append(int(directory.name))
                except (PermissionError, FileNotFoundError):
                    pass
        except (PermissionError, FileNotFoundError, ProcessLookupError):
            pass
    sockets = []
    # PID1 is the owned game namespace's init; the helper itself deliberately
    # has no network. Read PID1's network tables rather than the helper's.
    for protocol in ('tcp', 'tcp6', 'udp', 'udp6'):
        for line in (Path('/proc/1/net')/protocol).read_text().splitlines()[1:]:
            fields = line.split()
            if len(fields) > 9 and fields[9] in owners:
                address, port = fields[1].rsplit(':', 1)
                sockets.append({'protocol': protocol, 'address_hex': address, 'port': int(port, 16), 'state_hex': fields[3], 'pids': sorted(set(owners[fields[9]]))})
    return {'processes': result, 'sockets': sockets}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--game', required=True, choices=('7days', 'satisfactory'))
    parser.add_argument('--snapshot', action='store_true')
    parser.add_argument('--expected-stdin', action='store_true')
    args = parser.parse_args()
    root = Path('/game')
    expected = json.loads(sys.stdin.read(16384)) if args.expected_stdin else None
    result = {'game': args.game, 'configuration': config(root, args.game, expected)}
    if args.game == '7days':
        result['native_console_package'] = console_package(root, expected)
    if args.snapshot:
        result['protected_files'] = snapshot(root, args.game)
    else:
        result.update(processes())
    print(json.dumps(result, ensure_ascii=False))
