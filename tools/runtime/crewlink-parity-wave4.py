#!/usr/bin/env python3
"""BetterCrewLink-only allocation preflight, retaining the shared lifecycle."""
import importlib.util
import os
from pathlib import Path
import re
import sys


def load_shared():
    here = Path(__file__).resolve()
    source = here.with_name('among-us-runtime.py')
    if not source.exists():
        source = here.parents[2] / 'internal/panel/game_library/scripts/among-us-runtime.py'
    spec = importlib.util.spec_from_file_location('crewlink_shared_runtime', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preflight(shared, root, environment):
    root = Path(root).resolve()
    # Use original HTTPS/name/domain semantics, including nonempty "false".
    effective = shared.crew_environment(root, environment)
    raw = environment.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Choose allocated BetterCrewLink listener ports')
    allocated = [int(port) for port in raw.split(',')]
    if len(allocated) != len(set(allocated)) or any(not 1 <= port <= 65535 for port in allocated):
        raise ValueError('Invalid BetterCrewLink port allocations')
    primary = shared.port(environment, 'SERVER_PORT', 9736)
    if primary not in allocated or int(effective['PORT']) not in allocated:
        raise ValueError('BetterCrewLink PORT must be an allocated listener')
    for name in ('.voltra/node/bin/node', 'crewlink/dist/index.js'):
        target = root / name
        if target.is_symlink() or not target.resolve().is_relative_to(root) or not target.is_file():
            raise ValueError('Reinstall to restore confined BetterCrewLink runtime files')
    return effective


def run(shared, root, environment):
    root = Path(root).resolve()
    effective = preflight(shared, root, dict(environment))
    # Preserve actual Node exit/signal results and existing signal forwarding.
    return shared.run('crewlink', root, effective)


if __name__ == '__main__':
    try:
        sys.exit(run(load_shared(), Path.cwd(), dict(os.environ)))
    except (ValueError, OSError, KeyError):
        print('BetterCrewLink setup failed. Check allocated listener, runtime files and private TLS paths.', file=sys.stderr)
        sys.exit(1)
