#!/usr/bin/env python3
"""MIT. Urban Terror and ET: Legacy native settings and verified UDP readiness."""
import os
from pathlib import Path
import re
import secrets
import socket
import tempfile
import threading
import time
import zipfile
from native_console import run


def quoted(value, limit=255, info=False):
    if len(value.encode('utf8')) > limit or any(c in value for c in '\x00\r\n"'):
        raise ValueError('Native console strings must fit the byte limit and cannot contain quotes or line breaks')
    if info and any(c in value for c in '\\;'):
        raise ValueError('Native info strings cannot contain backslashes or semicolons')
    return '"' + value + '"'


def number(env, name, default, minimum, maximum):
    value = int(env.get(name, str(default)))
    if not minimum <= value <= maximum:
        raise ValueError(name + ' is outside its supported range')
    return value


def confined(root, path):
    if not path.resolve().is_relative_to(root.resolve()):
        raise ValueError('Native configuration path escapes the volume')
    return path


def map_exists(folders, name):
    for folder in folders:
        if (folder / 'maps' / (name + '.bsp')).is_file():
            return True
        for package in folder.glob('*.pk3'):
            with zipfile.ZipFile(package) as source:
                if 'maps/' + name + '.bsp' in source.namelist():
                    return True
    return False


def configure(env, root, kind):
    port = number(env, 'SERVER_PORT', 27960, 1, 65535)
    public = str(number(env, 'PUBLIC_SERVER', 0, 0, 1))
    game = confined(root, root / kind)
    mod = 'q3ut4' if kind == 'urbanterror' else 'legacy'
    folder = confined(root, game / 'userdata' / mod)
    folder.mkdir(parents=True, exist_ok=True)
    lines = []
    if kind == 'urbanterror':
        architecture = env.get('EXE', 'x86_64')
        if architecture not in ('x86_64', 'i386'):
            raise ValueError('EXE must select a bundled x86_64 or i386 server')
        binary = game / ('Quake3-UrT-Ded.' + architecture)
        heap = number(env, 'HUNKMEGS', 128, 128, 256)
        if heap not in (128,160,192,256):raise ValueError('Unsupported native hunk size')
        maximum = number(env, 'SERVER_MAXCLIENTS', 16, 1, 32)
        bots = number(env, 'BOT_MINPLAYERS', 0, 0, 16)
        if bots > maximum:raise ValueError('Bot fill cannot exceed maximum players')
        game_map = env.get('SERVER_MAP', 'ut4_casa')
        lines = [
            'set sv_hostname ' + quoted(env.get('SERVER_NAME', 'My Awesome Pterodactyl Server'),255,True),
            'set sv_joinmessage ' + quoted(env.get('JOIN_MESSAGE','Welcome to this Server, have fun!'),255),
            'set sv_maxclients ' + str(maximum),
            'set g_gametype ' + str(number(env,'SERVER_GAMETYPE',3,1,11)),
            'set bot_enable 1', 'set bot_minplayers ' + str(bots),
            'set timelimit ' + str(number(env,'SERVER_TIMELIMIT',10,0,999)),
            'set g_friendlyfire ' + str(number(env,'SERVER_FRIENDLYFIRE',1,0,1)),
        ]
        native_config = 'server.cfg'
        extra = ['+set','com_hunkmegs',str(heap)]
    elif kind == 'etlegacy':
        architecture = env.get('ET_VERSION','32')
        if architecture not in ('32','64'):raise ValueError('ET_VERSION must be 32 or 64')
        binary = game / ('etlded.' + ('i386' if architecture == '32' else 'x86_64'))
        game_map = env.get('MAP','oasis')
        bot = number(env,'OMNIBOT',0,0,1)
        lines = [
            'set sv_hostname ' + quoted(env.get('SERVER_NAME','ET: Legacy server'),255,True),
            'set sv_maxclients ' + str(number(env,'MAX_PLAYERS',20,1,64)),
            'set omnibot_enable ' + str(bot),
        ]
        if bot:lines.append('set omnibot_path ' + quoted(str(game/'legacy/omni-bot')))
        native_config,extra = 'etl_server.cfg',[]
    else:raise ValueError('Unknown Quake-family game')
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,63}',game_map):
        raise ValueError('Choose a native map basename without .bsp')
    folders = [folder,game/mod]
    if kind == 'etlegacy':folders += [game/'userdata/etmain',game/'etmain']
    for path in folders:confined(root,path)
    if not map_exists(folders,game_map):raise ValueError('The selected map is missing from installed packages')
    for key,cvar in [('SERVER_PASSWORD','g_password'),('RCON_PASSWORD','rconpassword')]:
        lines.append('set '+cvar+' '+quoted(env.get(key,''),127,key=='SERVER_PASSWORD'))
    managed = confined(root,folder/'voltra-managed.cfg')
    content = '\n'.join(lines)+'\n'
    if not managed.is_file() or managed.read_text()!=content:
        descriptor,temporary = tempfile.mkstemp(prefix='.voltra-',dir=folder)
        try:
            with os.fdopen(descriptor,'w') as output:output.write(content)
            os.replace(temporary,managed)
        finally:
            if os.path.exists(temporary):os.unlink(temporary)
    argv = [str(binary),'+set','fs_basepath',str(game),'+set','fs_homepath',str(game/'userdata'),
            '+set','fs_game',mod,'+set','ttycon','0','+set','dedicated','2' if public=='1' else '1',
            '+set','net_ip','0.0.0.0','+set','net_port',str(port),*extra,
            '+exec',native_config,'+exec','voltra-managed.cfg','+map',game_map]
    return game,argv,port


def probe(port):
    challenge = secrets.token_hex(12).encode()
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as stream:
        stream.settimeout(.3)
        for _ in range(600):
            stream.sendto(b'\xff\xff\xff\xffgetinfo '+challenge+b'\n',('127.0.0.1',port))
            try:
                packet,address=stream.recvfrom(8192)
                if address==('127.0.0.1',port) and packet.startswith(b'\xff\xff\xff\xffinfoResponse\n'):
                    pairs=packet.split(b'\n',1)[1].strip().split(b'\\')
                    info=dict(zip(pairs[1::2],pairs[2::2]))
                    if info.get(b'challenge')==challenge:
                        print('VOLTRA_QUAKE_NATIVE_READY',flush=True)
                        return
            except socket.timeout:pass
            time.sleep(.2)


def main(root,env,kind):
    game,argv,port=configure(env,root,kind)
    threading.Thread(target=probe,args=(port,),daemon=True).start()
    return run(game,argv,dict(env),'quit',credentials=[env.get('SERVER_PASSWORD',''),env.get('RCON_PASSWORD','')])


if __name__=='__main__':
    import sys
    raise SystemExit(main(Path.cwd(),os.environ,sys.argv[1]))
