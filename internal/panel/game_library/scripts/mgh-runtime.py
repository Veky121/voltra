#!/usr/bin/env python3
"""MGH-only authority and preflight adapter. Shared family remains unchanged."""
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).parent))
import importlib.util
_path = Path(__file__).with_name('ghost_love_renown.py')
if not _path.exists():
    _path = _path.with_name('ghost-love-renown.py')
_spec = importlib.util.spec_from_file_location('mgh_family', _path)
family = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(family)


def reconcile_ini(data, ports):
    """Change only existing Unreal listener keys; never seed undocumented MGH keys.

    Bytes outside managed scalar values, including BOM, comments and CRLF, survive.
    Duplicate managed keys/sections fail closed before any file is published.
    """
    text = data.decode('utf-8-sig')
    roles = {('url', 'port'): 'SERVER_PORT',
             ('onlinesubsystemsteam', 'gameserverqueryport'): 'QUERY_PORT',
             ('/script/onlinesubsystemutils.onlinebeaconhost', 'listenport'): 'BEACON_PORT'}
    section = ''
    sections, keys, output = set(), set(), []
    for line in text.splitlines(keepends=True):
        header = re.fullmatch(r'\s*\[([^\]\r\n]+)\][ \t]*(?:[;#][^\r\n]*)?(?:\r?\n)?', line)
        if header:
            section = header[1].casefold()
            if section in {key[0] for key in roles}:
                if section in sections:
                    raise ValueError('Duplicate managed MGH INI section')
                sections.add(section)
        match = re.fullmatch(r'([ \t]*)([^=\r\n]+?)([ \t]*=[ \t]*)([^\r\n]*)(\r?\n)?', line)
        if match:
            key = (section, match[2].strip().casefold())
            if key in roles:
                if key in keys:
                    raise ValueError('Duplicate managed MGH INI key')
                keys.add(key)
                scalar = re.fullmatch(r'[0-9]+([ \t]*(?:[;#].*)?)', match[4])
                if not scalar:
                    raise ValueError('Ambiguous managed MGH listener value')
                line = ''.join(match.group(i) for i in (1, 2, 3)) + str(ports[roles[key]]) + scalar[1] + (match[5] or '')
        output.append(line)
    return (b'\xef\xbb\xbf' if data.startswith(b'\xef\xbb\xbf') else b'') + ''.join(output).encode('utf-8')


def preflight(root, env):
    family.options(root, 'ghost', env)
    selected = family.plan(root, 'ghost', env)
    # Unreal accepts alternate config/identity options that bypass simple -port checks.
    for arg in family.extras(env):
        flag = arg.lstrip('-').split('=', 1)[0].casefold()
        if ':' in flag or flag in {'ini', 'engineini', 'gameini', 'defengineini',
                                   'defgameini', 'userdir', 'savedir', 'basedir',
                                   'epicapp', 'epicenv', 'epicportal', 'steamappid',
                                   'exec', 'execcmds'}:
            raise ValueError('Additional MGH option overrides managed config or identity')
    updates = []
    for name in ('Engine.ini',):
        path = family.confined(root, 'MidnightGhostHunt/Saved/Config/WindowsServer/' + name)
        if path.exists():
            before = path.read_bytes()
            after = reconcile_ini(before, selected['ports'])
            if after != before:
                updates.append((path, after))
    return selected, updates


def install(root, env):
    # The family protects configuration extensions. MGH additionally retains
    # binary saves and operator mod payloads, including on later SDK failure.
    protected = []
    for name in ('MidnightGhostHunt/Saved', 'MidnightGhostHunt/Content/Mods', 'Mods'):
        path = family.confined(root, name)
        if path.exists():
            if not path.is_dir() or any(item.is_symlink() for item in path.rglob('*')):
                raise ValueError('MGH protected data contains an unsupported link or file')
            protected.append((name, path))
    with tempfile.TemporaryDirectory(prefix='mgh-retain-') as directory:
        snapshots = []
        for index, (name, path) in enumerate(protected):
            backup = Path(directory) / str(index)
            shutil.copytree(path, backup, copy_function=shutil.copy2)
            snapshots.append((name, backup))
        try:
            family.install(root, 'ghost', env)
        finally:
            for name, backup in snapshots:
                target = family.confined(root, name)
                # Re-check every destination after the updater, before copying.
                for item in backup.rglob('*'):
                    family.confined(root, str(Path(name) / item.relative_to(backup)))
                shutil.copytree(backup, target, dirs_exist_ok=True, copy_function=shutil.copy2)


def execute(root, env, action):
    if action not in ('run', 'install'):
        raise ValueError('Unknown MGH action')
    selected, updates = preflight(root, env)
    if action == 'install' or family.boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        install(root, env)
        selected, updates = preflight(root, env)
    if action == 'install':
        return 0
    for path, data in updates:
        # Shared atomic publisher preserves existing operator permissions.
        mode = path.stat().st_mode & 0o777
        family.steam._publish(root, str(path.relative_to(root)), lambda out, data=data: out.write(data), mode)
    return family.run(root, 'ghost', selected, family.environment(root, 'ghost', env))


if __name__ == '__main__':
    try:
        sys.exit(execute(Path.cwd().resolve(), dict(os.environ), sys.argv[1]))
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'MGH operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
