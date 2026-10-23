#!/usr/bin/env python3
"""MIT. Reviewed Unreal dedicated installs with operator-file retention."""
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import shutil
from steam_template import update, _publish


def metadata():
    name='unreal_survival_release.json' if '_' in Path(__file__).name else 'unreal-survival-release.json'
    return json.loads(Path(__file__).with_name(name).read_text())


def confined(root, name):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('Unreal server path leaves its volume')
    return path


def install(root, game, env=None):
    root = Path(root).resolve()
    info = metadata()[game]
    env = dict(os.environ if env is None else env)
    if env.get('SRCDS_APPID', str(info['app'])) != str(info['app']):
        raise ValueError('Dedicated application ID differs from reviewed recipe')
    # Preserve all operator settings, saves, mods and private prefix state,
    # including files absent from older publisher manifests.
    protected = {}
    spool = tempfile.TemporaryDirectory(prefix='.unreal-retention-',dir=root)
    try:
        for pattern in info['preserve']:
            for path in root.glob(pattern):
                candidates = path.rglob('*') if path.is_dir() else [path]
                for candidate in candidates:
                    confined(root, candidate.relative_to(root))
                    if candidate.is_file():
                        value = candidate.stat()
                        if not stat.S_ISREG(value.st_mode):raise ValueError('Nonregular retained file')
                        name=str(candidate.relative_to(root))
                        if name not in protected:
                            backup=Path(spool.name)/str(len(protected))
                            shutil.copyfile(candidate,backup)
                            protected[name] = (backup, value)
    except BaseException:
        spool.cleanup()
        raise
    try:
        platform = 'windows' if game=='front' and env.get('WINDOWS_INSTALL','0')=='1' else info['platform']
        if game=='front':update(root,1007,env=env,platform=platform,force_platform=True)
        result = update(root, info['app'], env=env, platform=platform, force_platform=True)
        if not any(path.endswith('.exe')==(platform=='windows') and confined(root, path).is_file() for path in info['binaries']):
            raise ValueError('Publisher installation lacks a reviewed dedicated binary')
        for path in info['binaries']:
            binary = confined(root, path)
            if binary.is_file() and info['platform']=='linux':binary.chmod(binary.stat().st_mode | 0o100)
        if game == 'abiotic' or platform=='windows':
            from enshrouded_proton import provision
            provision(root)
        return result
    finally:
        for name, (backup, saved) in protected.items():
            confined(root, name)
            def restore(output, backup=backup):
                with backup.open('rb') as source:shutil.copyfileobj(source,output)
            _publish(root, name, restore, stat.S_IMODE(saved.st_mode))
            target = root / name
            if os.geteuid()==0:os.chown(target, saved.st_uid, saved.st_gid)
            target.chmod(stat.S_IMODE(saved.st_mode))
        spool.cleanup()


if __name__ == '__main__':install(Path.cwd(), sys.argv[1])
