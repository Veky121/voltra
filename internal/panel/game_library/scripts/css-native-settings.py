#!/usr/bin/env python3
"""MIT. CSS-only seed authority; all acquisition, launch and console stay shared."""
import importlib
import os
from pathlib import Path
import sys

# Measured from Valve app232330 public build25338297, engine11003710.
# mp_autoteambalance is a native three-state enum, not a boolean.
CSS_DEFAULTS = (
    ('mp_friendlyfire', '0'), ('mp_autoteambalance', '1'),
    ('mp_limitteams', '2'), ('mp_roundtime', '2.5'),
    ('mp_freezetime', '6'), ('mp_maxrounds', '0'), ('mp_timelimit', '0'),
)


def plan(root, adapter):
    root = Path(root)
    if root.is_symlink() or root.resolve() != root:
        raise ValueError('CSS volume must be canonical')
    target = adapter.safe(root, 'cstrike/cfg/server.cfg')
    if target.exists():
        if target.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('CSS native settings exceed their limit')
        target.read_bytes().decode('utf-8')
        return target, None
    # These are literal executable-CFG commands, never an INI document.
    seed = '// Native CSS gameplay settings. Later boots retain operator edits.\n'
    seed += '// Server identity, credentials and allocated ports remain setup-owned.\n'
    seed += ''.join(key + ' "' + value + '"\n' for key, value in CSS_DEFAULTS)
    return target, seed


class CSSRuntime:
    def __init__(self, shared, adapter):
        self.shared, self.adapter = shared, adapter

    def __getattr__(self, name):
        return getattr(self.shared, name)

    def configure(self, root, environment):
        target, seed = plan(Path(root), self.adapter)
        argv, child = self.shared.configure(root, environment)
        if seed is not None:
            # Recheck before publication. Existing operator content always wins.
            target, seed = plan(Path(root), self.adapter)
            if seed is not None:
                self.shared.private_write(target, seed)
        return argv, child


def main(root=None, environment=None, adapter=None, shared=None):
    root = Path.cwd() if root is None else Path(root)
    environment = dict(os.environ if environment is None else environment)
    adapter = adapter or importlib.import_module('counterstrike_preflight')
    shared = shared or importlib.import_module('source_runtime')
    # Refuse unsafe native settings before any updater or managed-file writes.
    plan(root, adapter)
    return adapter.main('css', root, environment, runtime=CSSRuntime(shared, adapter))


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, TypeError, UnicodeError):
        print('CSS setup refused. Review allocations, controls and native settings.', file=sys.stderr)
        raise SystemExit(1)
