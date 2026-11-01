#!/usr/bin/env python3
"""Enhanced-only entry point. Shared legacy implementation remains untouched."""
import importlib.util
import os
from pathlib import Path
import sys
import time


def load_shared():
    path = Path(__file__).with_name('conan_empires.py')
    if not path.exists():
        path = path.with_name('conan-empires.py')
    spec = importlib.util.spec_from_file_location('enhanced_shared', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shared = load_shared()
patch_ini = shared.native.patch_ini


def enhanced_ini(before, sections):
    return patch_ini(before, sections, case_insensitive=True)


def documents(root, plan):
    result = []
    for name, sections in plan['configs'].items():
        path = shared.confined(root, name)
        raw = path.read_bytes() if path.exists() else b''
        before = raw.decode('utf-8-sig')
        after = enhanced_ini(before, sections)
        if raw.startswith(b'\xef\xbb\xbf'):
            before = '\ufeff' + before
            after = '\ufeff' + after
        result.append((path, before, after))
    return result


def configure(root, game, env):
    if game != 'enhanced':
        raise ValueError('Enhanced writer cannot configure another flavor')
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
    # Only the reviewed public Enhanced depot is allowed. Never feed UE4 to Linux.
    if env.get('SRCDS_BETAID', '').strip() not in ('', 'public'):
        raise ValueError('Enhanced requires the public Linux depot; legacy/private branches require a separate recipe review')
    shared.steam_options(root, 'enhanced', env)
    shared.ids(shared.text(env, 'MOD_IDS'))
    plan = shared.configure_plan(root, 'enhanced', env)
    # Validate every managed document before acquisition or the first write.
    documents(root, plan)
    return plan


def main():
    if sys.argv[1:] not in (['install', 'enhanced'], ['run', 'enhanced']):
        raise ValueError('Enhanced entry point accepts only install/run enhanced')
    preflight(Path.cwd().resolve(), dict(os.environ))
    # This module instance is private to the Enhanced process, including its writer.
    shared.configure = configure
    return shared.main()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'Enhanced operation failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
