"""MIT. Portal-only native-file authority; staged, not activated."""
import copy
import json
import os
from pathlib import Path
import sys
from fantasy_worlds_runtime import confined, read_json, portal_save_path, text, integer, boolean, defaults, update_file


def plan(root, env):
    """Read-only preflight. Existing files are never serialized or patched."""
    root = root.resolve()
    if env.get('PORTAL_INSTALL_MODE', 'steam') != 'uploaded':
        raise ValueError('Private Steam acquisition is unverified; use legally uploaded publisher files')
    if str(env.get('SRCDS_APPID', '374040')) != '374040':
        raise ValueError('Portal requires its original licensed client AppID')
    port = integer(env.get('SERVER_PORT', ''), 1025, 65535)
    if env.get('WINEARCH', 'win64') not in ('win32', 'win64'):
        raise ValueError('Unsupported private Wine architecture')
    text(env.get('WINEDEBUG', '-all'), 64)
    boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1')))
    if env.get('EXTRA_FLAGS', ''):
        raise ValueError('Arbitrary Steam flags are unsupported')
    from steam_template import arguments
    arguments(root, 374040, {key: value for key, value in env.items() if key not in ('STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')}, platform='windows')
    path = confined(root, 'dedicated_server/server_config.json')
    value = read_json(path) if path.exists() else copy.deepcopy(defaults()['portal'])
    if not path.exists():
        value['basicServerData'].update(name=text(env.get('SERVER_NAME', 'Servername'), 32), port=port)
        value.update(gameplayMode=env.get('GAMEMODE', 'Adventure'), universeSize=env.get('UNIVERSE_SIZE', 'Normal'))
        for role, key, default in [('admins', 'ADMIN_PASS', 'admin_password_please_change'), ('users', 'USER_PASS', ''), ('guests', 'GUEST_PASS', '')]:
            value[role]['credentials']['password'] = text(env.get(key, default), 64)
    basic = value['basicServerData']
    text(basic['name'], 32)
    if type(basic['port']) is not int or basic['port'] != port or basic['ipv4'] != '0.0.0.0':
        raise ValueError('Native bind must match allocation; reconcile through Files while stopped')
    if value.get('hideConsoleWindow') is not False:
        raise ValueError('Private console requires hideConsoleWindow=false; review native file while stopped')
    if value.get('gameplayMode', 'Adventure') not in ('Adventure', 'Creative') or value['universeSize'] not in ('Small', 'Normal', 'Large'):
        raise ValueError('Unsupported native mode or universe size')
    portal_save_path(root, value)
    for role in ('admins', 'users', 'guests'):
        text(value[role]['credentials']['password'], 64)
        for key in ('canLogin', 'canKickPlayers', 'canModifyWorld', 'canInteractWithLockables'):
            if type(value[role][key]) is not bool:
                raise ValueError('Role permissions must be JSON booleans')
    return path, None if path.exists() else (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()


def start(root, env, installer, runner):
    plan(root, env)  # Before update, dependency acquisition, or state writes.
    if boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'))):
        installer(root, 'portal', env, validate=False)
    path, seed = plan(root, env)  # Revalidate files delivered by installer.
    if seed is not None:
        update_file(root, path, seed)
    blocked = {'STEAM_USER', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS', 'ADMIN_PASS', 'USER_PASS', 'GUEST_PASS', 'PYTHONPATH', 'PYTHONHOME', 'LD_PRELOAD'}
    clean = {key: value for key, value in env.items() if key not in blocked}
    clean.update(HOME=str(root), WINEPREFIX=str(confined(root, '.wine')), XVFB='0')
    return runner(root, clean)


if __name__ == '__main__':
    try:
        from fantasy_worlds_install import install
        from fantasy_worlds_wine import run
        os.umask(0o077)
        if '--preflight' in sys.argv:
            plan(Path.cwd().resolve(), dict(os.environ))
            sys.exit(0)
        sys.exit(start(Path.cwd().resolve(), dict(os.environ), install, run))
    except Exception:
        print('Portal preflight/start failed; check native configuration, allocation and legal uploaded payload. No credentials are logged.', file=sys.stderr)
        sys.exit(1)
