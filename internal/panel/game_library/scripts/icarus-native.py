#!/usr/bin/env python3
"""Icarus-only byte-preserving legacy config migration. No mission edits."""
import importlib.util
import os
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('space_survival', Path(__file__).with_name('space-survival.py'))
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
original_configure = adapter.configure


def configure(root, game, env):
    if game != 'icarus':
        raise ValueError('Icarus wrapper only')
    root = Path(root).resolve()
    # Validate original controls before creating config directories.
    adapter.identity(game, env)
    adapter.shared.roles(env, ['QUERY_PORT'])
    adapter.shared.text(env, 'SERVER_NAME', 'IcarusServer', 64)
    target = adapter.shared.confined(root, root / 'Icarus/Saved/Config/WindowsServer/ServerSettings.ini')
    legacy = adapter.shared.confined(root, root / 'Icarus/Saved/Config/ServerSettings.ini')
    if not target.exists():
        payload = legacy.read_bytes() if legacy.exists() else Path(__file__).with_name('space-survival-icarus.ini').read_bytes()
        # Validate encoding before publication; retain BOM, arrays, CRLF and all unknown bytes.
        payload.decode('utf-8-sig')
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            with target.open('xb') as stream:
                stream.write(payload)
        except FileExistsError:
            pass  # Concurrent native/operator creation has precedence.
    return original_configure(root, game, env)


adapter.configure = configure
if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action == 'install':
            adapter.install(Path.cwd(), 'icarus', dict(os.environ))
        elif action == 'run':
            sys.exit(adapter.run(Path.cwd(), 'icarus', dict(os.environ)))
        else:
            raise ValueError('Unsupported action')
    except Exception:
        print('Icarus setup failed; review ports, native config encoding and explicit runtime prerequisites.', file=sys.stderr)
        sys.exit(1)
