#!/usr/bin/env python3
"""MIT. Native CryoFall XML controls and shared save/stop console supervision."""
import os
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET
from additional_survival_install import private_bytes
from native_console import run
from strategy_survival_install import install


def text(value,maximum):
    if len(value.encode())>maximum or any(ord(c)<32 or ord(c)==127 for c in value):
        raise ValueError('Native text exceeds byte limit or contains control characters')
    return value


def configure(root,env):
    root=Path(root).resolve();path=root/'Data/SettingsServer.xml';backups=root/'.voltra/cryofall/config-backups'
    if path.is_symlink() or not all(p.resolve().is_relative_to(root) for p in (path,backups)):
        raise ValueError('Native settings escape the server volume')
    port=int(env['SERVER_PORT'])
    allocated={int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p}
    if not 1<=port<=65535 or port not in allocated:
        raise ValueError('Choose the allocated native UDP port')
    public=env.get('PUBLIC_SERVER','0');mods=env.get('NO_CLIENT_MODS','0')
    if public not in ('0','1') or mods not in ('0','1'):
        raise ValueError('Native flags must be 0 or 1')
    maximum=int(env.get('MAX_PLAYERS','30'))
    if not 1<=maximum<=300:
        raise ValueError('Player limit must be 1..300')
    if path.exists() and path.stat().st_size>16*1024**2:
        raise ValueError('Native XML configuration exceeds16MiB')
    before=path.read_bytes() if path.exists() else b''
    decoded=before.decode('utf-16' if before.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig')
    if len(before)>16*1024**2 or '<!DOCTYPE' in decoded.upper() or '<!ENTITY' in decoded.upper():
        raise ValueError('Unsupported native XML document')
    document=ET.fromstring(before,parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))) if before else ET.Element('settings',{'version':'20'})
    if document.tag!='settings':
        raise ValueError('Expected native settings XML root')
    managed={'network':{'port':str(port),'is_public_server':public,'ip':'0.0.0.0'},
             'server':{'name':text(env.get('SERVER_NAME','CryoFall server'),64),'players_max_count':str(maximum),
                       'no_client_mods':mods}}
    if env.get('SERVER_OPERATORS',''):
        managed['server']['server_operators_list']=text(env['SERVER_OPERATORS'],1024)
    for group,values in managed.items():
        groups=document.findall(group)
        if len(groups)>1:
            raise ValueError('Duplicate native settings section')
        parent=groups[0] if groups else ET.SubElement(document,group)
        for name,value in values.items():
            entries=parent.findall(name)
            if len(entries)>1:
                raise ValueError('Duplicate managed native setting')
            element=entries[0] if entries else ET.SubElement(parent,name)
            element.text=value
    updated=ET.tostring(document,encoding='utf-8',xml_declaration=True)+b'\n'
    if updated!=before:
        if before:
            private_bytes(backups/(str(time.time_ns())+'-SettingsServer.xml'),before)
        private_bytes(path,updated,path.stat() if path.exists() else None)
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):
        environment.pop(key,None)
    environment.update(HOME=str(root),DOTNET_ROOT=str(root/'.voltra/dotnet-6'),
                       DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_NOLOGO='1',DOTNET_ROLL_FORWARD='LatestPatch',
                       LD_LIBRARY_PATH=':'.join(str(root/p) for p in ('Binaries/Server','.steam/sdk64','linux64')))
    return [str(root/'.voltra/dotnet-6/dotnet'),str(root/'Binaries/Server/CryoFall_Server.dll'),'loadOrNew'],environment


if __name__=='__main__':
    root=Path.cwd();env=dict(os.environ)
    automatic=env.get('VOLTRA_STEAM_AUTO_UPDATE','0')
    if automatic not in ('0','1'):
        raise ValueError('Invalid automatic update flag')
    if automatic=='1':
        install(root,'cryofall',env,validate=False)
    argv,environment=configure(root,env)
    raise SystemExit(run(root,argv,environment,'stop 0',credentials=[env.get(k,'') for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')],ready_marker=b'UDPServer: Socket-server listening on',terminal_input=True,terminal_query_reply=True))
