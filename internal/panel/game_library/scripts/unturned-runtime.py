#!/usr/bin/env python3
"""MIT. Native Unturned command configuration and persistent server identity."""
import os
from pathlib import Path
import re
import tempfile
import time
from native_console import run
from steam_template import update


def text(value, limit):
    if len(value.encode('utf-8')) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Unturned command values must fit their UTF-8 limit and contain no control characters')
    return value


def patch_commands(content, values):
    managed = set(values) | {'pvp', 'pve'}
    lines = []
    newline = '\r\n' if '\r\n' in content else '\n'
    for line in content.splitlines(keepends=True):
        stripped = line.strip()
        key = stripped.split(None, 1)[0].casefold() if stripped else ''
        if stripped.startswith('//') or key not in managed:
            lines.append(line)
    if lines and not lines[-1].endswith(('\r','\n')):
        lines[-1] += newline
    for key, value in values.items():
        if value is not None:
            lines.append(key + (' ' + value if value else '') + newline)
    return ''.join(lines)


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.voltra-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            output.write(value)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):os.unlink(temporary)


def configure(root, env):
    root = root.resolve()
    identity = env.get('SRV_ID','PterodactylUnturned')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',identity):
        raise ValueError('Choose a server save ID containing letters, digits, underscores or hyphens')
    port = int(env['SERVER_PORT'])
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if value}
    if not 1 <= port <= 65534 or not {port,port+1}.issubset(allocated):
        raise ValueError('Allocate two consecutive ports on this server address')
    public, offline = env.get('PUBLIC_SERVER','0'), env.get('OFFLINE_ONLY','0')
    if public not in ('0','1') or offline not in ('0','1') or public == offline == '1':
        raise ValueError('Choose LAN/offline or Internet mode')
    token = env.get('GSLT','')
    if token and not re.fullmatch(r'[A-Za-z0-9]{1,128}',token):
        raise ValueError('Invalid Game Server Login Token')
    if public == '1' and not token:
        raise ValueError('Internet mode requires a Game Server Login Token')
    maximum = int(env.get('MAX_PLAYERS','24'))
    if not 1 <= maximum <= 48:
        raise ValueError('Choose a player limit from 1 to 48')
    game_map = text(env.get('GAME_MAP','PEI'),128)
    if not game_map.strip() or any(c in game_map for c in '/\\'):
        raise ValueError('Choose a map name, not a filesystem path')
    difficulty, perspective = env.get('DIFFICULTY','Normal'), env.get('PERSPECTIVE','Both')
    if difficulty not in ('Easy','Normal','Hard') or perspective not in ('First','Third','Both','Vehicle'):
        raise ValueError('Choose a supported native difficulty and perspective')
    pvp = env.get('PVP','1')
    if pvp not in ('0','1'):raise ValueError('PVP must be 0 or 1')
    values={'name':text(env.get('SRV_NAME','Pterodactyl hosted Server'),200),
            'password':text(env.get('SRV_PW',''),128) or None,
            'port':str(port),'map':game_map,'maxplayers':str(maximum),
            'difficulty':difficulty,'perspective':perspective,
            'pvp' if pvp == '1' else 'pve':'', 'gslt':token or None}
    owner=env.get('OWNER_ID','')
    if owner:
        if not owner.isascii() or not owner.isdigit() or not 1 <= int(owner) < 2**64:
            raise ValueError('Choose a numeric owner SteamID64')
        values['owner']=owner
    target=root/'Servers'/identity/'Server/Commands.dat'
    state=root/'.voltra/unturned'
    if any(not path.resolve().is_relative_to(root) for path in (target,state)):
        raise ValueError('Unturned save/configuration path escapes the volume')
    if target.exists():
        with target.open(encoding='utf-8',newline='') as source:original=source.read()
    else:original=''
    content=patch_commands(original,values)
    if original!=content:
        if target.exists():private_write(state/'config-backups'/(str(time.time_ns())+'-Commands.dat'),original)
        private_write(target,content)
    else:target.chmod(0o600)
    executable=root/'Unturned_Headless.x86_64'
    if not executable.is_file():raise ValueError('Steam installation is missing Unturned Headless')
    child_env=dict(os.environ)
    child_env.pop('PYTHONHOME',None);child_env.pop('PYTHONPATH',None);child_env.pop('LD_PRELOAD',None)
    library_path=env.get('VOLTRA_GAME_LIBRARY_PATH',env.get('LD_LIBRARY_PATH','./Unturned_Headless_Data/Plugins/x86_64/'))
    child_env['LD_LIBRARY_PATH']=library_path
    argv=[str(executable),'-batchmode','-nographics','-bind','0.0.0.0','-port',str(port),
          ('+InternetServer/' if public == '1' else '+LanServer/')+identity]
    if offline=='1':argv.append('-OfflineOnly')
    return argv,child_env


if __name__=='__main__':
    root=Path.cwd()
    automatic=os.environ.get('VOLTRA_STEAM_AUTO_UPDATE',os.environ.get('AUTO_UPDATE','1'))
    if automatic not in ('0','1'):raise ValueError('AUTO_UPDATE must be 0 or 1')
    if automatic=='1':update(root,1110390,validate=False,required=('Unturned_Headless.x86_64',))
    argv,environment=configure(root,os.environ)
    interval=int(os.environ.get('AUTOSAVE_SECONDS','300'))
    if not 0 <= interval <= 86400:raise ValueError('Autosave interval must be zero or up to one day')
    raise SystemExit(run(root,argv,environment,'shutdown',
                         [os.environ.get(key,'') for key in ('SRV_PW','GSLT','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')],
                         b'Loading level: 100%',interval,'save',terminal_input=True))
