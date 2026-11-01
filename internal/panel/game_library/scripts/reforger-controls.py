#!/usr/bin/env python3
"""MIT. Reforger file authority, seeded defaults and confined native listeners."""
import copy
import json
import sys
from pathlib import Path
import importlib.util

spec = importlib.util.spec_from_file_location('reforger_arma', Path(__file__).with_name('arma-native.py'))
arma = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arma)
base_config = arma.reforger_config
base_configure = arma.configure
base_boolean = arma.boolean


def merge_missing(target, defaults):
    for key, value in defaults.items():
        if key not in target:
            target[key] = copy.deepcopy(value)
        elif isinstance(value, dict) and isinstance(target[key], dict):
            merge_missing(target[key], value)


def configuration(previous, env):
    # Existing native values win over startup defaults, including false/empty values.
    result = copy.deepcopy(previous)
    if not isinstance(result, dict):
        raise ValueError('Reforger config must be an object')
    seed = base_config({}, env)
    merge_missing(result, seed)
    game = result['game']
    if not isinstance(game, dict) or not isinstance(game.get('gameProperties'), dict):
        raise ValueError('Invalid Reforger native game object')
    effective = dict(env)
    fields = {'SERVER_NAME': 'name', 'SERVER_PASS': 'password', 'ADMIN_PASS': 'passwordAdmin',
              'SCENARIO_ID': 'scenarioId', 'MAX_PLAYERS': 'maxPlayers', 'VISIBLE': 'visible'}
    for variable, key in fields.items():
        value = game[key]
        expected = type(seed['game'][key])
        if type(value) is not expected:
            raise ValueError('Invalid native Reforger field: ' + key)
        effective[variable] = str(value).lower() if isinstance(value, bool) else str(value)
    for variable, key in [('BATTLEYE', 'battlEye'), ('DISABLE_THIRD', 'disableThirdPerson')]:
        value = game['gameProperties'][key]
        if type(value) is not bool:
            raise ValueError('Invalid native Reforger boolean: ' + key)
        effective[variable] = str(value).lower()
    effective['PUBLIC_ADDRESS'] = result['publicAddress']
    for variable, key in [('A2S_PORT', 'a2s'), ('RCON_PORT', 'rcon')]:
        listener = result.get(key, {})
        if not isinstance(listener, dict) or type(listener.get('port', 0)) is not int:
            raise ValueError('Invalid native Reforger listener')
        effective[variable] = str(listener.get('port', 0))
    effective['RCON_PASSWORD'] = result.get('rcon', {}).get('password', '')
    checked = base_config(result, effective)
    # Allocation-owned bind/public ports cannot drift through file editing.
    for key in ('bindAddress', 'bindPort', 'publicPort'):
        result[key] = checked[key]
    for key in ('a2s', 'rcon'):
        if key in checked:
            result[key] = checked[key]
    return result


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate Reforger JSON key: ' + key)
        result[key] = value
    return result


def configure(root, game, env):
    if game != 'reforger':
        return base_configure(root, game, env)
    arma.agreement(game, env)
    path = arma.confined(root, 'config.json')
    # Validate every launch argument before publishing native settings.
    interval = arma.integer(env, 'LOG_INTERVAL', 0, 0, 2147483)
    fps = arma.integer(env, 'MAX_FPS', 120, 1, 100000) if env.get('MAX_FPS', '120') else None
    binary = arma.confined(root, 'ArmaReforgerServer')
    previous = json.loads(path.read_text(encoding='utf-8-sig'), object_pairs_hook=unique_object) if path.exists() else {}
    result = configuration(previous, env)
    args = [str(binary), '-gproj', './addons/data/ArmaReforger.gproj',
            '-config', './config.json', '-profile', './profile', '-backendlog', '-nothrow',
            '-listScenarios', '-logStats', str(interval * 1000), '-addonTempDir', './tmp']
    if fps is not None:
        args += ['-maxFPS', str(fps)]
    # Leave formatting, BOM, line endings and metadata alone when no seed or
    # allocation correction is required. Unknown native data remains authoritative.
    if not path.exists() or result != previous:
        arma.native.private_write(path, json.dumps(result, indent=2) + '\n')
    return args, []


def boolean(env, key, default=False):
    if key == 'VOLTRA_STEAM_AUTO_UPDATE' and key not in env:
        return base_boolean(env, 'AUTO_UPDATE', default)
    return base_boolean(env, key, default)


def main():
    arma.reforger_config = configuration
    arma.configure = configure
    arma.boolean = boolean
    return arma.main()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Reforger operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
