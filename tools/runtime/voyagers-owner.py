"""Voyagers-only adapter. Native settings own subsequent starts; no game acquisition here."""
import os
from pathlib import Path
import sys
import ocean_space_servers as shared

CONFIG = 'BoatGame/Saved/PersistedData/CustomConfig/CustomHostServerUserSettings.ini'
SECTION = '/Script/BoatGame.BGCustomHostServerSettings'
KEYS = ('HostServerDisplayName', 'HostServerPassword', 'MaxPlayers', 'AutosaveTimerSeconds')
_install = shared.install


def preflight(root, env):
    root = Path(root).resolve()
    shared.primary(env)
    if env.get('SRCDS_APPID', '3937860') != '3937860':
        raise ValueError('Dedicated application identity is fixed')
    if env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Windows dedicated payload required')
    shared.arguments(root, 3937860, env, True, platform='windows')
    shared.boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1')))
    shared.wine_environment(root, 'voyagers', env)
    values = dict(zip(KEYS, (
        shared.text(env.get('SERVER_NAME', 'A Pterodactyl Hosted Server'), 50),
        shared.text(env.get('SERVER_PASSWORD', '')),
        str(shared.integer(env.get('MAX_PLAYERS', '10'), 1, 10)),
        str(shared.integer(env.get('AUTOSAVE_TIMER_SECONDS', '300'), 10, 900)))))
    # Reject INI comment/quote syntax whose native interpretation is unproven.
    if any(c in values[k] for k in KEYS[:2] for c in ';#"'):
        raise ValueError('Unsupported native INI text syntax')
    path = shared.confined(root, CONFIG)
    if path.exists():
        if not path.is_file() or path.stat().st_size > 8 * 1024**2:
            raise ValueError('Unsupported native settings file')
        content = path.read_bytes().decode('utf-8')
        shared.native.resolve_ini_identities(content.lstrip('\ufeff'), {SECTION: values})
        # Parse-only ambiguity validation. Never publish a normalized copy.
        shared.native.patch_ini(content, {SECTION: values}, case_insensitive=True)
    return path, values


def configure(root, game, env):
    if game != 'voyagers':
        raise ValueError('Voyagers-only adapter')
    path, values = preflight(root, env)
    if not path.exists():
        shared.private_bytes(path, shared.native.patch_ini('', {SECTION: values}).encode('utf-8'))


def install(root, game, env):
    preflight(root, env)
    return _install(root, game, env)


def main(action, root, env):
    preflight(root, env)
    shared.configure = configure
    shared.install = install
    if action == 'install':
        return install(root, 'voyagers', env)
    if action == 'run':
        return shared.launch(root, 'voyagers', env)
    raise ValueError('Unknown operation')


if __name__ == '__main__':
    result = main(sys.argv[1], Path.cwd(), dict(os.environ))
    if isinstance(result, int):
        sys.exit(result)
