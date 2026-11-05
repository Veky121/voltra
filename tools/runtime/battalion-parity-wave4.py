#!/usr/bin/env python3
"""Battalion-only read-only startup validation before publisher acquisition."""
import os
from pathlib import Path
import re


def preflight(root, environment, shared):
    root = Path(root).resolve()
    kind, info = shared.selection(environment)
    if kind != 'battalion':
        raise ValueError('This entrypoint is Battalion Legacy only')
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Auto update must be 0 or 1')
    validation = environment.get('VALIDATE', '')
    if validation not in ('', 'true', '1'):
        raise ValueError('Repair validation must be empty, true or 1')
    raw = environment.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[1-9][0-9]{0,4}(?:,[1-9][0-9]{0,4})*', raw):
        raise ValueError('Choose canonical allocated native ports')
    allocated = [int(value) for value in raw.split(',')]
    if len(allocated) != len(set(allocated)) or any(value > 65535 for value in allocated):
        raise ValueError('Choose distinct valid native allocations')
    shared.ports(environment, ['QUERY_PORT'])
    shared.text(environment.get('SERVER_NAME', 'Dedicated server'), 60)
    shared.text(environment.get('ADMIN_PW', 'changeme'), 20)
    # Inspect all ancestors without creating files. The shared confinement
    # helper also checks the resolved target and cannot repair a symlink path.
    existing = []
    for name in info['binaries']:
        cursor = root
        for part in Path(name).parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise ValueError('Native launcher cannot use symlinks')
        candidate = shared.confined(root, name)
        if candidate.exists():
            if not candidate.is_file():
                raise ValueError('Native launcher must be a regular file')
            existing.append(candidate)
    if len(existing) > 1 or not existing and automatic != '1':
        raise ValueError('Choose exactly one reviewed native launcher layout')
    if automatic == '1':
        from steam_template import arguments
        arguments(root, info['app'], environment, validation in ('true', '1'), platform='linux')
    return root


def main(root=None, environment=None, shared=None):
    if shared is None:
        import tactical_next_runtime as shared
    root = Path.cwd() if root is None else Path(root)
    environment = dict(os.environ if environment is None else environment)
    root = preflight(root, environment, shared)
    return shared.main(root, environment)


if __name__ == '__main__':
    raise SystemExit(main())
