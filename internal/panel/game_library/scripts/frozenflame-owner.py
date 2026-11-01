#!/usr/bin/env python3
"""Frozen Flame adapter. Native files own existing values; CLI owns ports/name/RCON."""
import json
import os
import re
import sys
from pathlib import Path
import unreal_building as shared
from native_config import patch_ini, resolve_ini_identities


def prepare(root, environment):
    root = Path(root).resolve()
    info = shared.metadata()['frozen']
    env = {**info['defaults'], **{k:v for k,v in environment.items() if k in info['defaults']}}
    for value in env.values():
        if not isinstance(value, str) or len(value.encode()) > 8192 or any(ord(c)<32 or ord(c)==127 for c in value):
            raise ValueError('Invalid Frozen Flame setting')
    if env['SRCDS_APPID'] not in ('', '1348640') or env['AUTO_UPDATE'] not in ('0','1') or environment.get('VOLTRA_STEAM_AUTO_UPDATE','0') not in ('0','1'):
        raise ValueError('Invalid acquisition settings')
    if not re.fullmatch(r'[1-9][0-9]*', env['MAX_PLAYERS']):
        raise ValueError('Invalid player count')
    ports = [int(environment['SERVER_PORT']), int(env['QUERY_PORT']), int(env['RCON_PORT'])]
    allocated = {int(p) for p in environment.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p}
    if len(set(ports)) != 3 or any(not 1 <= p <= 65535 or p not in allocated for p in ports):
        raise ValueError('Choose distinct allocated ports')
    target = shared.confined(root, info['config'])
    if target.exists() and target.stat().st_size > 8*1024*1024:
        raise ValueError('INI exceeds 8MiB')
    old = target.read_bytes() if target.exists() else b''
    text = old.decode('utf-8')
    sections = {'/Script/Engine.GameSession':{'MaxPlayers':env['MAX_PLAYERS']}, '/Script/FrozenFlame.FGameSession':{'ServerPassword':json.dumps(env['SERVER_PASSWORD'],ensure_ascii=False)}}
    resolved = resolve_ini_identities(text, sections)
    missing = {}
    # Resolve/reject case aliases and array operators before any acquisition/write.
    for section, values in resolved.items():
        active = False
        existing = set()
        for line in text.lstrip('\ufeff').splitlines():
            header = re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?',line)
            if header: active = header.group(1).casefold()==section.casefold()
            elif active and '=' in line and not line.lstrip().startswith((';','#')):
                key = line.split('=',1)[0].strip()
                if key.lstrip('+-.!').split('[')[0].casefold() in {k.casefold() for k in values}:
                    if key.startswith(('+','-','.','!')) or '[' in key: raise ValueError('Managed array alias')
                    existing.add(key.casefold())
        absent = {k:v for k,v in values.items() if k.casefold() not in existing}
        if absent: missing[section] = absent
    updated = patch_ini(text, missing).encode('utf-8') if missing else old
    return root, info, env, target, old, updated, ports


def configure(root, environment):
    root, info, env, target, old, updated, ports = prepare(root, environment)
    binary = shared.confined(root, info['binary'])
    if not binary.is_file(): raise ValueError('Reinstall to restore dedicated executable')
    if updated != old: shared.publish(root, info['config'], updated)
    child = dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD'): child.pop(key,None)
    child['HOME'] = str(root)
    child['LD_LIBRARY_PATH'] = str(root/'.steam/sdk64')
    argv = [str(binary), '-log', '-MetaGameServerName='+env['SERVER_NAME'], '-port='+str(ports[0]), '-queryPort='+str(ports[1]), '-RconPort='+str(ports[2]), '-RconPassword='+env['RCON_PASSWORD'], '-stdout', '-FullStdOutLogOutput']
    secrets = [env['SERVER_PASSWORD'], env['RCON_PASSWORD']]
    return argv, child, secrets, info['ready'].encode()


def install(root, environment):
    prepare(root, environment)
    return shared.install(root, 'frozen', environment)


def main():
    if len(sys.argv) != 2: raise ValueError('Expected install or run')
    action = sys.argv[1]
    if action not in ('install','run'): raise ValueError('Unknown action')
    root = Path.cwd(); env = dict(os.environ)
    prepare(root, env)
    if action == 'install': install(root, env); return 0
    defaults = shared.metadata()['frozen']['defaults']
    if env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE',defaults['AUTO_UPDATE'])) == '1' and env.get('SRCDS_APPID',defaults['SRCDS_APPID']): install(root, env)
    return shared.native_run(root, 'frozen', *configure(root, env))

if __name__ == '__main__': sys.exit(main())
