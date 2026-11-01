#!/usr/bin/env python3
"""Torch-only native config authority. Existing operator XML is read-only."""
import importlib.util
import os
from pathlib import Path
import re
import sys

spec = importlib.util.spec_from_file_location('engineering_torch_base', Path(__file__).with_name('engineering-servers.py'))
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
    cfg = base.shared.confined(root, root / 'Instance/SpaceEngineers-Dedicated.cfg')
    if not cfg.exists():
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
    if game != 'torch':
        raise ValueError('Torch wrapper cannot configure another recipe')
    doc = preflight(root, env)
    if doc is None:
        return original_configure(root, game, env)
    root = Path(root).resolve()
    # Environment controls seed new instances only. Native settings, identity,
    # nested mod collections, passwords and world bytes remain authoritative.
    secrets = [node.text for key in ('RemoteSecurityKey', 'ServerPassword', 'ServerPasswordHash', 'ServerPasswordSalt') for node in doc.findall(key) if node.text]
    return ['wine', str(root / 'Torch.Server.exe'), '-noupdate', '-nogui', '-console', '-instancepath', base.windows(root / 'Instance')], secrets


def prerequisites(root, env):
    # Pure validation before Steam acquisition or writes to the instance.
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Explicit runtime licence acceptance required')
    if env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('Torch requires win64')
    prefix = Path(env.get('WINEPREFIX', str(Path(root).resolve() / '.wine')))
    if not prefix.is_absolute():
        raise ValueError('Private absolute Wine prefix required')
    base.shared.confined(Path(root).resolve(), prefix)
    registry = base.shared.confined(Path(root).resolve(), prefix / 'system.reg')
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix retained')
    verbs = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022 corefonts dotnet48')).split()
    if not verbs or len(verbs) != len(set(verbs)) or any(v not in ('win11','vcrun2022','mono','corefonts','dotnet48') for v in verbs):
        raise ValueError('Unsupported private Wine prerequisites')
    base.choice(env, 'INSTALL_MODE', 'steam', ('steam', 'operator_files'))
    if env.get('SRCDS_APPID', '298740') != '298740' or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Wrong application or platform')
    base.shared.roles(env, ['STEAM_PORT', 'REMOTEAPI_PORT'])
    # Validate original fresh-instance controls without changing native files.
    base.shared.world_name(env, 'World', 20)
    base.choice(env, 'SERVER_MODE', 'Survival', ('Survival','Creative'))
    base.shared.integer(env, 'MAX_PLAYERS', 4, 1, 2147483647)
    base.shared.integer(env, 'SAVE_INTERVAL', 5, 0, 999)
    base.boolean(env, 'SAVE_ENABLED', 'true')
    base.boolean(env, 'REMOTEAPI_ENABLE')
    base.shared.text(env, 'SERVER_NAME', 'A Pterodactyl hosted Space Engineer Server', 64)
    base.shared.text(env, 'SERVER_DESC', 'A Pterodactyl hosted Space Engineer Server', 200)


def main(action, root, env):
    if action not in ('install', 'run'):
        raise ValueError('Unsupported vanilla action')
    prerequisites(root, env)
    preflight(root, env)  # Refuse before Steam update, Wine preparation or writes.
    base.configure = configure
    return base.install(root, 'torch', env) if action == 'install' else base.run(root, 'torch', env)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1], Path.cwd(), dict(os.environ)) or 0)
    except Exception as error:
        # Native XML and credentials are deliberately absent from diagnostics.
        print('Torch preflight failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)

