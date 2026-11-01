#!/usr/bin/env python3
"""Nightingale-only preflight and publisher-documented stdout logging."""
import importlib.util
import os
from pathlib import Path
import sys

sibling = Path(__file__).with_name('fantasy_survival_servers.py')
if not sibling.exists():
    sibling = Path(__file__).with_name('fantasy-survival-servers.py')
spec = importlib.util.spec_from_file_location('nightingale_fantasy', sibling)
game = importlib.util.module_from_spec(spec)
spec.loader.exec_module(game)
original_command = game.command


def validate(root, env):
    # Complete scalar validation before update, seeding, or native execution.
    original_command(root, 'nightingale', env)
    if int(game.primary(env)) < 1024:
        raise ValueError('Nightingale requires a game port between 1024 and 65535')
    if 'Difficulty' in env and 'DIFFICULTY' in env and env['Difficulty'] != env['DIFFICULTY']:
        raise ValueError('Conflicting original and Wings variable Difficulty')
    if env.get('DIFFICULTY', env.get('Difficulty', 'easy')) not in ('easy', 'medium', 'hard', 'extreme'):
        raise ValueError('Invalid Nightingale difficulty')
    for key, default in (('PASSWORD', 'changeme'), ('ADMIN_PASSWORD', 'letmein')):
        game.text(env.get(key, default), 20)


def command(root, name, env):
    argv = original_command(root, name, env)
    if name == 'nightingale':
        # Publisher manual: JSON logger writes directly to stdout. No log tail
        # or synthetic readiness marker, and no public status/admin listener.
        argv += ['-ini:Engine:[JsonLogger]:bEnable=true',
                 '-ini:Engine:[JsonLogger]:bStdout=true', '-noconsole']
    return argv


game.command = command


def run(action, root, env):
    root = Path(root).resolve()
    if action not in ('install', 'run'):
        raise ValueError('Unknown Nightingale operation')
    validate(root, env)
    if action == 'install':
        return game.install(root, 'nightingale', env)
    return game.launch(root, 'nightingale', env)


if __name__ == '__main__':
    result = run(sys.argv[1], Path.cwd(), dict(os.environ))
    if isinstance(result, int):
        sys.exit(result)
