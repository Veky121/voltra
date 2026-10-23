#!/usr/bin/env python3
"""MIT. Typed native launchers for the reviewed non-Minecraft Java games."""
import os
from pathlib import Path
import re
import sys
import time
import zipfile
from native_config import private_write
from native_console import run


def line(value, limit=256):
    if len(value.encode('utf-8')) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Game settings must be single-line values within their byte limit')
    return value


def integer(env, name, default, minimum, maximum):
    value = env.get(name, str(default))
    if not value.isascii() or not value.isdigit() or not minimum <= int(value) <= maximum:
        raise ValueError('Invalid numeric setting: ' + name)
    return int(value)


def inside(root, relative):
    path = root / relative
    if not path.resolve().is_relative_to(root):raise ValueError('Game path leaves its server volume')
    return path


def properties(content, values):
    newline = '\r\n' if '\r\n' in content else '\n'
    output, seen = [], set()
    for text in content.splitlines(keepends=True):
        match = re.match(r'^\s*([A-Za-z0-9_]+)\s*[=:]\s*', text)
        if match and match[1] in values:
            key = match[1]
            if key in seen or text.rstrip('\r\n').endswith('\\'):
                raise ValueError('Ambiguous managed game property: ' + key)
            seen.add(key);text = key + '=' + values[key] + newline
        output.append(text)
    if output and not output[-1].endswith(('\r','\n')):output[-1] += newline
    output.extend(key+'='+value+newline for key,value in values.items() if key not in seen)
    return ''.join(output)


def property_value(value):
    # java.util.Properties treats backslashes and leading spaces specially.
    encoded = value.encode('utf-16-be')
    return ''.join(chr(int.from_bytes(encoded[i:i+2],'big')) if 33 <= int.from_bytes(encoded[i:i+2],'big') < 127 and chr(int.from_bytes(encoded[i:i+2],'big')) not in '\\=:# !' else '\\u'+encoded[i:i+2].hex() for i in range(0,len(encoded),2))


def configure_properties(root, name, values):
    target = inside(root,name);backups = inside(root,'.voltra/java-game/backups')
    previous = ''
    if target.exists():
        with target.open(encoding='utf-8',newline='') as source:previous=source.read()
    updated = properties(previous,{key:property_value(value) for key,value in values.items()})
    if updated != previous:
        if target.exists():private_write(backups/(name+'.'+str(time.time_ns())),previous)
        private_write(target,updated)


def starmade_options(jar):
    with zipfile.ZipFile(jar) as package:
        try:
            member=package.getinfo('META-INF/MANIFEST.MF')
        except KeyError:return []
        if member.file_size>65536:raise ValueError('Server jar manifest is too large')
        manifest=re.sub(r'\r?\n ','',package.read(member).decode('utf-8'))
    values={key:value.strip() for key,value in re.findall(r'^([^:\r\n]+): ([^\r\n]*)',manifest,re.M)}
    if values.get('Main-Class')!='api.starloader.StarMadeEntry':return []
    if values.get('Premain-Class')!='api.starloader.StarAgent':raise ValueError('Unsupported StarLoader entry point without its publisher agent')
    return ['-javaagent:'+str(jar),'--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED','--add-opens=java.base/java.nio=ALL-UNNAMED']


def launch(root, kind, env):
    root = Path(root).resolve()
    if kind not in ('necesse','starmade','rising-world-java'):raise ValueError('Unknown reviewed Java game')
    port = integer(env,'SERVER_PORT',0,1,65535)
    allocated = {int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if value}
    if port not in allocated:raise ValueError('Primary gameplay port is not allocated')
    memory = integer(env,'SERVER_MEMORY',2048,512,1048576)
    # Leave native libraries, Python and process overhead outside the Java heap.
    heap = max(256,memory-384)
    child_env = dict(env)
    for key in ('PYTHONHOME','PYTHONPATH','JAVA_TOOL_OPTIONS','JDK_JAVA_OPTIONS','_JAVA_OPTIONS','LD_PRELOAD'):child_env.pop(key,None)
    credentials = [env.get(key,'') for key in ('SERVER_PASSWORD','RCON_PASSWORD','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    managed_properties = None
    if kind == 'necesse':
        world = line(env.get('SAVE_NAME','Save1'),80)
        if not world or world.startswith(('.', '-')) or any(c in world for c in '/\\'):raise ValueError('Choose a save name, not a path')
        slots = integer(env,'SERVER_SLOTS',10,1,250)
        pause = env.get('PAUSE_EMPTY','1')
        if pause not in ('0','1'):raise ValueError('PAUSE_EMPTY must be 0 or 1')
        password = line(env.get('SERVER_PASSWORD',''),128)
        argv = [str(inside(root,'jre/bin/java')),'-Xms128M','-Xmx'+str(heap)+'M','-Dterminal.jline=false','-Dterminal.ansi=false','-jar',str(inside(root,'Server.jar')),
                '-localdir','-nogui','-world',world,'-port',str(port),'-slots',str(slots),'-password',password,'-pausewhenempty',pause]
        stop, ready = 'stop', b'Type help for list of commands.'
    else:
        java = inside(root,'.voltra/'+('java21' if kind=='starmade' else 'java8')+'/bin/java')
        if kind == 'starmade':
            jar = line(env.get('SERVER_JARFILE','StarMade.jar'),64)
            if not jar or not jar.endswith('.jar') or Path(jar).is_absolute():raise ValueError('Choose a server jar within this volume')
            jar_path=inside(root,jar)
            if not jar_path.is_file():raise ValueError('The configured server jar is missing')
            argv = [str(java),'-Xms128M','-Xmx'+str(heap)+'M',*starmade_options(jar_path),'-jar',str(jar_path),'-server','-port:'+str(port)]
            stop, ready = '/shutdown 0', b'SenableGameState(1)'
        else:
            block = set(range(port-1,port+5))
            if port < 2 or port > 65531 or not block.issubset(allocated):raise ValueError('Rising World Java requires gameplay-1 through gameplay+4')
            extra = sorted(allocated-block)
            if not extra:raise ValueError('Allocate a separate RCON port')
            requested = integer(env,'RCON_PORT',4253,1,65535)
            rcon = requested if requested in extra else extra[0]
            maximum = integer(env,'MAX_PLAYERS',4,1,64)
            name = line(env.get('SERVER_NAME','Rising World Server'),128)
            password = line(env.get('SERVER_PASSWORD',''),80)
            rcon_password = line(env.get('RCON_PASSWORD',''),80)
            if len(rcon_password)<6:raise ValueError('Choose an RCON password of at least six characters')
            # The Python bootstrap uses LD_LIBRARY_PATH for its private libpython.
            # Startup captures the operator's game-library setting separately.
            library = line(env.get('VOLTRA_GAME_LD_LIBRARY_PATH','./linux64'),128)
            if any(not inside(root,item).is_dir() for item in library.split(':')):raise ValueError('LD Library Path must name directories within this volume')
            directories = [inside(root,item) for item in library.split(':')]
            sdk = inside(root,'.steam/sdk64')
            if sdk.is_dir():directories.append(sdk)
            child_env['LD_LIBRARY_PATH'] = ':'.join(dict.fromkeys(map(str,directories)))
            managed_properties = {'rcon_enabled':'true','rcon_password':rcon_password,'server_password':password}
            argv = [str(java),'-Xms128M','-Xmx'+str(heap)+'M','-jar',str(inside(root,'server.jar')),'+maxplayer='+str(maximum),'+serverport='+str(port),'+servername='+name,'+rconport='+str(rcon)]
            # The publisher's earlier STARTED line precedes SteamAPI_Init.
            stop, ready = 'shutdown', b'Steam Query Server bind to ANY ('
    if not Path(argv[0]).is_file():raise ValueError('Install this game and its Java runtime first')
    jar = argv[argv.index('-jar')+1]
    if not Path(jar).is_file():raise ValueError('The configured server jar is missing')
    if managed_properties is not None:configure_properties(root,'server.properties',managed_properties)
    return argv, child_env, stop, ready, credentials


if __name__ == '__main__':
    kind = sys.argv[1]
    automatic = os.environ.get('VOLTRA_STEAM_AUTO_UPDATE',os.environ.get('AUTO_UPDATE','0'))
    if automatic not in ('0','1'):raise ValueError('AUTO_UPDATE must be 0 or 1')
    if automatic == '1' and kind != 'starmade':
        from java_games_install import install
        install(Path.cwd(),kind,os.environ,False)
    argv, environment, stop, ready, credentials = launch(Path.cwd(),kind,os.environ)
    raise SystemExit(run(Path.cwd(),argv,environment,stop,credentials,ready_marker=ready))
