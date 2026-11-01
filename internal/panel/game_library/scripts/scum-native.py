#!/usr/bin/env python3
"""SCUM-only native-file authority. MIT; shared acquisition and supervisor unchanged."""
import importlib.util
import os
from pathlib import Path
import re
import sys

def load():
    spec = importlib.util.spec_from_file_location('scum_zombie', Path(__file__).with_name('zombie-native.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

z = load()
RELATIVE = 'SCUM/Saved/Config/WindowsServer/ServerSettings.ini'

def preflight(root, env):
    z.steam.arguments(root, 3792580, env, platform='windows', force_platform=True)
    if env.get('SRCDS_APPID', '3792580') != '3792580':
        raise ValueError('Wrong SCUM dedicated application')
    if env.get('WINETRICKS_RUN', '') != '':
        raise ValueError('Unreviewed SCUM runtime verbs are unsupported')
    z.boolean(env, 'AUTO_UPDATE', '1'); z.boolean(env, 'XVFB')
    z.text(env, 'WINEDEBUG', '-all', 20)
    ports = z.ports(env, [('QUERY_PORT', 27015)])
    players = z.integer(env, 'MAX_PLAYERS', 64, 1, 10000)
    style = z.text(env, 'SERVER_PLAYSTYLE', 'PVP', 3)
    if style not in ('PVP', 'PVE'): raise ValueError('Invalid SCUM playstyle')
    settings = dict(zip(('scum.ServerName','scum.ServerDescription','scum.ServerPassword','scum.ServerPlaystyle'),
        (z.text(env,'SERVER_NAME','A Pterodactyl Hosted Server',50), z.text(env,'SERVER_DESCRIPTION','A Pterodactyl Hosted Server'), z.text(env,'SERVER_PASSWORD','',30), style)))
    path = z.confined(root, root / RELATIVE)
    if path.exists():
        if not path.is_file() or path.stat().st_size > 8*1024**2: raise ValueError('Invalid SCUM native settings file')
        # Parse for ambiguity without publishing. Existing bytes remain authoritative.
        content = path.read_text(encoding='utf-8-sig')
        seen = set(); section = ''
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith((';','#')): continue
            if stripped.startswith('['):
                if not re.fullmatch(r'\[[^\[\]]+\]', stripped): raise ValueError('Malformed INI section')
                section = stripped[1:-1].casefold()
            elif '=' in line and section == 'general':
                key = line.split('=',1)[0].strip().casefold()
                if key in {k.casefold() for k in settings}:
                    if key in seen: raise ValueError('Ambiguous SCUM native setting')
                    seen.add(key)
    return ports, players, settings

def configure(root, game, env):
    ports, players, settings = preflight(root, env)
    binary = z.confined(root, root / z.GAMES['scum'][2])
    if not binary.is_file(): raise ValueError('Missing SCUM dedicated executable')
    path = root / RELATIVE
    if not path.exists():
        z.publish(root, RELATIVE, z.native.patch_ini('', {'General': settings}).encode())
    # No native configuration value is overwritten on subsequent starts.
    secrets = [env.get('SERVER_PASSWORD','')]
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        if '=' in line and line.split('=',1)[0].strip().casefold() == 'scum.serverpassword': secrets.append(line.split('=',1)[1].strip())
    return ['wine', str(binary), '-Port='+str(ports['primary']), '-QueryPort='+str(ports['QUERY_PORT']), '-MaxPlayers='+str(players)], secrets, 'SCUM/Saved/Logs/SCUM.log'

_original_install = z.install

def install(root, game, env, validate=True):
    preflight(root, env)
    return _original_install(root, 'scum', env, validate)

z.configure = configure
z.install = install

def main():
    root = Path.cwd().resolve(); env = dict(os.environ)
    preflight(root, env)
    mode = sys.argv[1]
    if mode == 'preflight': return 0
    if mode == 'install': install(root, 'scum', env); return 0
    if mode == 'run':
        # Original AUTO_UPDATE now routes through the typed updater, after preflight.
        env['VOLTRA_STEAM_AUTO_UPDATE'] = '1' if z.boolean(env,'AUTO_UPDATE','1') else '0'
        return z.run(root, 'scum', env)
    if mode == 'configure': configure(root, 'scum', env); return 0
    raise ValueError('Expected preflight, install, configure or run')

if __name__ == '__main__':
    try: sys.exit(main())
    except Exception:
        print('SCUM refused invalid prerequisites or failed native operation; inspect private server state.', file=sys.stderr)
        sys.exit(1)
