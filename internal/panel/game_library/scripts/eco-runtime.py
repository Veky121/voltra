#!/usr/bin/env python3
"""Eco-only adapter. Native configuration owns settings after first setup."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import shutil
import tempfile


def adapter():
    spec = importlib.util.spec_from_file_location('eco_shared', Path(__file__).with_name('automation-sims.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def prerequisites(base, env):
    base.options('eco', env)
    base.shared.roles(env, ['WEB_PORT', 'RCON_PORT'])
    if not base.text(env, 'SLG_USER', '', 255) or not base.text(env, 'SLG_PW', '', 4096):
        raise ValueError('Publisher entitlement credentials required')


@contextlib.contextmanager
def preserve_storage(base, root):
    # Shared preservation does not always protect publisher-manifest .eco saves.
    names = ['Storage']
    config = base.shared.confined(root, root / 'Configs/Storage.eco')
    if config.exists():
        settings = base.shared.json_unique(config.read_text(encoding='utf-8-sig'))
        if not isinstance(settings, dict):
            raise ValueError('Expected publisher storage JSON object')
        directory = settings.get('StorageDirectory', 'Storage')
        if not isinstance(directory, str) or not directory or Path(directory).is_absolute() or ':' in directory or '\\' in directory:
            raise ValueError('Storage directory must remain in the server volume')
        names.append(directory)
    targets = {base.shared.confined(root, root / name) for name in names}
    if root in targets:
        raise ValueError('Storage cannot be the installation root')
    # Validate all paths before the updater can mutate anything.
    for target in targets:
        if target.exists():
            if not target.is_dir():
                raise ValueError('Storage must be a directory')
            for path in target.rglob('*'):
                base.shared.confined(root, path)
                if path.is_symlink() or not (path.is_file() or path.is_dir()):
                    raise ValueError('Unsupported storage entry')
    with tempfile.TemporaryDirectory(prefix='voltra-eco-preserve-') as temp:
        snapshots = []
        for index, target in enumerate(sorted(targets)):
            if target.exists():
                backup = Path(temp) / str(index)
                shutil.copytree(target, backup)
                metadata = [(p.relative_to(target), p.stat().st_uid, p.stat().st_gid)
                            for p in [target, *target.rglob('*')]]
                snapshots.append((target, backup, metadata))
        try:
            yield
        finally:
            for target, backup, metadata in snapshots:
                base.shared.confined(root, target)
                for path in backup.rglob('*'):
                    base.shared.confined(root, target / path.relative_to(backup))
                shutil.copytree(backup, target, dirs_exist_ok=True)
                # copy2 retains mode/times but not Unix ownership. Reinstall runs
                # as root, so restore the operator's UID/GID explicitly.
                if hasattr(os, 'chown'):
                    for relative, uid, gid in metadata:
                        restored = base.shared.confined(root, target / relative)
                        info = restored.stat()
                        if (info.st_uid, info.st_gid) != (uid, gid):
                            os.chown(restored, uid, gid, follow_symlinks=False)


def install(root, env):
    base = adapter()
    root = Path(root).resolve()
    prerequisites(base, env)
    network = base.shared.confined(root, root / 'Configs/Network.eco')
    fresh = not network.exists()
    with preserve_storage(base, root):
        base.install(root, 'eco', env)
    if fresh:
        base.native.private_write(base.shared.confined(root, root / '.voltra/eco-setup-pending'), '1\n')


def configure(root, env):
    base = adapter()
    root = Path(root).resolve()
    base.options('eco', env)
    ports = base.shared.roles(env, ['WEB_PORT', 'RCON_PORT'])
    user, password = base.text(env, 'SLG_USER', '', 255), base.text(env, 'SLG_PW', '', 4096)
    if not user or not password:
        raise ValueError('Publisher entitlement credentials required')
    pending = base.shared.confined(root, root / '.voltra/eco-setup-pending')
    if pending.exists():
        result = base.configure(root, 'eco', env)
        pending.unlink()
        return result
    # Existing installations and later starts use native files, including new
    # publisher settings/modes absent from the original egg's dropdown choices.
    paths = [base.shared.confined(root, root / name) for name in
             ('Configs/Network.eco', 'Configs/Localization.eco')]
    network, localization = [base.shared.json_unique(p.read_text(encoding='utf-8-sig')) for p in paths]
    if not isinstance(network, dict) or not isinstance(localization, dict):
        raise ValueError('Expected publisher JSON objects')
    network.update(GameServerPort=ports['primary'], WebServerPort=ports['WEB_PORT'], RconServerPort=ports['RCON_PORT'])
    base.shared.write_config(root, paths[0], json.dumps(network, ensure_ascii=False, indent=2) + '\n')
    return [str(root / 'EcoServer'), '--username=' + user, '--password=' + password], [
        user, password, str(network.get('Password', '')), str(network.get('RconPassword', ''))]


def run(root, env):
    base = adapter()
    # Validate credentials and allocation ownership before an optional update.
    if not base.text(env, 'SLG_USER', '', 255) or not base.text(env, 'SLG_PW', '', 4096):
        raise ValueError('Publisher entitlement credentials required')
    base.shared.roles(env, ['WEB_PORT', 'RCON_PORT'])
    auto = base.choice({'AUTO_UPDATE': env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))}, 'AUTO_UPDATE', '1', ('0', '1'))
    if auto == '1':
        install(root, env)
    argv, secrets = configure(root, env)
    environment = dict(env)
    for key in ('PYTHONHOME', 'PYTHONPATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'SLG_USER', 'SLG_PW'):
        environment.pop(key, None)
    environment['HOME'] = str(root)
    code = base.helper('native-console').run(root, argv, environment, 'exit', secrets, terminal_input=True)
    return code if code >= 0 else 128 - code


if __name__ == '__main__':
    try:
        root = Path.cwd()
        if sys.argv[1] == 'install':
            install(root, dict(os.environ))
        elif sys.argv[1] == 'run':
            sys.exit(run(root, dict(os.environ)))
        else:
            raise ValueError('Unknown Eco action')
    except (ValueError, OSError, KeyError):
        print('Eco setup failed; check native JSON, allocations and publisher entitlement. Credentials withheld.', file=sys.stderr)
        sys.exit(1)
