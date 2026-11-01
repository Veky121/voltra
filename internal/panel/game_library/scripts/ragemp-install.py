#!/usr/bin/env python3
"""RageMP-only authorized archive installer; preserve all existing non-binary files."""
import os
from pathlib import Path
import shutil
import tempfile
from importlib.util import spec_from_file_location, module_from_spec


def module(name):
    spec = spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    result = module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def install(root, env):
    root = root.resolve()
    module('ragemp-runtime').preflight(root, env)
    identity = module('gta-legacy-install').identity('ragemp', env)
    # Complete path preflight, including operator resources, before network/state creation.
    for base in (root / 'ragemp', root / '.voltra', root / 'packages', root / 'client_packages',
                 root / 'plugins', root / 'maps', root / 'dotnet'):
        paths = [base] + (list(base.rglob('*')) if base.is_dir() and not base.is_symlink() else [])
        if any(p.is_symlink() or not p.resolve().is_relative_to(root) for p in paths):
            raise ValueError('RageMP symlinks require explicit operator migration')
    release = module('native-release')
    # This is rollback on handled errors, not crash-atomic multi-file publication.
    with tempfile.TemporaryDirectory(prefix='ragemp-', dir=root) as temporary:
        stage = Path(temporary)
        release.install_release(stage, identity, 'ragemp', 'ragemp-server')
        staged_config = stage / 'ragemp/conf.json'
        if staged_config.exists():
            module('ragemp-runtime').parse(staged_config.read_text(encoding='utf-8'))
        changes = []
        try:
            for source in (stage / 'ragemp').rglob('*'):
                if not source.is_file():
                    continue
                name = source.relative_to(stage / 'ragemp')
                destination = root / 'ragemp' / name
                if name.as_posix() != 'ragemp-server' and (root / name).is_file():
                    continue
                if destination.exists() and name.as_posix() != 'ragemp-server':
                    continue
                saved = None
                if destination.exists():
                    saved = stage / 'backup' / name
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(destination, saved)
                    release.preserve_identity(source, destination)
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.replace(source, destination)
                changes.append((destination, saved))
            (root / '.voltra/ragemp').mkdir(parents=True, exist_ok=True)
            module('gta-install').migrate(root, 'ragemp', ['conf.json', 'packages', 'client_packages',
                                                        'plugins', 'maps', 'dotnet/resources', 'dotnet/settings.xml'])
        except BaseException:
            for destination, saved in reversed(changes):
                if saved is None:
                    destination.unlink()
                else:
                    os.replace(saved, destination)
            raise


if __name__ == '__main__':
    install(Path(os.environ.get('VOLTRA_SERVER_ROOT', '/mnt/server')), os.environ)
