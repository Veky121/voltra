"""NOTD-only entry point. Validate before acquisition or managed config writes."""
import importlib.util
import os
from pathlib import Path
import sys

def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

adapter = load('wasteland-servers')
ini = load('notd-ini')

ACTIVE_INI = 'LF/Saved/Config/ServerSettings.ini'

def seed_bytes(root, name, default):
    target = adapter.path(root, name)
    # The publisher batch copies the root template here. Direct launch skips
    # that batch: retain the active copy, using the template only for first seed.
    source = target
    if not target.exists() and name == ACTIVE_INI:
        template = adapter.path(root, 'ServerSettings.ini')
        if template.exists():
            source = template
    if source.exists():
        if not source.is_file() or source.stat().st_size > 8*1024**2:
            raise ValueError('NOTD INI must be a bounded regular file')
        return source.read_bytes()
    return default.encode()

def ini_plan(root, name, sections, default=''):
    previous = seed_bytes(root, name, default)
    bom = b'\xef\xbb\xbf' if previous.startswith(b'\xef\xbb\xbf') else b''
    return name, bom + ini.patch(previous.decode('utf-8-sig'), sections).encode()

adapter.ini_plan = ini_plan

original_install = adapter.install

def install(root, game, env):
    original_write = adapter.write
    def seed_write(root, name, data):
        if name == ACTIVE_INI and not adapter.path(root, name).exists():
            data = seed_bytes(root, name, data.decode('utf-8-sig'))
            # Validate encoding before publishing any template bytes.
            data.decode('utf-8-sig')
        return original_write(root, name, data)
    try:
        adapter.write = seed_write
        return original_install(root, game, env)
    finally:
        adapter.write = original_write

adapter.install = install

def preflight(root, env):
    root = Path(root).resolve()
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Explicit Microsoft/font runtime licence acceptance required before acquisition')
    adapter.choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ['0', '1'])
    if env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('NOTD requires win64')
    prefix = adapter.shared.confined(root, Path(env.get('WINEPREFIX', str(root / '.wine'))))
    if not prefix.is_absolute():
        raise ValueError('Private absolute Wine prefix required')
    registry = adapter.shared.confined(root, prefix / 'system.reg')
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix preserved')
    adapter.shared.confined(root, Path(env.get('WINEPATH', str(root))))
    verbs = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022 corefonts')).split()
    if not verbs or len(set(verbs)) != len(verbs) or any(v not in ('vcrun2022', 'corefonts') for v in verbs):
        raise ValueError('Unsupported NOTD prerequisite')
    adapter.text(env, 'WINEDEBUG', '-all', 32)
    # Reuse the complete existing control validation without publishing its plan.
    original = adapter.write
    try:
        adapter.write = lambda *args: None
        adapter.configure(root, 'night', env)
    finally:
        adapter.write = original

def execute(action, root, env):
    if action not in ('install', 'run'):
        raise ValueError('Expected install or run')
    preflight(root, env)
    if action == 'install':
        adapter.install(root, 'night', env)
        return 0
    return adapter.run(root, 'night', env)

if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Expected one action')
        sys.exit(execute(sys.argv[1], Path.cwd(), dict(os.environ)))
    except (ValueError, OSError):
        print('NOTD preflight/runtime failed; check configuration and prerequisites.', file=sys.stderr)
        sys.exit(2)
