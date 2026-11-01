#!/usr/bin/env python3
"""Vanilla-only native config authority. Existing operator XML is read-only."""
import importlib.util
import os
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('engineering_vanilla_base', Path(__file__).with_name('engineering-servers.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
original_configure = base.configure


def document(path, expected):
    raw = path.read_bytes()
    if len(raw) > 16 * 1024**2:
        raise ValueError('Native XML exceeds preflight limit')
    # Windows XmlSerializer commonly emits UTF-16 with a BOM.
    text = raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')
    doc = base.xml(text, expected)
    return doc


def scalar(doc, name):
    nodes = doc.findall(name)
    if len(nodes) != 1 or len(nodes[0]):
        raise ValueError('Missing, duplicate or nested native field: ' + name)
    return nodes[0].text or ''


def preflight(root, env):
    root = Path(root).resolve()
    cfg = base.shared.confined(root, root / 'config/SpaceEngineers-Dedicated.cfg')
    if not cfg.exists():
        if env.get('INSTALL_MODE', 'steam') == 'operator_files':
            world = base.shared.world_name(env, 'World', 20)
            target = base.shared.confined(root, root / 'config/Saves' / world / 'Sandbox.sbc')
            if not target.is_file():
                raise ValueError('Upload a valid selected Sandbox.sbc before fresh operator-files setup; no world is invented')
            document(target, 'MyObjectBuilder_Checkpoint')
        return None
    doc = document(cfg, 'MyConfigDedicated')
    ports = base.shared.roles(env, ['STEAM_PORT', 'REMOTEAPI_PORT'])
    for name, value in [('ServerPort', ports['primary']), ('SteamPort', ports['STEAM_PORT']), ('RemoteApiPort', ports['REMOTEAPI_PORT'])]:
        if scalar(doc, name) != str(value):
            raise ValueError('Native allocation mismatch: ' + name + '; reconcile stopped native config before acquisition')
    world = scalar(doc, 'LoadWorld').replace('\\', '/')
    if not re.match(r'(?i)^Z:(?:/|[A-Z]:/)', world):
        raise ValueError('LoadWorld must identify an existing confined Z: world; no world is replaced')
    target = base.shared.confined(root, Path(world[2:]))
    if target.name != 'Sandbox.sbc' or not target.is_file():
        raise ValueError('Selected native Sandbox.sbc is missing; refusing fallback world')
    document(target, 'MyObjectBuilder_Checkpoint')
    companion = base.shared.confined(root, target.with_name('Sandbox_config.sbc'))
    if companion.exists():
        document(companion, 'MyObjectBuilder_WorldConfiguration')
    return doc


def configure(root, game, env):
    if game != 'space':
        raise ValueError('Vanilla wrapper cannot configure another recipe')
    doc = preflight(root, env)
    if doc is None:
        root = Path(root).resolve()
        world = base.shared.world_name(env, 'World', 20)
        target = base.shared.confined(root, root / 'config/Saves' / world / 'Sandbox.sbc')
        if not target.is_file():
            raise ValueError('Selected native Sandbox.sbc is missing; refusing fresh config publication')
        document(target, 'MyObjectBuilder_Checkpoint')
        return original_configure(root, game, env)
    root = Path(root).resolve()
    # Environment controls seed new instances only. Native settings, identity,
    # nested mod collections, passwords and world bytes remain authoritative.
    secrets = [node.text for key in ('RemoteSecurityKey', 'ServerPassword', 'ServerPasswordHash', 'ServerPasswordSalt') for node in doc.findall(key) if node.text]
    return ['wine', str(root / 'DedicatedServer64/SpaceEngineersDedicated.exe'), '-path', base.windows(root / 'config'), '-console', '-ignorelastsession'], secrets


def main(action, root, env):
    if action not in ('install', 'run'):
        raise ValueError('Unsupported vanilla action')
    preflight(root, env)  # Refuse before Steam update, Wine preparation or writes.
    base.configure = configure
    return base.install(root, 'space', env) if action == 'install' else base.run(root, 'space', env)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1], Path.cwd(), dict(os.environ)) or 0)
    except Exception as error:
        # Native XML and credentials are deliberately absent from diagnostics.
        print('Space Engineers vanilla preflight failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)

