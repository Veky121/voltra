#!/usr/bin/env python3
"""MIT. Native open.mp/MTA console with narrowly managed configuration."""
import importlib.util
import json
import os
from pathlib import Path
import secrets
import re
from xml.sax.saxutils import escape
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
    if not path.resolve().is_relative_to(root) or any(p.is_symlink() for p in (path,*path.parents) if p.is_relative_to(root)):raise ValueError('Configuration escapes volume')
    if path.exists() and (not path.is_file() or path.stat().st_size>4*1024*1024):raise ValueError('Invalid configuration file')
    native=module('native-config')
    if path.exists() and path.read_bytes().decode('utf-8')==content:return
    if path.exists():native.private_write(root/'.voltra/gta-backups'/(str(time.time_ns())+'-'+path.name),path.read_bytes().decode('utf-8'))
    native.private_write(path,content)

def unique_object(pairs):
    out={}
    for key,value in pairs:
        if key in out:raise ValueError('Duplicate JSON key')
        out[key]=value
    return out

def json_patch(raw, desired):
    # Locate JSON object member values without decoding/re-encoding unknown numbers.
    decoder=json.JSONDecoder(); edits=[]
    def walk(start, wanted):
        i=start+1; members={}
        while True:
            while raw[i].isspace():i+=1
            if raw[i]=='}':break
            key,end=decoder.raw_decode(raw,i);i=end
            while raw[i].isspace():i+=1
            if raw[i]!=':':raise ValueError('Invalid object')
            i+=1
            while raw[i].isspace():i+=1
            begin=i;value,end=decoder.raw_decode(raw,i)
            if key in members:raise ValueError('Duplicate JSON key')
            members[key]=(begin,end,value);i=end
            while raw[i].isspace():i+=1
            if raw[i]==',':i+=1;continue
            if raw[i]=='}':break
            raise ValueError('Invalid object')
        missing={}
        for key,value in wanted.items():
            if key not in members:missing[key]=value;continue
            begin,end,old=members[key]
            if isinstance(value,dict) and isinstance(old,dict):walk(begin,value)
            elif old!=value:edits.append((begin,end,json.dumps(value,ensure_ascii=False)))
        if missing:
            addition=', '.join(json.dumps(k)+': '+json.dumps(v,ensure_ascii=False) for k,v in missing.items())
            edits.append((i,i,(', ' if members else '')+addition))
    walk(len(raw)-len(raw.lstrip()),desired)
    for begin,end,value in sorted(edits,reverse=True):raw=raw[:begin]+value+raw[end:]
    return raw

def xml_patch(raw, values):
    for key,value in values.items():
        existing=ET.fromstring(raw).findall(key)
        if len(existing)==1 and (existing[0].text or '')==value:continue
        pattern=r'(<'+key+r'\b[^>]*>)([^<]*)(</'+key+r'\s*>)'
        matches=list(re.finditer(pattern,raw))
        if len(matches)>1:raise ValueError('Duplicate native element')
        if matches:
            m=matches[0]
            if ET.fromstring('<x>'+m[2]+'</x>').text != value:
                raw=raw[:m.start(2)]+escape(value)+raw[m.end(2):]
        elif re.search(r'<'+key+r'\b',raw):raise ValueError('Unsupported native element')
        else:
            node='<'+key+'>'+escape(value)+'</'+key+'>'
            if re.search(r'<config\s*/>',raw):raw=re.sub(r'<config\s*/>',lambda m:'<config>'+node+'</config>',raw,count=1)
            else:raw=raw.replace('</config>',node+'</config>',1)
    return raw

def allocated(env):
    values={int(value) for value in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if value}
    primary=number(env,'SERVER_PORT',7777)
    if primary not in values or any(not 1<=value<=65535 for value in values):raise ValueError('GTA listener ports must be allocated')
    return primary,values

def configure_openmp(root,env,preflight=False):
    path=root/'openmp/config.json'
    if not path.resolve().is_relative_to(root) or any(p.is_symlink() for p in (path,*path.parents) if p.is_relative_to(root)):raise ValueError('Configuration escapes volume')
    if path.exists() and (not path.is_file() or path.stat().st_size>4*1024*1024):raise ValueError('Invalid configuration file')
    raw=path.read_bytes().decode('utf-8') if path.exists() else '{}'
    config=json.loads(raw,object_pairs_hook=unique_object)
    if not isinstance(config,dict):raise ValueError('OpenMP config must be an object')
    primary,ports=allocated(env)
    for section in ['network','rcon']:
        if not isinstance(config.setdefault(section,{}),dict):raise ValueError('Invalid '+section+' configuration')
    config['network'].update(port=primary,bind='0.0.0.0')
    password=text(env,'RCON_PASSWORD',maximum=32)
    if not password:
        secret=root/'.voltra/openmp/rcon-password'
        if not secret.resolve().is_relative_to(root):raise ValueError('Credential escapes volume')
        password=secret.read_text() if secret.exists() else secrets.token_urlsafe(24)
    config['rcon'].setdefault('password',password)
    config['rcon'].setdefault('enable',bool(number(env,'RCON_ENABLED',1,0,1)))
    password=config['rcon']['password']
    if not isinstance(password,str) or not isinstance(config.get('password',''),str):raise ValueError('Invalid native credentials')
    seeds=dict(name=text(env,'SERVER_NAME','My open.mp server'),max_players=number(env,'MAX_PLAYERS',50,1,1000),password=text(env,'SERVER_PASSWORD',maximum=128),announce=bool(number(env,'PUBLIC_SERVER',0,0,1)),enable_query=True)
    for key,value in seeds.items():config.setdefault(key,value)
    # Artwork downloads are native HTTP, defaulting to the same numeric port
    # but TCP. Preserve user custom model/CDN settings and explicit ports.
    artwork=config.get('artwork',{})
    if isinstance(artwork,dict) and artwork.get('enable',False):
        port=number(env,'ARTWORK_PORT',0,0,65535) or primary
        if port not in ports:raise ValueError('Artwork HTTP port must be allocated')
        artwork['port']=port
    if preflight:return config,password
    if not env.get('RCON_PASSWORD') and not (root/'.voltra/openmp/rcon-password').exists():module('native-config').private_write(root/'.voltra/openmp/rcon-password',password)
    write_config(root,path,json_patch(raw,config));return config,password

def configure_mtasa(root,env,preflight=False):
    path=root/'mtasa/mods/deathmatch/mtaserver.conf'
    if not path.resolve().is_relative_to(root) or any(p.is_symlink() for p in (path,*path.parents) if p.is_relative_to(root)):raise ValueError('Configuration escapes volume')
    if path.exists() and (not path.is_file() or path.stat().st_size>4*1024*1024):raise ValueError('Invalid configuration file')
    raw=path.read_bytes().decode('utf-8') if path.exists() else '<config/>'
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
        if matches and key not in ('serverip','serverport','httpport','ase'):values[key]=matches[0].text or ''
        else:
            node=matches[0] if matches else ET.SubElement(config,key);node.text=value
    if not preflight:write_config(root,path,xml_patch(raw,values))
    return {'primary':primary,'http':http,'ase':primary+123 if ase else None}

def preflight(game,root,env):
    if game=='openmp':return configure_openmp(root,env,True)
    if game=='mtasa':return configure_mtasa(root,env,True)
    raise ValueError('Unknown GTA multiplayer server')

def run(game,root=ROOT,env=None):
    env=dict(os.environ if env is None else env);env.pop('PYTHONHOME',None)
    if game=='openmp':
        if not (root/'openmp/config.json').is_file():raise ValueError('Missing native configuration')
        config,password=configure_openmp(root,env);cwd=root/'openmp';argv=[str(cwd/'omp-server')];stop='exit';credentials=[password,config.get('password','')];ready=b'Legacy Network started on'
        env['LD_LIBRARY_PATH']=str(root/'.voltra/openmp32')+os.pathsep+env.get('LD_LIBRARY_PATH','')
    elif game=='mtasa':
        if not (root/'mtasa/mods/deathmatch/mtaserver.conf').is_file():raise ValueError('Missing native configuration')
        configure_mtasa(root,env);cwd=root/'mtasa';argv=[str(cwd/'mta-server64'),'-n'];stop='shutdown';credentials=[n.text or '' for n in ET.fromstring((root/'mtasa/mods/deathmatch/mtaserver.conf').read_bytes()).iter() if isinstance(n.tag,str) and ('password' in n.tag.lower() or 'secret' in n.tag.lower())];ready=b'Server started and is ready to accept connections'
    else:raise ValueError('Unknown GTA multiplayer server')
    # Both publishers expose native stdin console commands and native stop.
    return module('native-console').run(cwd,argv,env,stop,credentials=credentials,ready_marker=ready,terminal_input=True)

if __name__=='__main__':sys.exit(run(sys.argv[1]))
