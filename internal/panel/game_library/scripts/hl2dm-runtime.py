#!/usr/bin/env python3
"""HL2DM-only pure preflight; Source installation/configuration/console stay shared."""
import os
from pathlib import Path
import re
import sys
import source_runtime
import source_variant_runtime
import source_install
import hl2dm_gameplay
from native_console import run


def safe(root, relative, directory=False):
    current = root
    for part in Path(relative).parts:
        current /= part
        if current.is_symlink():
            raise ValueError('HL2DM managed paths must not traverse symlinks')
        if current != root / relative and current.exists() and not current.is_dir():
            raise ValueError('Invalid HL2DM managed parent')
    if not current.resolve().is_relative_to(root):
        raise ValueError('HL2DM managed path leaves the server volume')
    if current.exists() and (not current.is_dir() if directory else not current.is_file()):
        raise ValueError('Invalid HL2DM managed path type')
    return current


def preflight(root, environment, require_payload=True):
    root, env = Path(root).resolve(), dict(environment)
    if env.get('SRCDS_APPID', '') != '232370' or env.get('SRCDS_GAME', 'hl2mp') != 'hl2mp':
        raise ValueError('Half-Life 2: Deathmatch requires app232370 and hl2mp')
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1') or env.get('VALIDATE', '0') not in ('0', '1'):
        raise ValueError('Update and validation controls must be0 or1')
    for key, default in (('SERVER_NAME','Pterodactyl-server'),('SERVER_PASSWORD',''),('RCON_PASSWORD','')):
        source_runtime.quoted(env.get(key, default))
    if not env.get('SERVER_NAME', 'Pterodactyl-server'):
        raise ValueError('Choose a nonempty native server name')
    game_map = env.get('MAP_NAME', 'dm_lockdown')
    if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', game_map) or any(p in ('', '.', '..') for p in game_map.split('/')):
        raise ValueError('Choose an installed HL2DM map without traversal or console commands')
    if not 1 <= int(env.get('MAX_PLAYERS', '20')) <= 20 or not 10 <= int(env.get('TICK_RATE', '66')) <= 128:
        raise ValueError('HL2DM slots or tick rate exceed the original recipe limits')
    if env.get('PUBLIC_SERVER', '0') not in ('0', '1') or env.get('TV_ENABLE', '0') not in ('0', '1'):
        raise ValueError('Listing and SourceTV controls must be0 or1')
    token = env.get('STEAM_GSLT', '')
    if token and not re.fullmatch(r'[A-Za-z0-9]{1,128}', token):
        raise ValueError('Invalid optional game-server login token')
    beta = env.get('SRCDS_BETAID', '')
    if beta and not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}', beta):
        raise ValueError('Invalid Steam branch name')
    beta_password = env.get('SRCDS_BETAPASS', '')
    if len(beta_password) > 128 or any(c in beta_password for c in '\r\n\x00'):
        raise ValueError('Invalid Steam branch credential')
    raw = env.get('VOLTRA_ALLOCATED_PORTS', '')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*', raw):
        raise ValueError('Choose native HL2DM port allocations')
    ports = [int(p) for p in raw.split(',')]
    primary = int(env['SERVER_PORT'])
    if primary not in ports or len(ports) != len(set(ports)) or any(not 1025 <= p <= 65535 for p in ports):
        raise ValueError('HL2DM ports must be distinct allocated values above1024')
    used = {primary}
    # Reserve explicit roles first. Otherwise a zero client port can consume an
    # explicit TV allocation before the shared configure routine reaches it.
    for key in ('SRCDS_CPORT','SRCDS_STV'):
        value = int(env.get(key, '0'))
        if value:
            if value not in ports or value in used:
                raise ValueError('HL2DM client/TV roles need distinct allocated ports')
            used.add(value)
    for key in ('SRCDS_CPORT','SRCDS_STV'):
        if int(env.get(key, '0')) == 0:
            available = sorted(set(ports) - used)
            if not available:
                raise ValueError('Allocate three distinct HL2DM ports')
            env[key] = str(available[0])
            used.add(available[0])
    for name in ('voltra-managed.cfg','voltra-server.cfg','voltra-login.cfg'):
        target = safe(root, 'hl2mp/cfg/' + name)
        if target.exists():
            if target.stat().st_size > 8*1024*1024:
                raise ValueError('Oversized HL2DM managed configuration')
            target.read_text(encoding='utf-8')
    for directory in ('.voltra/source','.voltra/source/config-backups'):
        safe(root, directory, directory=True)
    for relative in ('srcds_run','hl2mp/gameinfo.txt','hl2mp/maps/'+game_map+'.bsp'):
        target = safe(root, relative)
        if require_payload and not target.is_file():
            raise ValueError('Reinstall to restore the selected HL2DM launcher/mod/map')
    return env, automatic


def main(root=None, environment=None, update=None, launch=None, supervise=None):
    root = Path.cwd() if root is None else Path(root)
    env = dict(os.environ if environment is None else environment)
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '0'))
    env, automatic = preflight(root, env, require_payload=automatic != '1')
    hl2dm_gameplay.plan(Path(root).resolve())
    if automatic == '1':
        (update or source_install.update)(root, 232370, env=env, validate=env.get('VALIDATE','0')=='1', required=('srcds_run','hl2mp/gameinfo.txt'))
    env, _ = preflight(root, env)
    argv, child = hl2dm_gameplay.configure(root, env, launch or source_variant_runtime.launch)
    credentials = [env.get(key,'') for key in ('SERVER_PASSWORD','RCON_PASSWORD','STEAM_GSLT','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return (supervise or run)(root, argv, child, 'quit', credentials, terminal_input=True)


if __name__ == '__main__':
    raise SystemExit(main())
