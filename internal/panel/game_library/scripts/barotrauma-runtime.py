#!/usr/bin/env python3
"""MIT. Native Barotrauma XML settings and shared terminal console lifecycle."""
import os
from pathlib import Path
import sys
import time
import xml.etree.ElementTree as ET
from native_config import private_write
from native_console import run
from additional_survival_install import install


def text(value, maximum=128):
    if len(value.encode()) > maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Text contains control characters or exceeds its limit')
    return value


def flag(env, key, default='0'):
    value=env.get(key, default)
    if value not in ('0','1'):raise ValueError(key+' must be 0 or 1')
    return value == '1'


def configure(root, env):
    root=Path(root).resolve(); target=root/'serversettings.xml'
    if not target.resolve().is_relative_to(root) or not (root/'.voltra/barotrauma/config-backups').resolve().is_relative_to(root):raise ValueError('Barotrauma settings leave the volume')
    name=text(env.get('SERVER_NAME','Barotrauma server'),60)
    password=text(env.get('SERVER_PASSWORD',''),128)
    maximum=int(env.get('MAX_PLAYERS','8')); port=int(env['SERVER_PORT'])
    ports=sorted({int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p})
    if not 1<=maximum<=16 or not 1<=port<=65535 or port not in ports or len(ports)<2 or any(not 1<=p<=65535 for p in ports):raise ValueError('Choose 1..16 players and two allocated native ports')
    query=int(env.get('QUERY_PORT') or next(p for p in ports if p!=port))
    if query==port or query not in ports:raise ValueError('Query port must be a distinct allocated port')
    if target.exists():
        if target.stat().st_size>8*1024*1024:raise ValueError('Barotrauma configuration exceeds 8 MiB')
        previous=target.read_text(encoding='utf-8-sig')
        if '<!DOCTYPE' in previous.upper() or '<!ENTITY' in previous.upper():raise ValueError('XML document type declarations are not supported')
        element=ET.fromstring(previous,parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
        if element.tag.lower()!='serversettings':raise ValueError('Expected native serversettings XML root')
    else:previous='';element=ET.Element('serversettings')
    managed={'servername':name,'port':str(port),'queryport':str(query),'ispublic':str(flag(env,'PUBLIC_SERVER')).lower(),'password':password,'maxplayers':str(maximum),'enableupnp':'false'}
    for key in list(element.attrib):
        if key.lower() in managed:del element.attrib[key]
    element.attrib.update(managed)
    updated=ET.tostring(element,encoding='unicode')+'\n'
    if updated!=previous:
        if previous:private_write(root/'.voltra/barotrauma/config-backups'/(str(time.time_ns())+'-serversettings.xml'),previous)
        private_write(target,updated)
    else:target.chmod(0o600)
    binary=root/'DedicatedServer'
    if not binary.is_file() or not binary.resolve().is_relative_to(root):raise ValueError('Steam installation is missing a confined DedicatedServer')
    argv=[str(binary),'-batchmode','-name',name,'-port',str(port),'-queryport',str(query),'-public',managed['ispublic'],'-maxplayers',str(maximum),'-upnp','false']
    # Password remains in the private XML instead of the process argument list.
    environment=dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD'):environment.pop(key,None)
    environment.update({'HOME':str(root),'LD_LIBRARY_PATH':str(root)+':'+str(root/'.steam/sdk64')+':'+str(root/'linux64')})
    return argv,environment,[password,*[env.get(k,'') for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]]


def main():
    root=Path.cwd();env=dict(os.environ)
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0') not in ('0','1'):raise ValueError('Invalid automatic update flag')
    if env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1':install(root,'barotrauma',env,validate=False)
    argv,environment,credentials=configure(root,env)
    return run(root,argv,environment,'quit',credentials=credentials,ready_marker=b'Server started',terminal_input=True,terminal_query_reply=True)


if __name__=='__main__':sys.exit(main())
