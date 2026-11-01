#!/usr/bin/env python3
"""MIT. CS2-specific persistent gameplay configuration and native lifecycle."""
import os
from pathlib import Path
import threading
import source_third_runtime as shared
from source_runtime import private_write

NATIVE = 'voltra-native.cfg'
DEFAULT = '// CS2 gameplay settings. Startup controls own identity, ports and credentials.\nsv_cheats 0\nmp_friendlyfire 0\nmp_autoteambalance 1\nmp_limitteams 2\n'


def configuration_destinations(root, env):
    if env.get('VOLTRA_SOURCE_THIRD') != 'cs2':
        raise ValueError('CS2 adapter requires its exact recipe')
    root = Path(root).resolve()
    native = root / 'game/csgo/cfg' / NATIVE
    if native.is_symlink() or not native.resolve().is_relative_to(root):
        raise ValueError('CS2 native settings must remain inside the server volume')
    # Even an in-volume parent alias can redirect writes into another operator
    # directory. Do not claim file authority through symlinked ancestors.
    for parent in native.parents:
        if parent == root:
            break
        if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)() or parent.exists() and not parent.is_dir():
            raise ValueError('CS2 configuration parents must be real directories')
    # Refuse every non-file destination before the shared configurator writes
    # managed identity/credential files. Existing files stay operator-owned.
    for target in (native, native.with_name('server.cfg'),
                   native.with_name('voltra-managed.cfg'), native.with_name('voltra-server.cfg')):
        if target.is_symlink() or not target.resolve().is_relative_to(root) or target.exists() and not target.is_file():
            raise ValueError('CS2 configuration destinations must be regular files inside this volume')
    return root, native


def configure(root, env):
    root, native = configuration_destinations(root, env)
    # Validate all startup controls before creating any configuration.
    argv, environment, query = shared.configure(root, env)
    if not native.exists():
        private_write(native, DEFAULT)
    elif not native.is_file():
        raise ValueError('CS2 native settings must be a regular file')
    # Both initial launch and subsequent map loads execute the persistent file.
    private_write(native.with_name('voltra-server.cfg'),
                  'exec server.cfg\nexec voltra-managed.cfg\nexec ' + NATIVE + '\n')
    index = argv.index('+map')
    argv[index:index] = ['+exec', NATIVE]
    return argv, environment, query


def main(root, env):
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'):
        raise ValueError('Automatic updates must be 0 or 1')
    if env.get('VOLTRA_SOURCE_THIRD') != 'cs2':
        raise ValueError('CS2 adapter requires its exact recipe')
    # Refuse redirected or invalid destinations before any automatic Steam
    # update can acquire content or restore protected configuration there.
    configuration_destinations(root, env)
    if automatic == '1':
        shared.install(root, env, validate=False)
    argv, environment, query = configure(root, env)
    cancel = threading.Event()
    def emit(marker, **kwargs):
        if not cancel.is_set():
            print('VOLTRA_SOURCE_THIRD_MAP_READY', flush=True)
    observer = threading.Thread(target=shared.source_l4d.query_ready,
                                args=(*query, cancel), kwargs={'emit': emit}, daemon=True)
    started = False
    def output(data):
        nonlocal started
        if data and not started and not cancel.is_set():
            started = True
            observer.start()
    credentials = tuple(env.get(key, '') for key in (
        'SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_GSLT', 'STEAM_PASS',
        'STEAM_AUTH', 'SRCDS_BETAPASS'))
    try:
        return shared.run(root, argv, environment, 'quit', credentials,
                          terminal_input=True, output_observer=output)
    finally:
        cancel.set()
        if started:
            observer.join(timeout=1)


if __name__ == '__main__':
    raise SystemExit(main(Path.cwd(), dict(os.environ)))
