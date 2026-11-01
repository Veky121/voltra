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

def preservation_guard(root, names):
    import stat
    for parent in (root, *root.parents):
        if parent.is_symlink(): raise ValueError('Linked protected ancestor')
    for name in names:
        path=root/name
        for p in (path, *path.parents):
            if p.is_symlink(): raise ValueError('Linked protected path')
        entries=[path]
        if path.is_dir(): entries.extend(path.rglob('*'))
        for p in entries:
            if not p.exists() and not p.is_symlink(): continue
            s=p.lstat()
            if not (stat.S_ISREG(s.st_mode) or stat.S_ISDIR(s.st_mode)): raise ValueError('Special protected file')
            if stat.S_ISREG(s.st_mode) and s.st_nlink!=1: raise ValueError('Hardlinked protected file')

def configure_impostor(root, env, dry_run=False):
    # Strict JSON, byte offsets derived without decoding opaque numbers/subtrees.
    import decimal
    import stat
    import tempfile
    path = root / 'impostor/config.json'
    for p in (root / 'impostor', path):
        if p.is_symlink() or not p.resolve().is_relative_to(root):
            raise ValueError('Unsafe Impostor config path')
    preservation_guard(root, ['impostor/config.json', '.voltra/among-us/backups'])
    previous = path.read_bytes() if path.exists() else b'{}'
    source = previous.decode('utf-8')
    decoder = json.JSONDecoder(parse_float=decimal.Decimal,
                               parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Invalid JSON number')))
    parsed = decoder.decode(source)
    if not isinstance(parsed, dict):
        raise ValueError('Impostor config must be an object')
    def ws(i):
        while i < len(source) and source[i] in ' \t\r\n': i += 1
        return i
    def members(start):
        i = ws(start)
        if source[i] != '{': raise ValueError('Expected object')
        i = ws(i + 1); result = {}; end = i
        while source[i] != '}':
            key, i = decoder.raw_decode(source, i)
            if not isinstance(key, str): raise ValueError('Expected key')
            i = ws(i)
            if source[i] != ':': raise ValueError('Expected colon')
            begin = ws(i + 1); _, end = decoder.raw_decode(source, begin)
            result.setdefault(key, []).append((begin, end))
            i = ws(end)
            if source[i] == '}': break
            if source[i] != ',': raise ValueError('Expected comma')
            i = ws(i + 1)
        return result, i
    top, top_end = members(0)
    for key in top:
        if ':' in key or (key.casefold() in ('server', 'httpserver') and key not in ('Server', 'HttpServer')):
            raise ValueError('Ambiguous .NET configuration alias')
    listen = port(env, 'SERVER_PORT', 22023)
    changes = []; missing_sections = {}
    effective = {}
    for section, fields in {
        'Server': {'PublicIp': None, 'PublicPort': None, 'ListenIp': '0.0.0.0', 'ListenPort': listen},
        'HttpServer': {'ListenIp': '0.0.0.0', 'ListenPort': listen},
    }.items():
        if len(top.get(section, [])) > 1: raise ValueError('Duplicate managed section')
        present = parsed.get(section, {})
        if not isinstance(present, dict): raise ValueError('Invalid section')
        spans, end = members(top[section][0][0]) if section in top else ({}, 0)
        for key in spans:
            if ':' in key or (key.casefold() in {k.casefold() for k in fields} and key not in fields):
                raise ValueError('Ambiguous managed field alias')
        pending = {}
        for key, managed in fields.items():
            if len(spans.get(key, [])) > 1: raise ValueError('Duplicate managed field')
            if key == 'PublicIp':
                value = present[key] if key in present else text(env, 'PUBLIC_IP', '127.0.0.1')
                if not isinstance(value, str) or not value or not re.fullmatch(r'[A-Za-z0-9._:-]+', value): raise ValueError('Invalid effective PublicIp')
            elif key == 'PublicPort':
                value = present[key] if key in present else (port(env, 'PUBLIC_PORT', listen) if env.get('PUBLIC_PORT') else listen)
                if type(value) is not int or not 1 <= value <= 65535: raise ValueError('Invalid effective PublicPort')
            else: value = managed
            effective[section + '/' + key] = value
            if key not in spans: pending[key] = value
            elif managed is not None and present[key] != value:
                begin, finish = spans[key][0]; changes.append((begin, finish, json.dumps(value)))
        if section not in top: missing_sections[section] = pending
        elif pending:
            addition = json.dumps(pending)[1:-1]
            changes.append((end, end, (',' if spans else '') + addition))
    if missing_sections:
        changes.append((top_end, top_end, (',' if top else '') + json.dumps(missing_sections)[1:-1]))
    updated = source
    for begin, end, value in sorted(changes, reverse=True): updated = updated[:begin] + value + updated[end:]
    if not dry_run and updated.encode() != previous:
        if path.exists():
            import time
            module('native-config').private_write(root/'.voltra/among-us/backups'/('config-'+str(time.time_ns())+'.json'), previous.decode('utf-8'))
        path.parent.mkdir(parents=True, exist_ok=True)
        identity = path.stat() if path.exists() else None
        fd, temporary = tempfile.mkstemp(prefix='.impostor-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as out:
                out.write(updated.encode())
                if identity:
                    os.fchown(out.fileno(), identity.st_uid, identity.st_gid)
                    os.fchmod(out.fileno(), stat.S_IMODE(identity.st_mode))
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)
    return effective


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
        if env.get('DOTNET_CHANNEL','8') not in ('6','7','8'):raise ValueError('Invalid DOTNET_CHANNEL')
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
