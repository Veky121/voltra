#!/usr/bin/env python3
"""Core Keeper native-file authority bridge. Proposed source, not activated."""
import json
import os
from pathlib import Path
import stat


DOCUMENT = 'CoreKeeperSaves/ServerConfig.json'
FIELDS = {
    'world': ('WORLD_INDEX', int, 0, 29),
    'worldName': ('WORLD_NAME', str, None, None),
    'worldSeed': ('WORLD_SEED', int, 0, 4294967295),
    'hashedWorldSeed': ('HASHED_WORLD_SEED', int, 0, 4294967295),
    'maxNumberPlayers': ('MAX_PLAYERS', int, 1, 100),
    'gameId': ('GAME_ID', str, None, None),
    'password': ('SERVER_PASSWORD', str, None, None),
}


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate Core Keeper JSON key')
        result[key] = value
    return result


def effective_environment(root, environment):
    """Read existing native values without changing any operator bytes."""
    root = Path(root).resolve()
    current = root
    for part in Path(DOCUMENT).parts:
        current = current / part
        try:
            metadata = current.lstat()
        except FileNotFoundError:
            return dict(environment)
        if stat.S_ISLNK(metadata.st_mode):
            raise ValueError('Core Keeper native settings cannot use symlinks')
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 1024 * 1024:
        raise ValueError('Core Keeper native settings must be a bounded regular file')
    data = json.loads(current.read_text(encoding='utf-8-sig'), object_pairs_hook=unique_object,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite native JSON')))
    if not isinstance(data, dict):
        raise ValueError('Core Keeper native settings must be an object')
    result = dict(environment)
    for key, (target, kind, low, high) in FIELDS.items():
        if key not in data:
            continue
        value = data[key]
        if type(value) is not kind or kind is int and not low <= value <= high:
            raise ValueError('Invalid Core Keeper native field: ' + key)
        if kind is str and (any(ord(c) < 32 or ord(c) == 127 for c in value) or len(value.encode()) > (400 if key == 'worldName' else 28)):
            raise ValueError('Invalid Core Keeper native field: ' + key)
        result[target] = str(value)
    if 'worldMode' in data:
        mode = data['worldMode']
        if type(mode) not in (int, str) or str(mode) not in ('0', '1', 'Normal', 'Hard', 'Creative', 'Casual'):
            raise ValueError('Unsupported Core Keeper native world mode')
        result['WORLD_MODE'] = str(mode)
    return result


def main():
    import core_keeper_runtime as native
    root = Path.cwd().resolve()
    environment = effective_environment(root, dict(os.environ))
    if environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0')) == '1':
        native.update(root, 1963720, required=('CoreKeeperServer',))
    argv, child_environment, credentials = native.configure(root, environment)
    return native.run(root, argv, child_environment, [*credentials, *[
        environment.get(key, '') for key in ('STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]])


if __name__ == '__main__':
    raise SystemExit(main())
