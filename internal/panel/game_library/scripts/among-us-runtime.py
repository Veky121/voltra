#!/usr/bin/env python3
"""MIT. Native Among Us server configuration; unrelated operator settings survive."""
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys

ROOT = Path(os.environ.get('VOLTRA_SERVER_ROOT', '/home/container')).resolve()

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def text(env,key,default='',maximum=250):
    value=env.get(key,default)
    if len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+key)
    return value

def port(env,key,default):
    value=str(env.get(key,default))
    if not re.fullmatch(r'[0-9]{1,5}',value) or not 1<=int(value)<=65535:raise ValueError('Invalid '+key)
    return int(value)

def inside(root,value):
    path=(root/value).resolve()
    if not path.is_relative_to(root):raise ValueError('Certificate directory must remain inside the server volume')
    return path

def configure_impostor(root,env):
    path=root/'impostor/config.json';config=json.loads(path.read_text()) if path.exists() else {}
    if not isinstance(config,dict):raise ValueError('Impostor config must be a JSON object')
    ip=text(env,'PUBLIC_IP','127.0.0.1')
    if not ip or not re.fullmatch(r'[A-Za-z0-9._:-]+',ip):raise ValueError('Invalid PUBLIC_IP')
    listen=port(env,'SERVER_PORT',22023)
    for key in ('Server','HttpServer'):
        if not isinstance(config.setdefault(key,{}),dict):raise ValueError('Invalid '+key+' configuration')
    config['Server'].update(PublicIp=ip,PublicPort=port(env,'PUBLIC_PORT',listen) if env.get('PUBLIC_PORT') else listen,ListenIp='0.0.0.0',ListenPort=listen)
    config['HttpServer'].update(ListenIp='0.0.0.0',ListenPort=listen)
    # HTTP enabled, anticheat, compatibility, plugin and logging choices remain native/operator-owned.
    native=module('native-config');updated=json.dumps(config,indent=2)+'\n'
    if not path.exists() or path.read_text()!=updated:
        if path.exists():
            import time
            native.private_write(root/'.voltra/among-us/backups'/('config-'+str(time.time_ns())+'.json'),path.read_text())
        native.private_write(path,updated)
    return config

def crew_environment(root,env):
    child=dict(env)
    for key,limit in [('HOSTNAME',250),('NAME',75),('HTTPS',20)]:child[key]=text(env,key,maximum=limit)
    child['PORT']=str(port(env,'PORT',env.get('SERVER_PORT',9736)) if env.get('PORT') else port(env,'SERVER_PORT',9736))
    if child['HTTPS']:
        cert=inside(root,text(env,'SSLPATH','') or 'crewlink')
        for name in ('privkey.pem','fullchain.pem'):
            p=cert/name
            if not p.is_file() or not p.resolve().is_relative_to(root):raise ValueError('Missing private HTTPS certificate '+name)
        child['SSLPATH']=str(cert)
    return child

def run(game,root=ROOT,env=None):
    env=dict(os.environ if env is None else env)
    if game=='impostor':
        configure_impostor(root,env);cwd=root/'impostor';argv=[str(cwd/'Impostor.Server')]
        channel=env.get('DOTNET_CHANNEL','8')
        if channel not in ('6','7','8'):raise ValueError('DOTNET_CHANNEL must be 6, 7 or 8')
        env.update(DOTNET_ROOT=str(root/'.voltra'/('dotnet' if channel=='8' else 'dotnet-'+channel)),DOTNET_BUNDLE_EXTRACT_BASE_DIR=str(root/'.voltra/dotnet-extract'),DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_NOLOGO='1')
    elif game=='crewlink':
        cwd=root/'crewlink';env=crew_environment(root,env);argv=[str(root/'.voltra/node/bin/node'),str(cwd/'dist/index.js')]
    else:raise ValueError('Unknown Among Us service')
    child=subprocess.Popen(argv,cwd=cwd,env=env)
    # Preserve actual signal outcome; no blanket successful-stop normalization.
    def stop(signum,frame):
        if child.poll() is None:child.send_signal(signal.SIGINT)
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    code=child.wait()
    return code if code>=0 else 128-code

if __name__=='__main__':sys.exit(run(sys.argv[1]))
