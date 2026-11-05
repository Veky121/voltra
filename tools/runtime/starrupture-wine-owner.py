"""MIT. Exact StarRupture Wine adapter; native files remain authoritative."""
import os
from pathlib import Path
import signal
import sys
import ocean_space_servers as shared

CONFIG = 'DSSettings.txt'
_install = shared.install

def preflight(root, env):
    root = Path(root).resolve()
    shared.primary(env)
    if env.get('SRCDS_APPID', '3809400') != '3809400' or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Original Windows dedicated application identity is fixed')
    shared.arguments(root, 3809400, env, True, platform='windows')
    shared.boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1')))
    shared.password_prerequisites(root, env)
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Explicit Windows runtime license acceptance required before acquisition')
    verbs = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'vcrun2022'))
    if verbs.split() != ['vcrun2022'] or env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('Original win64 vcrun2022 runtime required')
    for key, default in [('WINEPREFIX', str(root/'.wine')), ('WINEPATH', str(root))]:
        path = Path(env.get(key, default))
        if not path.is_absolute(): raise ValueError('Private absolute Wine path required')
        shared.confined(root, str(path))
    registry = shared.confined(root, str(Path(env.get('WINEPREFIX', str(root/'.wine')))/'system.reg'))
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix preserved; win64 required')
    shared.text(env.get('WINEDEBUG', '-all'), 32)
    session, save = shared.text(env.get('SESSION_NAME', 'StarRuptureServer')), shared.text(env.get('SAVEGAME_NAME', 'AutoSave0.sav'))
    if any(c in session+save for c in '/\\') or session in ('.','..') or save in ('.','..'):
        raise ValueError('Session/save must remain in native directory')
    values = dict(SessionName=session, SaveGameInterval=str(shared.integer(env.get('SAVE_INTERVAL','300'),0)), StartNewGame=str(shared.boolean(env.get('START_NEW','false'))).lower(), LoadSavedGame=str(shared.boolean(env.get('LOAD_SAVE','true'))).lower(), SaveGameName=save)
    path = shared.confined(root, CONFIG)
    if path.exists(): shared.read_json(path)
    shared.confined(root, '.pteroignore')
    for name in shared.PRESERVE['starrupture']:
        protected = shared.confined(root, name)
        if protected.is_dir():
            for item in protected.rglob('*'):
                shared.confined(root, str(item))
                if not item.is_file() and not item.is_dir(): raise ValueError('Unsupported operator entry')
    return path, values

def configure(root, game, env):
    if game != 'starrupture': raise ValueError('Wine-only StarRupture adapter')
    path, values = preflight(root, env)
    if not path.exists(): shared.write_json(path, values)
    ignore = shared.confined(Path(root).resolve(), '.pteroignore')
    if not ignore.exists(): shared.private_bytes(ignore, shared.IGNORE.encode())

def install(root, game, env):
    preflight(root, env)
    return _install(root, game, env)

def main(action, root, env):
    if action not in ('install','run'): raise ValueError('Unknown operation')
    preflight(root, env)
    shared.configure = configure
    shared.install = install
    if action == 'install': return install(root, 'starrupture', env)
    configure(root, 'starrupture', env)
    if shared.boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'))): install(root,'starrupture',env)
    child = shared.wine_environment(root,'starrupture',env)
    # -Log already delivers native stdout. Do not also tail the same log.
    return shared.console.run(root, shared.command(root,'starrupture',env), child, '^C', credentials=tuple(env.get(k,'') for k in ('ADMIN_PASSWORD','PLAYER_PASSWORD')), stop_signal=signal.SIGINT)

if __name__ == '__main__':
    result=main(sys.argv[1],Path.cwd(),dict(os.environ))
    if isinstance(result,int): sys.exit(result)
