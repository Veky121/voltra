#!/usr/bin/env python3
"""MIT. GoldSrc publisher install with operator configuration restoration."""
import os
from pathlib import Path
import shutil
import tempfile
from goldsrc_runtime import selection
from steam_template import update


def operator_files(root, game):
    folder = root / game
    paths = []
    if folder.is_symlink(): raise ValueError('Game directory must not be a symlink')
    if not folder.exists(): return paths
    for path in folder.iterdir():
        if path.suffix.lower() in ('.cfg', '.ini') or path.name.lower() in ('liblist.gam', 'motd.txt', 'mapcycle.txt'):
            if path.is_symlink(): raise ValueError('Operator configuration must not be a symlink')
            if path.is_file(): paths.append(path)
    addons = folder / 'addons'
    if addons.is_symlink(): raise ValueError('Addons directory must not be a symlink')
    if addons.exists():
        for path in addons.rglob('*'):
            if path.is_symlink(): raise ValueError('Addons must not traverse symlinks during update')
            if path.is_file(): paths.append(path)
    return paths


def install(root, env, validate=True):
    root = root.resolve()
    flavor, game = selection(env)
    if flavor == 'rehlds' and env.get('SRCDS_BETAID', '') != 'steam_legacy':
        raise ValueError('ReHLDS requires the publisher steam_legacy branch')
    (root / '.voltra').mkdir(parents=True, exist_ok=True)
    saved = operator_files(root, game)
    ownership = {path: (path.stat().st_uid, path.stat().st_gid) for path in saved}
    with tempfile.TemporaryDirectory(prefix='.goldsrc-preserve-', dir=root / '.voltra') as temporary:
        backup = Path(temporary)
        for path in saved:
            target = backup / path.relative_to(root)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        try:
            update(root, 90, env={**env, 'HLDS_GAME': game}, validate=validate,
                   required=('hlds_run', 'hlds_linux', game + '/liblist.gam'))
        finally:
            # Restore even if Steam exits unsuccessfully. Steam validation can
            # replace stock-named configuration and plugin registration files.
            for path in saved:
                if not path.resolve().is_relative_to(root):
                    raise ValueError('Steam changed a protected path to escape the volume')
                path.parent.mkdir(parents=True, exist_ok=True)
                source = backup / path.relative_to(root)
                staging = path.with_name('.voltra-restore-' + path.name)
                if staging.exists() or staging.is_symlink(): raise ValueError('Unknown restoration staging file exists')
                shutil.copy2(source, staging)
                os.chown(staging, *ownership[path])
                os.replace(staging, path)
    for name in ('listip.cfg', 'banned.cfg'):
        target = root / game / name
        if not target.exists(): target.write_text('// Operator-owned native ban list.\n', encoding='utf-8')
    if flavor == 'rehlds':
        from rehlds_install import overlay
        overlay(root, env)


if __name__ == '__main__':
    install(Path.cwd(), os.environ)
