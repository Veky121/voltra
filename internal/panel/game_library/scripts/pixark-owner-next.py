#!/usr/bin/env python3
"""PixARK-only preflight and native-file authority. Shared adapters remain unchanged."""
import importlib.util
import os
from pathlib import Path
import re
import shutil
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('pixark_family', Path(__file__).with_name('ark-family.py'))
family = importlib.util.module_from_spec(spec)
spec.loader.exec_module(family)
CONFIG = 'ShooterGame/Saved/PteroPixArk/Config/WindowsServer/GameUserSettings.ini'
FIELDS = {('serversettings', 'serveradminpassword'): 'ARK_ADMIN_PASSWORD',
          ('serversettings', 'serverpassword'): 'ARK_PASSWORD',
          ('/script/engine.gamesession', 'maxplayers'): 'MAX_PLAYERS',
          ('sessionsettings', 'sessionname'): 'SRV_NAME'}


def native_environment(root, env):
    result = dict(env)
    path = family.confined(root, CONFIG)
    if not path.exists():
        return result
    content = path.read_bytes().decode('utf-8-sig')
    section, seen = '', set()
    for line in content.splitlines():
        header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?', line)
        if header:
            section = header[1].casefold()
        elif not line.lstrip().startswith((';', '#')) and '=' in line:
            key, value = line.split('=', 1)
            identity = (section, key.strip().casefold())
            if identity in FIELDS:
                if identity in seen:
                    raise ValueError('Ambiguous PixARK native setting; retained unchanged')
                seen.add(identity)
                result[FIELDS[identity]] = value.strip()
    return result


def preflight(root, env, require_binary=False):
    # All checks here are read-only, including Wine prerequisite checks.
    effective = native_environment(root, env)
    plan = family.build(root, 'pixark', effective)
    # Refuse unsafe managed destinations before package or Steam acquisition.
    for name in ('.voltra', '.voltra/python', '.voltra/ark_family.py',
                 '.voltra/native_config.py', '.voltra/steam_template.py',
                 '.voltra/bundle_debian_python.py', '.voltra/pixark_owner_next.py'):
        path = family.confined(root, name)
        if path.exists() and (path.is_dir() != (name in ('.voltra', '.voltra/python'))):
            raise ValueError('Invalid PixARK managed helper path')
    for key, default, maximum in (('WINEDEBUG', '-all', 100), ('WINEPATH', '/home/container', 200)):
        family.text(effective, key, default, maximum)
    saved = family.confined(root, 'ShooterGame/Saved')
    if saved.exists():
        for path in saved.rglob('*.ini'):
            family.confined(root, path.relative_to(root))
    app, platform, binary, options = family.steam_options('pixark', effective)
    family.steam.arguments(root, app, options, platform=platform, force_platform=True)
    if family.text(effective, 'WINEARCH', 'win64') != 'win64':
        raise ValueError('PixARK requires win64')
    requested = family.text(effective, 'VOLTRA_ARK_WINETRICKS_RUN', effective.get('WINETRICKS_RUN', 'vcrun2019 dotnet6'))
    prefix = family.confined(root, '.voltra/ark/pixark-prefix')
    if requested and (not family.boolean(effective, 'WINE_PREREQUISITES_READY') or not family.confined(root, '.voltra/ark/pixark-prefix/system.reg').is_file()):
        raise ValueError('Prepare the private PixARK Wine prerequisites and explicitly confirm readiness before install/update')
    if not shutil.which('wine'):
        raise ValueError('PixARK Wine runtime is missing before install/update')
    if require_binary and not plan['binary'].is_file():
        raise ValueError('PixARK dedicated binary missing')
    return effective, plan


def configure(root, env):
    effective = native_environment(root, env)
    plan = family.build(root, 'pixark', effective)
    path = family.confined(root, CONFIG)
    if not path.exists():
        family.native.private_write(path, family.native.patch_ini('', plan['sections']))
    # Existing files, including unknown/duplicate rows, BOM and mode, are untouched.
    # Identity/password/player argv are derived from that file. Listener roles stay runtime-owned.
    return plan


def main():
    action, = sys.argv[1:]
    if action not in ('preflight', 'install', 'run'):
        raise ValueError('Unknown PixARK action')
    root = Path.cwd().resolve()
    env, plan = preflight(root, dict(os.environ))
    if action == 'preflight':
        return 0
    if action == 'install':
        family.install(root, 'pixark', env)
        return 0
    if family.boolean(env, 'VOLTRA_STEAM_AUTO_UPDATE', True):
        family.install(root, 'pixark', env)
    # Binary existence is required before config seeding or prefix mutation.
    if not plan['binary'].is_file():
        raise ValueError('PixARK dedicated binary missing')
    child_env = family.environment(root, 'pixark', env)
    return family.run(root, 'pixark', configure(root, env), child_env)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else 'PixARK failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
