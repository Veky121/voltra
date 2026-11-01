#!/usr/bin/env python3
"""SS14-only acquisition and file-authoritative launch policy. MIT."""
import json
import os
from pathlib import Path
import sys
import tomllib
import zipfile
import native_zip_release
from quake_ss14_install import releases, tar_install
from quake_ss14_runtime import number, text
from native_console import run
import platform

# Exact publisher manifest receipt, 2026-10-29. No latest-version selection.
PUBLISHER_BUILD = "94087a918a2fae4571f5a529fe14ef7f5dce29a3"
PUBLISHER_SERVERS = {
    "linux-x64": ("72cfe586368190edcd53f074da1a3e9a03f7f63486bf628a3ad2c7bdb2487187", 43600064),
    "linux-arm64": ("607d79dcd0d7afa331a009d5ffb916ca2b8ff46b8bf5a7ea33650cae02ca518c", 43317903),
}

def selected_releases(machine):
    runtime, game = releases(machine)
    rid = "linux-arm64" if machine in ("aarch64", "arm64") else "linux-x64"
    digest, size = PUBLISHER_SERVERS[rid]
    url = f"https://wizards.cdn.spacestation14.com/fork/wizards/version/{PUBLISHER_BUILD}/file/SS14.Server_{rid}.zip"
    if (game.get("version"), game.get("url"), game.get("sha256"), game.get("bytes"), game.get("prefix")) != (PUBLISHER_BUILD, url, digest, size, None):
        raise ValueError("SS14 release differs from reviewed publisher manifest; review compatibility before acquisition")
    return runtime, game



def validate_document(document):
    for name in ('game', 'net', 'hub'):
        if name in document and not isinstance(document[name], dict):
            raise ValueError('SS14 known configuration sections must be tables')
    for section, key, low, high in (('net', 'tickrate', 1, 80),
                                     ('net', 'max_connections', 1, 256),
                                     ('game', 'soft_max_players', 1, 256)):
        values = document.get(section, {})
        if key in values:
            value = values[key]
            if type(value) is not int or not low <= value <= high:
                raise ValueError('SS14 native control outside supported creation bounds')
    game = document.get('game', {})
    if 'hostname' in game:
        if not isinstance(game['hostname'], str):
            raise ValueError('SS14 native hostname must be text')
        text(game['hostname'], 48)
    hub = document.get('hub', {})
    if 'advertise' in hub and hub['advertise'] is not False:
        raise ValueError('Hub advertising requires separate operator authorization; use advertise=false')


def seed(root, env):
    root = Path(root).resolve()
    game = root / 'ss14'
    config = game / 'server_config.toml'
    if game.is_symlink() or config.is_symlink() or not config.resolve().is_relative_to(root):
        raise ValueError('SS14 config must stay inside the volume without links')
    if config.exists():
        if not config.is_file() or config.stat().st_size > 16 * 1024**2:
            raise ValueError('SS14 native TOML must be a bounded regular file')
        document = tomllib.loads(config.read_text(encoding='utf-8'))
        validate_document(document)
        return game
    maximum = number(env, 'SERVER_MAX_PLAYERS', 256, 1, 256)
    hostname = text(env.get('SERVER_NAME', 'MyServer'), 48)
    tick = number(env, 'SERVER_TICK', 60, 1, 80)
    if env.get('PUBLIC_SERVER', '0') != '0':
        raise ValueError('External listing is not authorized by this profile')
    contents = ('# Seeded once. Native settings are authoritative after creation.\n'
                '[game]\nhostname = ' + json.dumps(hostname, ensure_ascii=False) +
                '\nsoft_max_players = ' + str(maximum) + '\n[net]\ntickrate = ' + str(tick) +
                '\nmax_connections = ' + str(maximum) + '\n[hub]\nadvertise = false\n')
    tomllib.loads(contents)
    game.mkdir(parents=True, exist_ok=True)
    fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
        output.write(contents)
    return game


def install(root, env):
    root = Path(root).resolve()
    runtime, game = selected_releases(platform.machine())
    seed(root, env)
    tar_install(root, runtime, 'dotnet', 'dotnet')
    original = native_zip_release.extract

    def extract(archive, target, prefix, paths=None):
        # Never publish stock config or data over operator-owned files, even
        # when their hashes still match an older publisher receipt.
        with zipfile.ZipFile(archive) as source:
            selected = [n for n in source.namelist() if not n.endswith('/')
                        and n != 'server_config.toml' and not n.startswith('data/')]
        return original(archive, target, prefix, selected)

    native_zip_release.extract = extract
    try:
        native_zip_release.install_release(root, game, 'ss14', 'Robust.Server')
    finally:
        native_zip_release.extract = original


def launch(root, env):
    root = Path(root).resolve()
    port = number(env, 'SERVER_PORT', 1212, 1025, 65535)
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if value}
    if port not in allocated or any(not 1 <= value <= 65535 for value in allocated):
        raise ValueError('SS14 native listener must use an allocated port')
    game = seed(root, env)
    # Allocation is infrastructure authority; game preferences stay in TOML.
    argv = [str(game / 'Robust.Server'), '--cvar', 'net.port=' + str(port),
            '--cvar', 'status.bind=*:' + str(port), '--cvar', 'hub.advertise=false']
    child = dict(env)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_LIBRARY_PATH', 'LD_PRELOAD', 'ROBUST_CVARS'):
        child.pop(key, None)
    for key in list(child):
        if key.startswith('ROBUST_CVAR_'):
            child.pop(key)
    child.update(HOME=str(root), DOTNET_ROOT=str(root / 'dotnet'), DOTNET_CLI_TELEMETRY_OPTOUT='1')
    # Native readiness text is historical evidence only until root rechecks the
    # pinned server. No detached probe can mark another process as ready.
    result = run(game, argv, child, 'shutdown VoltraStop', terminal_input=True, terminal_query_reply=True)
    print('VOLTRA_SS14_EXIT ' + str(result), flush=True)
    return result if result >= 0 else 128 - result


if __name__ == '__main__':
    if sys.argv[1] == 'install':
        install(Path.cwd(), dict(os.environ))
    elif sys.argv[1] == 'run':
        raise SystemExit(launch(Path.cwd(), dict(os.environ)))
    else:
        raise ValueError('Expected install or run')
