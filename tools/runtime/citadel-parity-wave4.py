#!/usr/bin/env python3
"""Citadel-only refusal before acquisition, with shared configuration/supervision."""
import os
from pathlib import Path
import sys


def regular(shared, root, relative, required=False):
    target = shared.confined(root, relative)
    for parent in target.parents:
        if parent == root:
            break
        if parent.exists() and not parent.is_dir():
            raise ValueError('Native configuration parent is not a directory')
    if target.exists() and not target.is_file():
        raise ValueError('Native configuration must be a regular file')
    if required and not target.is_file():
        raise ValueError('Reinstall to restore the Citadel launcher')
    return target


def preflight(shared, root, environment, require_binary=True):
    """Plan the exact shared Citadel writes without publishing any of them."""
    root = Path(root).resolve()
    if str(environment.get('SRCDS_APPID', '489650')) != '489650':
        raise ValueError('Citadel requires its original dedicated application')
    shared.steam_template.arguments(root, 489650, environment, validate=False, platform='linux')
    primary, query = shared.port_values(environment, 'QPORT')
    admin = shared.text(environment.get('ADMIN_PASSWD', ''), 100)
    if not admin:
        raise ValueError('Set an operator-owned Citadel administrator password')
    regular(shared, root, 'CitadelServer.sh', required=require_binary)
    central = regular(shared, root, 'Config/Game.ini')
    native = shared.citadel_path(root, 'Citadel/Saved/Config/LinuxServer/Game.ini')
    original = shared.read_ini(central) or shared.read_ini(native) or shared.defaults()['citadel_game_ini']
    tuple_value = shared.world_tuple(original)
    changes = {'UWorks': {'ConnectionPort': str(primary), 'QueryPort': str(query)},
               '/Script/Citadel.SocialManager': {'Password': shared.ini_string(admin)}}
    updates = {central: shared.unreal_ini(original, changes)}
    for relative in ('Citadel/Saved/Config/LinuxServer/Game.ini', 'Engine/Saved/Config/LinuxServer/Game.ini'):
        target = shared.citadel_path(root, relative)
        content = shared.read_ini(target) or original
        updates[target] = shared.unreal_ini(content, {**changes, '/Script/Citadel.CitadelGameInstance': {'WorldCreationSettings': tuple_value}})
    for relative in ('Config/Engine.ini', 'Citadel/Saved/Config/LinuxServer/Engine.ini', 'Engine/Saved/Config/LinuxServer/Engine.ini'):
        target = shared.citadel_path(root, relative)
        updates[target] = shared.unreal_ini(shared.read_ini(target) or '', {'URL': {'Port': str(primary)}})
    for target in updates:
        regular(shared, root, target.relative_to(root).as_posix())
    backup = shared.confined(root, '.voltra/fantasy-worlds/backups')
    if backup.exists() and not backup.is_dir():
        raise ValueError('Native backup destination must be a directory')
    for parent in backup.parents:
        if parent == root:
            break
        if parent.exists() and not parent.is_dir():
            raise ValueError('Native backup parent must be a directory')
    return updates


def main(shared=None, installer=None):
    if shared is None:
        import fantasy_worlds_runtime as shared
    if installer is None:
        from fantasy_worlds_install import install as installer
    root, environment = Path.cwd().resolve(), dict(os.environ)
    automatic = shared.boolean(environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '1')))
    preflight(shared, root, environment, require_binary=not automatic)
    if automatic:
        installer(root, 'citadel', environment, validate=False)
    preflight(shared, root, environment)
    cwd, argv, child_environment, stop, credentials, ready = shared.configure(root, 'citadel', environment)
    return shared.run(cwd, argv, child_environment, stop, credentials=credentials, ready_marker=ready,
                      terminal_input=True, output_observer=lambda _: None)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Citadel startup refused; review native configuration, allocations and publisher prerequisites.', file=sys.stderr)
        sys.exit(1)
