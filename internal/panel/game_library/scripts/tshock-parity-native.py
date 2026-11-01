"""TShock-only seed-once controls; original exact release and runtime retained."""
import codecs
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys

PROPERTIES = 'serverconfig.txt'
CONFIG = 'tshock/config.json'


def components():
    import terraria_release_install as release
    import tshock_runtime as runtime
    import steam_template as publication
    return release, runtime, publication


def text(value, limit):
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Invalid original TShock text control')
    return value


def controls(env):
    if env.get('VOLTRA_TERRARIA_KIND') != 'tshock': raise ValueError('Modern TShock only')
    name = text(env.get('WORLD_NAME', 'world'), 40)
    if not name or any(not (c.isalnum() or c in '_-') for c in name): raise ValueError('Invalid original world name')
    values = {'WORLD_NAME': name, 'SERVER_NAME': text(env.get('SERVER_NAME', 'TShock server'), 100), 'SERVER_PASSWORD': text(env.get('SERVER_PASSWORD', ''), 128)}
    if not values['SERVER_NAME']: raise ValueError('Server name is required')
    for key, default, low, high in (('MAX_PLAYERS','8',1,255),('WORLD_SIZE','1',1,3),('WORLD_DIFFICULTY','0',0,3)):
        raw=env.get(key,default)
        if not isinstance(raw,str) or not re.fullmatch('[0-9]+',raw) or not low<=int(raw)<=high: raise ValueError('Invalid original '+key)
        values[key]=raw
    if not re.fullmatch(r'latest|v?[0-9]+(?:\.[0-9]+){1,3}',env.get('TSHOCK_VERSION','v6.2.1')): raise ValueError('Invalid release selection')
    if env.get('RELEASE_SHA256') and not re.fullmatch('[0-9a-f]{64}',env['RELEASE_SHA256']): raise ValueError('Invalid release checksum')
    return values


def properties(data):
    content=data.decode('utf-8-sig'); rows={}; offset=0
    if '\x00' in content: raise ValueError('NUL in native properties')
    for line in content.splitlines(keepends=True):
        body=line.rstrip('\r\n'); stripped=body.lstrip()
        if stripped and not stripped.startswith(('#',';')):
            if '=' not in body: raise ValueError('Unsupported native properties row')
            key,value=body.split('=',1); key=key.strip().lower()
            if not key or key in rows: raise ValueError('Ambiguous native properties')
            start=offset+body.index('=')+1;rows[key]=(value.strip(),start,offset+len(body))
        offset+=len(line)
    world=rows.get('world',('',0,0))[0]
    if world:
        prefix='/home/container/saves/Worlds/'
        if not world.startswith(prefix) or '\\' in world or not world.endswith('.wld') or any(p in ('.','..') for p in PurePosixPath(world).parts): raise ValueError('World must remain within the native world folder')
    return content,rows


def document(data):
    def unique(pairs):
        result={}
        for key,value in pairs:
            if key in result: raise ValueError('Duplicate JSON key')
            result[key]=value
        return result
    result=json.loads(data.decode('utf-8-sig'),object_pairs_hook=unique,parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
    if not isinstance(result,dict) or not isinstance(result.get('Settings'),dict) or any(key!='Settings' and key.casefold()=='settings' for key in result): raise ValueError('Expected unambiguous native Settings object')
    names=[key.casefold() for key in result['Settings']]
    if len(names)!=len(set(names)): raise ValueError('Ambiguous native Settings case aliases')
    return result


def validate_existing(root, release, publication):
    publication._publication_check(root)
    for relative in (PROPERTIES,CONFIG):
        path=release.confined(root,relative)
        with publication._publication_parent(root,relative) as (parent,name,_):
            if parent is not None: publication._publication_leaf(parent,name)
        if path.exists():
            if not path.is_file() or path.stat().st_size>8*1024**2: raise ValueError('Unsupported native configuration file')
            (properties if relative==PROPERTIES else document)(path.read_bytes())


def install(root, env, release=None, publication=None):
    if release is None or publication is None: release,_,publication=components()
    root=Path(root).resolve();values=controls(env);validate_existing(root,release,publication)
    absent=not release.confined(root,PROPERTIES).exists()
    result=release.install(root,env)
    if absent:
        target=release.confined(root,PROPERTIES);before=target.read_bytes();content,rows=properties(before)
        selected={'worldname':values['WORLD_NAME'],'world':'/home/container/saves/Worlds/'+values['WORLD_NAME']+'.wld','autocreate':values['WORLD_SIZE'],'difficulty':values['WORLD_DIFFICULTY'],'maxplayers':values['MAX_PLAYERS']}
        if not set(selected).issubset(rows): raise ValueError('Original initialized properties are incomplete')
        for key in sorted(selected,key=lambda key:rows[key][1],reverse=True):
            _,start,end=rows[key];content=content[:start]+selected[key]+content[end:]
        updated=(codecs.BOM_UTF8 if before.startswith(codecs.BOM_UTF8) else b'')+content.encode()
        validate_existing(root,release,publication)
        if target.read_bytes()!=before: raise ValueError('Native properties changed while planning first seed')
        if updated!=before: publication._publish(root,PROPERTIES,lambda output:output.write(updated),0o600)
    return result


def image_runtime():
    """Resolve only a root-owned image CLI, never an operator PATH/runtime root."""
    for candidate in ('/usr/bin/dotnet','/usr/local/bin/dotnet'):
        path=Path(candidate)
        if not path.exists(): continue
        executable=path.resolve(strict=True); root=executable.parent
        if str(root) not in ('/usr/share','/usr/share/dotnet','/usr/lib/dotnet','/usr/local/share/dotnet'): raise ValueError('Untrusted image .NET location')
        trusted_image_file(executable)
        with executable.open('rb') as source:
            if source.read(4)!=b'\x7fELF': raise ValueError('Image .NET host is not ELF')
        libraries=list((root/'host/fxr').glob('9.0.*/libhostfxr.so'))
        if not libraries: raise ValueError('Image .NET9 host resolver is missing')
        for library in libraries: trusted_image_file(library)
        return executable,root
    raise ValueError('Trusted image .NET host is unavailable')


def trusted_image_file(path):
    resolved=path.resolve(strict=True)
    if resolved!=path: raise ValueError('Unexpected linked image runtime file')
    for current in (path,*path.parents):
        metadata=current.stat()
        if metadata.st_uid!=0 or metadata.st_mode&0o022: raise ValueError('Writable or non-root-owned image runtime')
    if not stat.S_ISREG(path.stat().st_mode): raise ValueError('Image runtime must be a regular file')


def plan(root,env,release=None,runtime=None,publication=None,resolve_runtime=image_runtime,run=subprocess.run):
    if release is None or runtime is None or publication is None: release,runtime,publication=components()
    if env.get('VOLTRA_TERRARIA_KIND')!='tshock': raise ValueError('Modern TShock only')
    root=Path(root).resolve();validate_existing(root,release,publication)
    if not release.confined(root,PROPERTIES).is_file() or not release.confined(root,CONFIG).is_file(): raise ValueError('Reinstall to restore required configuration')
    image=None
    def trusted_run(args,**options):
        nonlocal image
        if args==['dotnet','--list-runtimes']:
            image=resolve_runtime();args=[str(image[0]),'--list-runtimes']
        return run(args,**options)
    args,child,identity=runtime.plan(root,env,run=trusted_run)
    if identity['major']==9:
        _,image_root=image or resolve_runtime()
        child['DOTNET_ROOT']=str(image_root)
        child['DOTNET_ROOT_'+('ARM64' if 'arm' in os.uname().machine.lower() else 'X64')]=str(image_root)
    return args,child,identity


if __name__=='__main__':
    if sys.argv[1:]!=['run']: raise ValueError('Expected run')
    args,environment,_=plan(Path.cwd(),dict(os.environ));os.execve(args[0],args,environment)
