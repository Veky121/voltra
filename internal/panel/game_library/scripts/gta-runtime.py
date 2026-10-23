#!/usr/bin/env python3
"""MIT. Native open.mp/MTA console with narrowly managed configuration."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys
import time
import xml.etree.ElementTree as ET

ROOT=Path(os.environ.get('VOLTRA_SERVER_ROOT','/home/container')).resolve()
def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def number(env,key,default,minimum=1,maximum=65535):
    raw=str(env.get(key,default))
    if not raw.isascii() or not raw.isdigit() or not minimum<=int(raw)<=maximum:raise ValueError('Invalid '+key)
    return int(raw)

def text(env,key,default='',maximum=250):
    value=env.get(key,default)
    if len(value.encode())>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def write_config(root,path,content):
    if not path.resolve().is_relative_to(root):raise ValueError('Configuration escapes volume')
    native=module('native-config')
    if path.exists() and path.read_text()==content:return
    if path.exists():native.private_write(root/'.voltra/gta-backups'/(str(time.time_ns())+'-'+path.name),path.read_text())
    native.private_write(path,content)

def allocated(env):
    values={int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if value}
    primary=number(env,'SERVER_PORT',7777)
    if primary not in values or any(not 1<=value<=65535 for value in values):raise ValueError('GTA listener ports must be allocated')
    return primary,values

def configure_openmp(root,env):
    path=root/'openmp/config.json';config=json.loads(path.read_text())
    if not isinstance(config,dict):raise ValueError('OpenMP config must be an object')
    primary,ports=allocated(env)
    for section in ['network','rcon']:
        if not isinstance(config.setdefault(section,{}),dict):raise ValueError('Invalid '+section+' configuration')
    config['network'].update(port=primary,bind='0.0.0.0')
    password=text(env,'RCON_PASSWORD',maximum=32)
    if not password:
        secret=root/'.voltra/openmp/rcon-password'
        if not secret.exists():module('native-config').private_write(secret,secrets.token_urlsafe(24))
        password=secret.read_text()
    config['rcon'].update(password=password,enable=bool(number(env,'RCON_ENABLED',1,0,1)))
    config.update(name=text(env,'SERVER_NAME','My open.mp server'),max_players=number(env,'MAX_PLAYERS',50,1,1000),password=text(env,'SERVER_PASSWORD',maximum=128),announce=bool(number(env,'PUBLIC_SERVER',0,0,1)),enable_query=True)
    # Artwork downloads are native HTTP, defaulting to the same numeric port
    # but TCP. Preserve user custom model/CDN settings and explicit ports.
    artwork=config.get('artwork',{})
    if isinstance(artwork,dict) and artwork.get('enable',False):
        port=number(env,'ARTWORK_PORT',0,0,65535) or primary
        if port not in ports:raise ValueError('Artwork HTTP port must be allocated')
        artwork['port']=port
    write_config(root,path,json.dumps(config,indent=2)+'\n');return config,password

def configure_mtasa(root,env):
    path=root/'mtasa/mods/deathmatch/mtaserver.conf';raw=path.read_text()
    if '<!DOCTYPE' in raw.upper() or '<!ENTITY' in raw.upper():raise ValueError('XML entity declarations unsupported')
    parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True));config=ET.fromstring(raw,parser=parser)
    if config.tag!='config':raise ValueError('Invalid MTA configuration root')
    primary,ports=allocated(env);ase=number(env,'ASE_ENABLED',0,0,1)
    available=sorted(ports-{primary}-({primary+123} if ase else set()))
    http=number(env,'SERVER_WEBPORT',0,0,65535)
    if not http:
        if not available:raise ValueError('Allocate a separate HTTP port')
        http=available[0]
    if http not in ports or http==primary:raise ValueError('SERVER_WEBPORT must be a separate allocated port')
    if ase and (primary+123 not in ports or primary+123==http):raise ValueError('ASE requires an additional allocation at game port +123, distinct from HTTP')
    values={'servername':text(env,'SERVER_NAME','My MTA server'),'serverip':'auto','serverport':str(primary),'httpport':str(http),'maxplayers':str(number(env,'MAX_PLAYERS',32,1,4096)),'password':text(env,'SERVER_PASSWORD',maximum=64),'ase':str(ase)}
    for key,value in values.items():
        matches=config.findall(key)
        if len(matches)>1:raise ValueError('Duplicate managed MTA element '+key)
        node=matches[0] if matches else ET.SubElement(config,key);node.text=value
    write_config(root,path,ET.tostring(config,encoding='unicode')+'\n')
    return {'primary':primary,'http':http,'ase':primary+123 if ase else None}

def run(game,root=ROOT,env=None):
    env=dict(os.environ if env is None else env);env.pop('PYTHONHOME',None)
    if game=='openmp':
        config,password=configure_openmp(root,env);cwd=root/'openmp';argv=[str(cwd/'omp-server')];stop='exit';credentials=[password,env.get('SERVER_PASSWORD','')];ready=b'Legacy Network started on'
        env['LD_LIBRARY_PATH']=str(root/'.voltra/openmp32')+os.pathsep+env.get('LD_LIBRARY_PATH','')
    elif game=='mtasa':
        configure_mtasa(root,env);cwd=root/'mtasa';argv=[str(cwd/'mta-server64'),'-n'];stop='shutdown';credentials=[env.get('SERVER_PASSWORD','')];ready=b'Server started and is ready to accept connections'
    else:raise ValueError('Unknown GTA multiplayer server')
    # Both publishers expose native stdin console commands and native stop.
    return module('native-console').run(cwd,argv,env,stop,credentials=credentials,ready_marker=ready,terminal_input=True)

if __name__=='__main__':sys.exit(run(sys.argv[1]))
