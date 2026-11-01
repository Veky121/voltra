#!/usr/bin/env python3
"""MIT integration. Download only the publisher's dedicated server package."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import json
import shutil

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

RELEASE={'version':'1.7.3','url':'https://gtaconnected.com/downloads/server/GTAC-Server-Linux-1.7.3.tar.gz','sha256':'033b9e7ba00695f35948bd75d10e44b8c616d535c314b26c48f5b0f972dac3ba','bytes':13446184,'prefix':None}

def identity(env):
    version=env.get('DL_VERSION',RELEASE['version'])
    if version==RELEASE['version']:return dict(RELEASE)
    if version!='latest' and not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,3}',version):raise ValueError('Invalid DL_VERSION')
    digest=env.get('GTAC_RELEASE_SHA256','').lower()
    if not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Other publisher releases require a reviewed GTAC_RELEASE_SHA256')
    return {'version':version,'url':'https://gtaconnected.com/downloads/server/latest/linux' if version=='latest' else 'https://gtaconnected.com/downloads/server/GTAC-Server-Linux-'+version+'.tar.gz','sha256':digest,'prefix':None}

def preflight(root,env):
    """Plan legacy import without acquisition or filesystem mutation."""
    selected=identity(env)
    module('gtac-runtime').managed_values(env)
    for base in [root/'gtac',root/'.voltra']:
        paths=[base]+(list(base.rglob('*')) if base.is_dir() and not base.is_symlink() else [])
        for path in paths:
            if path.is_symlink() or not path.resolve().is_relative_to(root):
                raise ValueError('GTAC destination contains a symlink or escapes volume')
    for path in [root/'gtac',root/'.voltra',root/'.voltra/gtac']:
        if path.exists() and not path.is_dir():raise ValueError('GTAC directory is not a directory')
    marker=root/'.voltra/gtac/legacy-layout-imported.json'
    planned=[]
    if not marker.exists():
        for name in ['server.xml','resources','modules']:
            source=root/name
            paths=[source]+(list(source.rglob('*')) if source.is_dir() and not source.is_symlink() else [])
            for old in paths:
                if old.is_symlink():raise ValueError('Legacy symlinks require explicit operator migration')
                if not old.exists():continue
                new=root/'gtac'/old.relative_to(root)
                if old.is_dir():
                    if new.exists() and not new.is_dir():raise ValueError('Legacy directory conflicts with native file')
                elif old.is_file():
                    if new.exists() and not new.is_file():raise ValueError('Legacy file conflicts with native directory')
                    if not new.exists():planned.append((old,new))
                else:raise ValueError('Legacy special files require explicit operator migration')
    config=root/'gtac/server.xml'
    if config.exists() and not config.is_file():raise ValueError('GTAC XML is not a regular file')
    return selected,planned,marker


def install(root,env):
    root=root.resolve()
    selected,planned,marker=preflight(root,env)
    config=root/'gtac/server.xml'
    original=config.read_bytes() if config.is_file() else None
    try:module('native-release').install_release(root,selected,'gtac','Server')
    finally:
        if original is not None and (not config.exists() or config.read_bytes()!=original):config.write_bytes(original)
    # Native-layout operator files win. Import missing legacy files only on
    # the first successful migration, retaining originals byte for byte.
    if not marker.exists():
        for old,new in planned:
            new.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(old,new)
        marker.parent.mkdir(parents=True,exist_ok=True)
        marker.write_text(json.dumps({'copied':[old.relative_to(root).as_posix() for old,_ in planned],'originals_retained':True},indent=2)+'\n')

if __name__=='__main__':
    root=Path(os.environ.get('VOLTRA_SERVER_ROOT','/mnt/server'))
    if sys.argv[1:]==['--preflight']:preflight(root.resolve(),os.environ)
    elif sys.argv[1:]:raise ValueError('Unsupported GTAC installer argument')
    else:install(root,os.environ)
