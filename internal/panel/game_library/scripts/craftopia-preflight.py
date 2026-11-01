#!/usr/bin/env python3
"""Craftopia-only pure preflight before shared acquisition/publication."""
import os
from pathlib import Path
import re
import signal
import sys


def checked_path(shared, root, relative):
    target = shared.confined(root, relative)
    current = root
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Craftopia managed paths cannot use symbolic links')
    return target


def managed_identities(previous):
    expected = {'GameWorld': {'name'}, 'Host': {'port'}, 'Save': {'savePath'}}
    folded = {section.casefold(): section for section in expected}
    sections, seen = set(), set()
    active = None
    for line in previous.decode('utf-8-sig').splitlines():
        text = line.strip()
        if text.startswith((';', '#')):
            continue
        header = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', text)
        if header:
            active = header.group(1)
            canonical = folded.get(active.casefold())
            if canonical is not None:
                if canonical != active or canonical in sections:
                    raise ValueError('Ambiguous Craftopia managed INI section')
                sections.add(canonical)
            continue
        if active in expected and '=' in line:
            key = line.split('=', 1)[0].strip()
            canonical = next((candidate for candidate in expected[active] if candidate.casefold() == key.casefold()), None)
            if canonical is not None:
                if key != canonical or (active, key) in seen:
                    raise ValueError('Ambiguous Craftopia managed INI setting')
                seen.add((active, key))


def plan(shared, root, environment, require_files=True):
    root = Path(root).resolve()
    kind, _, _, binary_name, _ = shared.selection(environment)
    if kind != 'craftopia':
        raise ValueError('This entrypoint supports the Craftopia recipe only')
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Automatic updates must be 0 or 1')
    name = shared.text(environment.get('WORLD_NAME', 'Pterodactyl Server'), 50)
    primary = shared.integer(environment, 'SERVER_PORT', 8050, 1025, 65535)
    raw = environment.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'\d+(?:,\d+)*', raw):
        raise ValueError('Choose allocated Craftopia ports')
    ports = {int(port) for port in raw.split(',')}
    if primary not in ports or any(not 1 <= port <= 65535 for port in ports):
        raise ValueError('Craftopia gameplay port must be allocated')
    binary = checked_path(shared, root, binary_name)
    target = checked_path(shared, root, 'ServerSetting.ini')
    for file in (binary, target):
        if file.exists() and not file.is_file():
            raise ValueError('Craftopia payload/config must be regular files')
    if require_files and (not binary.is_file() or not target.is_file()):
        raise ValueError('Install the original Craftopia executable and configuration')
    for relative in ('.voltra/crafting/config-backups', '.config/unity3d/PocketPair/Craftopia/Logs_DS'):
        directory = checked_path(shared, root, relative)
        for parent in (directory, *directory.parents):
            if parent == root:
                break
            if parent.exists() and not parent.is_dir():
                raise ValueError('Craftopia managed log/backup parents must be directories')
    previous = shared.read_config(root, 'ServerSetting.ini')
    planned = None
    if target.exists():
        managed_identities(previous)
        planned = shared.craftopia_document(root, previous, name, primary)
    credentials = []
    active = None
    for line in previous.decode('utf-8-sig').splitlines():
        text = line.strip()
        if text.startswith((';', '#')):
            continue
        header = re.fullmatch(r'\[([^\]]+)\]\s*(?:[;#].*)?', text)
        if header:
            active = header.group(1).casefold()
        elif active == 'host' and '=' in line:
            key, value = line.split('=', 1)
            if key.strip().casefold() == 'serverpassword':
                value = value.strip()
                credentials.extend(candidate for candidate in (value, value.strip('"\'')) if candidate)
    return {'root': root, 'previous': previous, 'planned': planned, 'automatic': automatic,
            'credentials': list(dict.fromkeys(credentials))}


def main(root=None, environment=None, shared=None, relay_factory=None):
    if shared is None:
        import crafting_runtime as shared
    if relay_factory is None:
        from native_log import NativeLogRelay
        relay_factory = NativeLogRelay
    root = Path.cwd().resolve() if root is None else Path(root).resolve()
    environment = dict(os.environ if environment is None else environment)
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0'))
    plan(shared, root, environment, require_files=automatic != '1')
    if automatic == '1':
        shared.install(root, environment, validate=False)
    prepared = plan(shared, root, environment, require_files=True)
    argv, child, credentials, ready, stop = shared.configure(root, environment)
    credentials = list(dict.fromkeys([*credentials, *prepared['credentials']]))
    relay = relay_factory(root, relative_directory='.config/unity3d/PocketPair/Craftopia/Logs_DS',
                          prefix='PlayerLog_', suffix='.log', credentials=credentials)
    relay.start()
    try:
        return shared.run(root, argv, child, stop, credentials=credentials,
                          ready_marker=ready, terminal_input=True, stop_signal=signal.SIGINT)
    finally:
        relay.finish()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, KeyError):
        print('Craftopia setup failed. Review native configuration, allocations and update prerequisites.', file=sys.stderr)
        sys.exit(1)
