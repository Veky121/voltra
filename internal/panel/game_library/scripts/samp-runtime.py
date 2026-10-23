#!/usr/bin/env python3
"""MIT integration. Preserve legacy native byte encoding and original RCON API."""
import importlib.util
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import time

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def configure(root,env):
    common=module('gta-runtime');primary,ports=common.allocated(env);path=root/'samp/server.cfg'
    if not path.resolve().is_relative_to(root):raise ValueError('SA-MP configuration escapes volume')
    encoding=env.get('SAMP_CONFIG_ENCODING','cp1252')
    if encoding not in ['cp1252','utf-8']:raise ValueError('SAMP_CONFIG_ENCODING must be cp1252 or utf-8')
    raw=path.read_bytes().decode(encoding) if path.is_file() else ''
    password=common.text(env,'RCON_PASS','',32)
    if not password:
        secret=root/'.voltra/samp/rcon-password'
        if not secret.exists():module('native-config').private_write(secret,secrets.token_urlsafe(24))
        password=secret.read_text()
    if password.lower()=='changeme':raise ValueError('Use a private RCON password rather than publisher changeme')
    values={'port':str(primary),'bind':'0.0.0.0','rcon_password':password,'hostname':common.text(env,'SERVER_NAME','SA-MP server',128),'maxplayers':str(common.number(env,'MAX_PLAYERS',50,1,1000)),'announce':str(common.number(env,'PUBLIC_SERVER',0,0,1)),'query':'1'}
    lines=[line for line in raw.splitlines() if not re.match(r'^\s*(?:'+('|'.join(values))+r')(?:\s|$)',line,re.I)]
    lines.extend(key+' '+value for key,value in values.items());content=('\n'.join(lines)+'\n').encode(encoding)
    if not path.is_file() or path.read_bytes()!=content:
        backups=root/'.voltra/gta-backups';backups.mkdir(parents=True,exist_ok=True)
        if path.is_file():
            backup=backups/(str(time.time_ns())+'-samp-server.cfg');backup.write_bytes(path.read_bytes());backup.chmod(0o600)
        path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as output:temporary=Path(output.name);output.write(content)
        temporary.chmod(0o600);os.replace(temporary,path)
    return password

def run(root,env):
    password=configure(root,env);env=dict(env);env.pop('PYTHONHOME',None);cwd=root/'samp'
    env['LD_LIBRARY_PATH']=str(cwd)+os.pathsep+env.get('LD_LIBRARY_PATH','')
    return module('native-console').run(cwd,[str(cwd/'samp03svr')],env,'\x03',credentials=[password],terminal_input=True)

if __name__=='__main__':sys.exit(run(Path(os.environ.get('VOLTRA_SERVER_ROOT','/home/container')).resolve(),os.environ))
