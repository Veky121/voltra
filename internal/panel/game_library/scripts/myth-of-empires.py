#!/usr/bin/env python3
"""MoE-only preflight and update retention. Does not activate a panel."""
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile

path = Path(__file__).with_name('conan_empires.py')
if not path.exists():
    path = path.with_name('conan-empires.py')
spec = importlib.util.spec_from_file_location('moe_shared', path)
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
original_install = shared.install


def preflight(root, env):
    shared.steam_options(root, 'empires', env)
    plan = shared.configure_plan(root, 'empires', env)
    if any(not 1024 <= port <= 65535 for port in plan['ports'].values()):
        raise ValueError('MoE listener ports must be between 1024 and 65535, including automatically selected allocations')
    if not shared.boolean(env, 'MOE_EULA_ACCEPTED', False):
        raise ValueError('Review the Myth of Empires EULA and explicitly set MOE_EULA_ACCEPTED=1 before acquisition or startup; no agreement is accepted automatically')
    return plan


def protected_files(root):
    # Preserve complete native Saved state and publisher tool/operator configs.
    # Do not parse/re-serialize INI arrays, databases, worlds or credentials.
    result = []
    for name in ('MOE/Saved', 'PrivateServerTool'):
        base = shared.confined(root, name)
        if not base.exists():
            continue
        for current, dirs, files in os.walk(base, followlinks=False):
            for entry in dirs + files:
                candidate = Path(current) / entry
                if candidate.is_symlink():
                    raise ValueError('MoE protected data contains a link; review it before updating')
                shared.confined(root, str(candidate.relative_to(root)))
            result.extend(Path(current) / entry for entry in files)
    return result


def install(root, game, env):
    if game != 'empires':
        raise ValueError('MoE wrapper cannot install another game')
    preflight(root, env)
    files = protected_files(root)
    size = sum(path.stat().st_size for path in files)
    if shutil.disk_usage(root).free < size + 1024**3:
        raise ValueError('Insufficient free disk for MoE protected-data backup plus 1 GiB reserve')
    with tempfile.TemporaryDirectory(prefix='.voltra-moe-retention-', dir=root) as directory:
        os.chmod(directory, 0o700)
        backups = []
        for index, source in enumerate(files):
            backup = Path(directory) / str(index)
            shutil.copy2(source, backup)
            backups.append((source.relative_to(root), backup))
        try:
            original_install(root, game, env)
        finally:
            for name, backup in backups:
                target = shared.confined(root, str(name))
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(backup, target)


def main():
    if sys.argv[1:] not in (['install', 'empires'], ['run', 'empires']):
        raise ValueError('MoE wrapper accepts only install/run empires')
    preflight(Path.cwd().resolve(), dict(os.environ))
    shared.install = install
    return shared.main()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'MoE operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
