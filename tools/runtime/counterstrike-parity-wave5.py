#!/usr/bin/env python3
"""Counter-Strike recipe preflight. Install/configure/console remain shared."""
import importlib
import json
import os
from pathlib import Path
import re
import sys
import threading


def safe(root, relative, directory=False):
    current = root
    target = root / relative
    for part in Path(relative).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Counter-Strike managed paths cannot use symlinks')
        if current != target and current.exists() and not current.is_dir():
            raise ValueError('Invalid Counter-Strike managed parent')
    if not target.resolve().is_relative_to(root):
        raise ValueError('Counter-Strike path leaves its volume')
    if target.exists() and (not target.is_dir() if directory else not target.is_file()):
        raise ValueError('Invalid Counter-Strike managed path type')
    return target


def allocations(env):
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Select native port allocations')
    ports = [int(value) for value in raw.split(',')]
    primary = int(env['SERVER_PORT'])
    if len(ports) != len(set(ports)) or primary not in ports or any(not 1025 <= port <= 65535 for port in ports):
        raise ValueError('Native ports must be distinct allocations above 1024')
    return primary, ports


def preflight(game, root, environment, runtime, require_payload=True):
    root = Path(root).resolve()
    env = dict(environment)
    if game not in ('css', 'cs16', 'rehlds'):
        raise ValueError('Unsupported Counter-Strike recipe')
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1' if game == 'css' else '0'))
    if automatic not in ('0', '1') or env.get('VALIDATE', '0') not in ('0', '1'):
        raise ValueError('Update and validation flags must be 0 or 1')
    primary, ports = allocations(env)
    public = env.get('PUBLIC_SERVER', '0')
    if public not in ('0', '1'):
        raise ValueError('Public listing must be 0 or 1')
    quote = runtime.quoted if game == 'css' else runtime.text
    for key in ('HOSTNAME', 'SERVER_PASSWORD', 'RCON_PASSWORD'):
        quote(env.get(key, 'Counter-Strike server' if key == 'HOSTNAME' else ''))
    if game == 'css':
        if env.get('SRCDS_APPID') != '232330' or env.get('SRCDS_GAME', 'cstrike') != 'cstrike':
            raise ValueError('Counter-Strike Source requires its original app and game')
        selected_map = env.get('SRCDS_MAP', 'de_dust2')
        if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', selected_map) or any(p in ('', '.', '..') for p in selected_map.split('/')):
            raise ValueError('Invalid Source map')
        if not 1 <= int(env.get('MAX_PLAYERS', '24')) <= 64 or env.get('TV_ENABLE', '0') not in ('0', '1'):
            raise ValueError('Invalid Source slots or SourceTV switch')
        token = env.get('STEAM_TOKEN', '')
        if token and not re.fullmatch(r'[A-Za-z0-9]{1,128}', token) or public == '1' and not token:
            raise ValueError('Internet CSS requires a valid operator-owned GSLT')
        used = {primary}
        for key in ('SRCDS_CPORT', 'SRCDS_STV'):
            port = int(env.get(key, '0'))
            if port:
                if port not in ports or port in used:
                    raise ValueError('Source roles require distinct allocations')
                used.add(port)
        for key in ('SRCDS_CPORT', 'SRCDS_STV'):
            if int(env.get(key, '0')) == 0:
                available = sorted(set(ports) - used)
                if not available:
                    raise ValueError('Source requires three allocated ports')
                env[key] = str(available[0])
                used.add(available[0])
        folder = 'cstrike/cfg/'
        managed = [folder + name for name in ('voltra-managed.cfg', 'voltra-server.cfg', 'voltra-login.cfg')]
        directories = ['.voltra/source', '.voltra/source/config-backups']
        payload = ['srcds_run']
    else:
        env['VOLTRA_GOLDSRC_RECIPE'] = 'cs16' if game == 'cs16' else 'generic'
        _, mod = runtime.selection(env)
        if game == 'rehlds' and mod != 'cstrike':
            raise ValueError('ReHLDS recipe requires cstrike')
        selected_map = env.get('SRV_STARTMAP' if game == 'cs16' else 'SRCDS_MAP', 'de_dust2')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', selected_map):
            raise ValueError('Invalid GoldSrc map')
        vac = int(env.get('VAC_PORT', '0'))
        if vac and (vac not in ports or vac == primary) or not vac and len(ports) < 2:
            raise ValueError('GoldSrc requires a distinct allocated Steam service port')
        if not 1 <= int(env.get('SRV_SLOTS', '32')) <= 32 or int(env.get('SRV_PINGBOOST', '2' if game == 'cs16' else '0')) not in (0, 1, 2, 3) or not 10 <= int(env.get('SYS_TICRATE', '1200' if game == 'cs16' else '100')) <= 2000:
            raise ValueError('Invalid native GoldSrc limits')
        if env.get('SRV_SECURE', 'secure') not in ('secure', 'insecure'):
            raise ValueError('Invalid GoldSrc security mode')
        managed = [mod + '/' + name for name in ('voltra_managed.cfg', 'voltra_server.cfg', 'voltra_bootstrap.cfg')]
        directories = ['.voltra/goldsrc', '.voltra/goldsrc/config-backups']
        payload = ['hlds_run', 'hlds_linux', mod + '/liblist.gam', mod + '/maps/' + selected_map + '.bsp']
        if game == 'rehlds':
            managed += ['.voltra/cs16-modules.json', 'cstrike/addons/metamod/plugins.ini', 'cstrike/reunion.cfg']
            directories += ['cstrike/addons/amxmodx/data']
    for name in managed:
        target = safe(root, name)
        if target.exists():
            if target.stat().st_size > 8 * 1024 * 1024:
                raise ValueError('Oversized native managed configuration')
            target.read_text(encoding='utf-8')
    for name in directories:
        safe(root, name, directory=True)
    for name in payload:
        target = safe(root, name)
        if require_payload and not target.is_file():
            raise ValueError('Reinstall to restore native Counter-Strike files')
    return env, automatic


def main(game, root=None, environment=None, runtime=None, installer=None, module_installer=None):
    root = Path.cwd() if root is None else Path(root)
    environment = dict(os.environ if environment is None else environment)
    runtime = runtime or importlib.import_module('source_runtime' if game == 'css' else 'goldsrc_runtime')
    automatic = environment.get('VOLTRA_STEAM_AUTO_UPDATE', environment.get('AUTO_UPDATE', '1' if game == 'css' else '0'))
    env, automatic = preflight(game, root, environment, runtime, require_payload=automatic != '1')
    if game == 'rehlds':
        module_installer = module_installer or importlib.import_module('cs16_modules_install')
        manifest = safe(Path(root).resolve(), '.voltra/cs16-modules-release.json')
        if not manifest.is_file() or manifest.stat().st_size > 8 * 1024 * 1024:
            raise ValueError('Missing bounded module release manifest')
        release = json.loads(manifest.read_text(encoding='utf-8-sig'))
        module_installer.selection(env, release)
    if automatic == '1':
        if game == 'css':
            runtime.update(root, 232330, validate=False, required=('srcds_run',))
        elif game == 'rehlds':
            module_installer.install(root, env, env.get('VALIDATE', '0') == '1')
        else:
            installer = installer or importlib.import_module('goldsrc_install')
            installer.install(root, env, validate=env.get('VALIDATE', '0') == '1')
    env, _ = preflight(game, root, env, runtime)
    argv, child = runtime.configure(root, env)
    credentials = [env.get(key, '') for key in ('SERVER_PASSWORD', 'RCON_PASSWORD', 'STEAM_TOKEN', 'STEAM_GSLT', 'STEAM_PASS', 'STEAM_AUTH', 'SRCDS_BETAPASS')]
    if game == 'css':
        return runtime.run(root, argv, child, 'quit', credentials, terminal_input=True)
    finished = threading.Event()
    threading.Thread(target=runtime.await_native_info, args=(env, finished), daemon=True).start()
    try:
        return runtime.run(root, argv, child, 'quit', credentials, terminal_input=True)
    finally:
        finished.set()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise ValueError('Select one fixed Counter-Strike recipe')
    raise SystemExit(main(sys.argv[1]))
