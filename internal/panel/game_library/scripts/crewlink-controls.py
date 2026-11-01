#!/usr/bin/env python3
"""BetterCrewLink-only allocation preflight, retaining the shared lifecycle."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

# Matches DEFAULT_PEER_CONFIG in publisher commit
# 0e1d4b12e7a7201cda4db723d08d57baa5549432/src/peerConfig.ts.
# The example file enables TURN; a fresh server's actual code defaults do not.
DEFAULT_PEER_YAML = '''forceRelayOnly: false
integratedRelay:
  enabled: false
  listeningIps:
    - 0.0.0.0
  relayIps: []
  externalIps: null
  minPort: 49152
  maxPort: 65535
  listeningPort: 3478
  debugLevel: INFO
  defaultUsername: M9DRVaByiujoXeuYAAAG
  defaultPassword: TpHR9HQNZ8taxjb3
iceServers:
  - urls: stun:stun.l.google.com:19302
'''
PINNED_CREW_SOURCE = '0e1d4b12e7a7201cda4db723d08d57baa5549432'
PINNED_CREW_SHA256 = '7f65a378fa4aa388ddb19aa344820ef48a4ba75768f50f49ed15791be44b84cf'


def reviewed_peer_defaults(root):
    receipt = root / '.voltra/crewlink/release.json'
    for parent in (root / '.voltra', receipt.parent):
        if parent.is_symlink() or not parent.resolve().is_relative_to(root):
            raise ValueError('BetterCrewLink source receipt must remain confined')
    if receipt.is_symlink() or not receipt.resolve().is_relative_to(root):
        raise ValueError('BetterCrewLink source receipt must remain confined')
    if not receipt.exists():
        return False
    if not receipt.is_file() or receipt.stat().st_size > 1024 * 1024:
        raise ValueError('Invalid BetterCrewLink source receipt')
    release = json.loads(receipt.read_text(encoding='utf-8'))
    return isinstance(release, dict) and release.get('version') == PINNED_CREW_SOURCE and release.get('sha256') == PINNED_CREW_SHA256


def peer_document(root):
    target = root / 'crewlink/config/peerConfig.yml'
    for parent in (root / 'crewlink', root / 'crewlink/config'):
        if parent.is_symlink() or not parent.resolve().is_relative_to(root):
            raise ValueError('BetterCrewLink native config directory must remain confined')
        if parent.exists() and not parent.is_dir():
            raise ValueError('BetterCrewLink native config parent must be a directory')
    if target.is_symlink() or not target.resolve().is_relative_to(root):
        raise ValueError('BetterCrewLink native config must remain confined')
    if target.exists() and not target.is_file():
        raise ValueError('BetterCrewLink native config must be a regular file')
    return target


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
    target = peer_document(root)
    if not target.exists() and reviewed_peer_defaults(root):
        shared.module('native-config').private_write(target, DEFAULT_PEER_YAML)
    # Preserve actual Node exit/signal results and existing signal forwarding.
    return shared.run('crewlink', root, effective)


if __name__ == '__main__':
    try:
        sys.exit(run(load_shared(), Path.cwd(), dict(os.environ)))
    except (ValueError, OSError, KeyError):
        print('BetterCrewLink setup failed. Check allocated listener, runtime files and private TLS paths.', file=sys.stderr)
        sys.exit(1)
