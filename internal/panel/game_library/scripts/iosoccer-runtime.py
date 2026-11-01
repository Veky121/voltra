#!/usr/bin/env python3
"""IOSoccer adapter. Native server.cfg owns scalar settings after initial seed."""
import os
import sys
from pathlib import Path
import re
from source_runtime import quoted, private_write
from source_install import update
from native_console import run


def preflight(root, env):
    root = Path(root).resolve()
    if env.get('SRCDS_APPID') != '673990': raise ValueError('Expected IOSoccer dedicated AppID 673990')
    if env.get('AUTO_UPDATE', '0') not in ('0', '1') or env.get('VOLTRA_STEAM_AUTO_UPDATE', '0') not in ('0', '1'): raise ValueError('Update must be 0 or 1')
    game_map = env.get('MAP', '8v8_vienna')
    if not re.fullmatch(r'[A-Za-z0-9_/-]{1,128}', game_map) or any(p in ('', '.', '..') for p in game_map.split('/')): raise ValueError('Invalid map')
    main = int(env['SERVER_PORT'])
    allocated = {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}
    if main not in allocated or any(not 1025 <= p <= 65535 for p in allocated): raise ValueError('Invalid allocations')
    available = sorted(allocated - {main}); ports = []
    for key in ('SRCDS_CPORT', 'SRCDS_STV'):
        p = int(env.get(key, '0'))
        if not p:
            if not available: raise ValueError('Three distinct allocations required')
            p = available[0]
        if p not in available: raise ValueError('Port must be a distinct allocation')
        ports.append(p); available.remove(p)
    slots, tick, fps = (int(env.get(k, d)) for k,d in [('SLOTS','32'),('TICKRATE','100'),('MAX_FPS','500')])
    if not 1 <= slots <= 64 or not 10 <= tick <= 128 or not 0 <= fps <= 1000: raise ValueError('Invalid launch limits')
    if env.get('PUBLIC_SERVER','0') not in ('0','1') or env.get('TV_ENABLE','0') not in ('0','1'): raise ValueError('Invalid boolean')
    token = env.get('STEAM_GSLT','')
    if token and not re.fullmatch(r'[A-Za-z0-9]{1,128}',token): raise ValueError('Invalid token')
    seeds = {'hostname':quoted(env.get('HOSTNAME','Iosoccer server server')), 'sv_password':quoted(env.get('SERVER_PASSWORD','')), 'rcon_password':quoted(env.get('RCON','')), 'sv_lan':'0' if env.get('PUBLIC_SERVER','0')=='1' else '1', 'fps_max':str(fps)}
    # Refuse escapes before any update, mkdir or write, including dangling links.
    for rel in ('srcds_run_64','iosoccer/cfg/server.cfg','iosoccer/cfg/voltra-iosoccer.cfg','iosoccer/cfg/voltra-iosoccer-ports.cfg','iosoccer/cfg/voltra-iosoccer-login.cfg','.voltra/iosoccer-seeded'):
        p = root / rel
        if not p.resolve().is_relative_to(root) or p.is_symlink(): raise ValueError('Unsafe IOSoccer path')
    cfg = root/'iosoccer/cfg/server.cfg'
    if cfg.exists():
        data = cfg.read_bytes()
        if len(data)>8*1024*1024: raise ValueError('Config too large')
        # Preserve arbitrary native bytes. Only identify ASCII key tokens.
        keys = {m.group(1).lower().decode('ascii') for m in re.finditer(rb'(?m)^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]+',data)}
    else: data, keys = b'', set()
    return root, game_map, main, ports, slots, tick, token, seeds, data, keys


def prepare(root, env, acquire=False):
    root, game_map, main, ports, slots, tick, token, seeds, data, keys = preflight(root,env)
    if acquire: update(root,673990,env=env,validate=False,required=('srcds_run_64',))
    if not (root/'srcds_run_64').is_file(): raise ValueError('Missing publisher srcds_run_64')
    marker = root/'.voltra/iosoccer-seeded'
    if not marker.exists():
        # Missing values only, once. Never decode/rewrite unknown bytes or secrets.
        addition = ''.join(k+' '+v+'\n' for k,v in seeds.items() if k not in keys).encode()
        cfg=root/'iosoccer/cfg/server.cfg'; cfg.parent.mkdir(parents=True,exist_ok=True)
        if addition:
            with cfg.open('ab') as out:
                if data and not data.endswith(b'\n'): out.write(b'\n')
                out.write(addition)
            cfg.chmod(0o600)
        private_write(marker,'seeded\n')
    folder=root/'iosoccer/cfg'
    private_write(folder/'voltra-iosoccer-ports.cfg','tv_port '+str(ports[1])+'\ntv_enable '+env.get('TV_ENABLE','0')+'\n')
    private_write(folder/'voltra-iosoccer-login.cfg',('sv_setsteamaccount '+quoted(token)+'\n') if token else '// Anonymous login\n')
    private_write(folder/'voltra-iosoccer.cfg','exec server.cfg\nexec voltra-iosoccer-ports.cfg\n')
    argv=[str(root/'srcds_run_64'),'-game','iosoccer','-console','-condebug','-ip','0.0.0.0','-port',str(main),'-strictportbind','-norestart','-maxplayers',str(slots),'-tickrate',str(tick),'+clientport',str(ports[0]),'+servercfgfile','voltra-iosoccer.cfg','+exec','voltra-iosoccer-login.cfg','+map',game_map]
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'): environment.pop(key,None)
    environment['LD_LIBRARY_PATH']=str(root/'bin')+':'+str(root/'bin/linux64')
    return argv,environment


if __name__ == '__main__':
    if sys.argv[1:]: raise ValueError('Unexpected runtime arguments')
    env=dict(os.environ)
    argv,environment=prepare(Path.cwd(),env,env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0'))=='1')
    raise SystemExit(run(Path.cwd(),argv,environment,'quit',[env.get(k,'') for k in ('RCON','SERVER_PASSWORD','STEAM_GSLT','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')],terminal_input=True))
