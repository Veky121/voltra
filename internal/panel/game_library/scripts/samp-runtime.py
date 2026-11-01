#!/usr/bin/env python3
"""MIT integration. Preserve legacy native byte encoding and original RCON API."""
import importlib.util
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tempfile
import time

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def confined(root, relative):
    path = root / relative
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        raise ValueError('SA-MP path escapes volume or uses a symbolic link')
    for parent in path.parents:
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError('SA-MP path uses a symbolic link')
    return path


def render(raw, values, encoding):
    # Validate before any secret, backup or config write. Keep all unmanaged bytes.
    raw.decode(encoding)
    rows = raw.splitlines(keepends=True)
    pattern = re.compile(rb'^\s*(' + b'|'.join(k.encode() for k in values) + rb')(?:[ \t]|$)', re.I)
    seen = set()
    result = []
    newline = b'\r\n' if b'\r\n' in raw else b'\n'
    for row in rows:
        match = pattern.match(row.rstrip(b'\r\n'))
        if not match:
            result.append(row)
            continue
        key = match[1].decode('ascii').lower()
        if key not in seen:
            ending = b'\r\n' if row.endswith(b'\r\n') else b'\n' if row.endswith(b'\n') else b''
            result.append((key + ' ' + values[key]).encode(encoding) + ending)
            seen.add(key)
    missing = [key for key in values if key not in seen]
    if missing and result and not result[-1].endswith(b'\n'):
        result.append(newline)
    result.extend((key + ' ' + values[key]).encode(encoding) + newline for key in missing)
    return b''.join(result)


def configure(root,env):
    root = root.resolve()
    common=module('gta-runtime');primary,ports=common.allocated(env);path=confined(root,'samp/server.cfg')
    if not path.resolve().is_relative_to(root):raise ValueError('SA-MP configuration escapes volume')
    encoding=env.get('SAMP_CONFIG_ENCODING','cp1252')
    if encoding not in ['cp1252','utf-8']:raise ValueError('SAMP_CONFIG_ENCODING must be cp1252 or utf-8')
    raw=path.read_bytes() if path.is_file() else b''
    raw.decode(encoding)
    for relative in ['.voltra/samp/rcon-password','.voltra/gta-backups']:
        confined(root,relative)
    password=common.text(env,'RCON_PASS','',32)
    if not password:
        secret=confined(root,'.voltra/samp/rcon-password')
        password=secret.read_text() if secret.exists() else secrets.token_urlsafe(24)
    password=common.text({'password':password},'password','',32)
    if not password or any(c.isspace() for c in password):raise ValueError('SA-MP RCON password must be a nonempty token')
    if password.lower()=='changeme':raise ValueError('Use a private RCON password rather than publisher changeme')
    values={'port':str(primary),'bind':'0.0.0.0','rcon_password':password,'hostname':common.text(env,'SERVER_NAME','SA-MP server',128),'maxplayers':str(common.number(env,'MAX_PLAYERS',50,1,1000)),'announce':str(common.number(env,'PUBLIC_SERVER',0,0,1)),'query':'1'}
    content=render(raw,values,encoding)
    if not env.get('RCON_PASS') and not secret.exists():module('native-config').private_write(secret,password)
    if not path.is_file() or path.read_bytes()!=content:
        backups=confined(root,'.voltra/gta-backups');backups.mkdir(parents=True,exist_ok=True)
        if path.is_file():
            backup=backups/(str(time.time_ns())+'-samp-server.cfg');backup.write_bytes(path.read_bytes());backup.chmod(0o600)
        path.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as output:temporary=Path(output.name);output.write(content)
        try:
            if path.exists():
                original=path.stat()
                temporary.chmod(stat.S_IMODE(original.st_mode))
                if hasattr(os,'chown'):os.chown(temporary,original.st_uid,original.st_gid)
            else:temporary.chmod(0o600)
            os.replace(temporary,path)
        finally:temporary.unlink(missing_ok=True)
    return password

def run(root,env):
    password=configure(root,env);env=dict(env);env.pop('PYTHONHOME',None);cwd=root/'samp'
    env['LD_LIBRARY_PATH']=str(cwd)+os.pathsep+env.get('LD_LIBRARY_PATH','')
    return module('native-console').run(cwd,[str(cwd/'samp03svr')],env,'\x03',credentials=[password],terminal_input=True)

if __name__=='__main__':sys.exit(run(Path(os.environ.get('VOLTRA_SERVER_ROOT','/home/container')).resolve(),os.environ))
