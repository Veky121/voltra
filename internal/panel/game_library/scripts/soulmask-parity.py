#!/usr/bin/env python3
"""MIT. Soulmask-only policy over the existing shared native adapter."""
import json
import os
from pathlib import Path
import sys
import importlib.util

spec = importlib.util.spec_from_file_location('soulmask_frontier', Path(__file__).with_name('frontier-native.py'))
frontier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontier)
original_plan = frontier.plan
CONFIG = 'WS/Saved/GameplaySettings/GameXishu.json'


def reject_constant(value):
    raise ValueError('Soulmask JSON must contain finite numbers')


def plan(root, game, env):
    if game != 'soulmask':
        raise ValueError('Soulmask wrapper accepts only its own recipe')
    authority = env.get('SOULMASK_SETTINGS_AUTHORITY', 'startup')
    if authority not in ('startup', 'file'):
        raise ValueError('Choose startup or file settings authority')
    previous = frontier.read(Path(root).resolve(), CONFIG)
    if not previous and (Path(root).resolve() / CONFIG).exists():
        raise ValueError('Existing Soulmask gameplay settings are empty; restore valid JSON before continuing')
    if previous:
        value = json.loads(previous, object_pairs_hook=frontier.unique_object, parse_constant=reject_constant)
        # Exponent overflow is also non-finite, despite valid JSON syntax.
        json.dumps(value, allow_nan=False)
    argv, secrets, writes = original_plan(root, game, env)
    if previous and authority == 'file':
        # Validate through the existing typed planner, but retain exact operator
        # bytes and permissions. A missing file still receives the original seed.
        writes.pop(CONFIG, None)
    return argv, secrets, writes


frontier.plan = plan


def environment(env):
    result = dict(env)
    raw = result.get('VOLTRA_STEAM_AUTO_UPDATE', result.get('AUTO_UPDATE', '1'))
    if raw not in ('0', '1', 'true', 'false', 'True', 'False'):
        raise ValueError('Invalid Soulmask automatic update value')
    result['VOLTRA_STEAM_AUTO_UPDATE'] = '1' if raw.lower() in ('1', 'true') else '0'
    return result


if __name__ == '__main__':
    try:
        env = environment(os.environ)
        if sys.argv[1:] == ['install']:
            frontier.install(Path.cwd(), 'soulmask', env)
        elif sys.argv[1:] == ['run']:
            sys.exit(frontier.run(Path.cwd(), 'soulmask', env))
        else:
            raise ValueError('Expected install or run')
    except Exception as error:
        message = str(error)
        for key in ('SERVER_PASSWORD', 'ADMIN_PASSWORD', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS'):
            if os.environ.get(key):
                message = message.replace(os.environ[key], '[redacted]')
        print('Soulmask failed: ' + message, file=sys.stderr)
        sys.exit(1)
