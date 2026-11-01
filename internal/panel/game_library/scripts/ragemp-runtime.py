#!/usr/bin/env python3
"""RageMP-only strict configuration adapter. No toolkit or client acquisition."""
import json
import os
from pathlib import Path
import sys
import importlib.util


def module(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def pairs(rows):
    result = {}
    for key, value in rows:
        if key in result:
            raise ValueError('Duplicate RageMP JSON key')
        result[key] = value
    return result


def invalid_constant(value):
    raise ValueError('Non-finite RageMP JSON number')


def parse(raw):
    result = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant)
    if not isinstance(result, dict):
        raise ValueError('RageMP configuration must be an object')
    managed = {'bind', 'port', 'name', 'maxplayers'}
    if any(key.casefold() in managed and key not in managed for key in result):
        raise ValueError('Ambiguous managed RageMP key')
    # JSON encoding rejects overflowed exponent numbers too.
    json.dumps(result, allow_nan=False)
    return result


def preflight(root, env):
    root = root.resolve()
    common = module('gta-runtime')
    primary, ports = common.allocated(env)
    if primary == 65535 or primary + 1 not in ports:
        raise ValueError('RageMP requires allocated game TCP/UDP and HTTP TCP port+1')
    # Check both legacy and active layouts before acquisition or writes.
    configs = []
    for relative in ('conf.json', 'ragemp/conf.json'):
        path = root / relative
        if path.is_symlink() or not path.resolve().is_relative_to(root):
            raise ValueError('RageMP configuration escapes volume or is a symlink')
        configs.append(parse(path.read_text(encoding='utf-8')) if path.exists() else None)
    config = configs[1] if configs[1] is not None else configs[0]
    if config is None:
        config = {'announce': False, 'gamemode': 'freeroam', 'language': 'en',
                  'stream-distance': 500.0, 'csharp': False}
    config.update(bind='0.0.0.0', port=primary,
                  name=common.text(env, 'SERVER_NAME', 'RAGE:MP Unofficial server', 64),
                  maxplayers=common.number(env, 'MAX_PLAYERS', 50, 1, 100))
    return config


def configure(root, env):
    config = preflight(root, env)
    module('gta-runtime').write_config(root, root / 'ragemp/conf.json',
                                     json.dumps(config, indent=2, ensure_ascii=False, allow_nan=False) + '\n')
    return config


def run(root, env):
    configure(root, env)
    env = dict(env)
    env.pop('PYTHONHOME', None)
    cwd = root / 'ragemp'
    env['LD_LIBRARY_PATH'] = str(cwd) + os.pathsep + env.get('LD_LIBRARY_PATH', '')
    return module('native-console').run(cwd, [str(cwd / 'ragemp-server')], env,
                                        '\x18', terminal_input=True)


if __name__ == '__main__':
    sys.exit(run(Path(os.environ.get('VOLTRA_SERVER_ROOT', '/home/container')).resolve(), os.environ))
