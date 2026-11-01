#!/usr/bin/env python3
"""MIT. RA-only shared supervision and native-greeting readiness.

The publisher's startup line precedes map loading/listener construction.
Readiness requires its protocol7 RA/version greeting; no player response is sent.
"""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import socket
import struct
import sys
import threading
import time
import tempfile


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


READY = '[INFO] OpenRA Red Alert native server ready.'

# Publisher ServerSettings defaults, release-20250330. Startup-owned identity,
# listener, password, public/auth and replay settings intentionally remain out.
DEFAULT_SETTINGS = b'''# Optional native server settings for release-20250330.
# Startup controls own identity, listeners, password, public/auth and replays.
Server:
\tQueryMapRepository: True
\tEnableSyncReports: False
\tEnableLintChecks: True
\tEnableVoteKick: True
\tFloodLimitJoinCooldown: 5000
\tFloodLimitInterval: 5000
\tFloodLimitMessageCount: 5
\tFloodLimitCooldown: 15000
\tVoteKickTimer: 30000
\tVoteKickerCooldown: 120000
'''


def seed_settings(root, release_version):
    """Exclusive first creation only; existing bytes/mode/owner stay authoritative."""
    root = Path(root).resolve()
    if not root.is_dir():
        raise ValueError('Existing native OpenRA root required')
    support = root / 'OpenRAData'
    target = support / 'settings.yaml'
    if support.is_symlink() or (support.exists() and not support.is_dir()) or target.is_symlink():
        raise ValueError('Unsafe native OpenRA settings path')
    if target.exists():
        if not target.is_file():
            raise ValueError('Native OpenRA settings must be a regular file')
        return False
    if release_version != 'release-20250330':
        return False
    support.mkdir(exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.voltra-openra-seed-', dir=support)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(DEFAULT_SETTINGS)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o600)
        try:
            # Same-directory hard link publishes complete bytes without ever
            # replacing an existing/concurrently-created operator document.
            os.link(temporary, target)
        except FileExistsError:
            if target.is_symlink() or not target.is_file():
                raise ValueError('Native OpenRA settings changed concurrently')
            return False
        return True
    finally:
        Path(temporary).unlink(missing_ok=True)


def greeting_identity(data, version):
    if len(data) < 8 or len(data) > 131072:
        return False
    protocol, client = struct.unpack_from('<ii', data)
    if protocol != 7 or client < 0 or b'HandshakeRequest' not in data:
        return False
    mods = re.findall(rb'\n\tMod: ([a-z0-9]+)\r?\n', data)
    versions = re.findall(rb'\n\tVersion: ([^\r\n]+)\r?\n', data)
    if mods != [b'ra'] or len(versions) != 1 or not 0 < len(versions[0]) <= 255:
        return False
    try:
        native_version = versions[0].decode('utf-8')
    except UnicodeDecodeError:
        return False
    if any(ord(c) < 32 or ord(c) == 127 for c in native_version):
        return False
    return version is None or native_version == version


def native_greeting(port, version):
    deadline = time.monotonic() + 1.5
    with socket.create_connection(('127.0.0.1', port), timeout=0.5) as connection:
        connection.settimeout(0.5)
        data = bytearray()
        while time.monotonic() < deadline:
            block = connection.recv(min(16384, 131073 - len(data)))
            if not block:
                return False
            data.extend(block)
            if len(data) > 131072:
                return False
            if greeting_identity(data, version):
                return True
    return False


def prepare(root, env, family):
    # Validate every original startup control before family.arguments creates
    # its support directory. Preserve all family argv/default/permission rules.
    port = int(env['SERVER_PORT'])
    if not 1 <= port <= 65535:
        raise ValueError('Invalid allocated OpenRA port')
    for key in ('SERVER_NAME', 'PASSWORD'):
        family.text(env.get(key, ''))
    for key in ('PUBLIC', 'SINGLEPLAYER', 'AUTH', 'GEOIP', 'ANONYMOUS', 'RECORD_REPLAYS'):
        if key in env and env[key] not in ('true', 'false'):
            raise ValueError('Native OpenRA boolean must be true or false')
    if env.get('SERVER_MAP') and not re.fullmatch(r'[0-9a-f]{40}', env['SERVER_MAP']):
        raise ValueError('Map must be the native SHA1 map UID')
    receipt = json.loads((root / '.voltra/openra/release.json').read_text())
    version = receipt.get('version', '')
    if receipt.get('game') != 'openra' or receipt.get('mod') != 'ra' or not re.fullmatch(r'(release|playtest)-[0-9]{8}', version):
        raise ValueError('Reviewed native Red Alert installation receipt required')
    # Preserve legitimate operator-modified mod metadata. Installer identity
    # and mod metadata version are separate authorities: native readiness is
    # still protocol7/RA, while stock metadata also requires its exact version.
    expected = receipt.get('files', {}).get('mods/ra/mod.yaml')
    if expected is not None:
        metadata = root / 'openra/mods/ra/mod.yaml'
        if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected) or metadata.is_symlink() or not metadata.resolve().is_relative_to(root):
            raise ValueError('Invalid native OpenRA mod metadata identity')
        with metadata.open('rb') as source:
            actual = hashlib.file_digest(source, 'sha256').hexdigest()
        if actual != expected:
            version = None
    return family.arguments(root, env, 'ra'), port, version


def launch(root, env):
    root = Path(root).resolve()
    family = load('openra_ra_family', 'openra-family.py')
    argv, port, version = prepare(root, env, family)
    release = json.loads((root / '.voltra/openra/release.json').read_text())
    seed_settings(root, release.get('version'))
    load('steam_template', 'steam-template.py')
    console = load('openra_ra_console', 'native-console.py')
    finished = threading.Event()

    def readiness():
        deadline = time.monotonic() + 30
        while not finished.is_set() and time.monotonic() < deadline:
            try:
                if native_greeting(port, version):
                    if not finished.is_set():
                        print(READY, flush=True)
                    return
            except (OSError, ValueError):
                pass
            finished.wait(0.25)
        if not finished.is_set():
            print('[ERROR] OpenRA native greeting readiness timed out; stopping the native server.', flush=True)
            os.kill(os.getpid(), signal.SIGTERM)

    observer = threading.Thread(target=readiness, daemon=True)
    observer.start()
    try:
        return console.run(root / 'openra', argv, dict(env), '^C',
                           credentials=tuple(x for x in (env.get('PASSWORD', ''),) if x),
                           stop_signal=signal.SIGINT, stop_signal_timeout=30)
    finally:
        finished.set()
        observer.join(timeout=2)


if __name__ == '__main__':
    try:
        raise SystemExit(launch(Path.cwd(), os.environ))
    except (ValueError, OSError, json.JSONDecodeError):
        print('[ERROR] OpenRA setup failed; check the installed release and startup controls.', flush=True)
        raise SystemExit(1)
