#!/usr/bin/env python3
"""Legacy-only entry point. Shared legacy implementation remains untouched."""
import importlib.util
import os
from pathlib import Path
import sys
import time


def load_shared():
    path = Path(__file__).with_name('conan_empires.py')
    if not path.exists():
        path = path.with_name('conan-empires.py')
    spec = importlib.util.spec_from_file_location('legacy_shared', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shared = load_shared()
patch_ini = shared.native.patch_ini


def legacy_ini(before, sections):
    return patch_ini(before, sections, case_insensitive=True)


def documents(root, plan):
    result = []
    for name, sections in plan['configs'].items():
        path = shared.confined(root, name)
        raw = path.read_bytes() if path.exists() else b''
        before = raw.decode('utf-8-sig')
        after = legacy_ini(before, sections)
        if raw.startswith(b'\xef\xbb\xbf'):
            before = '\ufeff' + before
            after = '\ufeff' + after
        result.append((path, before, after))
    return result


def configure(root, game, env):
    if game != 'conan':
        raise ValueError('Legacy writer cannot configure another flavor')
    preflight(root, env)
    plan = shared.configure_plan(root, game, env)
    prepared = documents(root, plan)
    for path, before, after in prepared:
        for match in shared.re.finditer(r'(?mi)^\s*(?:ServerPassword|AdminPassword|RconPassword)\s*=\s*([^\r\n]+)', before):
            plan['credentials'] += [match[1], match[1].strip('"')]
        if after != before:
            if before:
                backup = shared.confined(root, '.voltra/conan-empires/config-backups/' + str(time.time_ns()) + '-' + path.name)
                shared.native.private_write(backup, before)
            shared.native.private_write(path, after)
        else:
            path.chmod(0o600)
    return plan


def preflight(root, env):
    # Refuse the public UE5 depot; keep the original blank control default visible.
    if env.get('SRCDS_BETAID', '').strip() != 'conan-exiles-legacy':
        raise ValueError('Legacy requires explicit SRCDS_BETAID=conan-exiles-legacy; public is UE5 and cannot be substituted')
    shared.steam_options(root, 'conan', env)
    plan = shared.configure_plan(root, 'conan', env)
    # Validate every managed document before acquisition or the first write.
    documents(root, plan)
    return plan


def main():
    if sys.argv[1:] not in (['install', 'conan'], ['run', 'conan']):
        raise ValueError('Legacy entry point accepts only install/run conan')
    preflight(Path.cwd().resolve(), dict(os.environ))
    # This module instance is private to the Legacy process, including its writer.
    shared.configure = configure
    return shared.main()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Legacy operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
