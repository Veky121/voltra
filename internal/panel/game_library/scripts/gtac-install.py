#!/usr/bin/env python3
"""MIT integration. Download only the publisher's dedicated server package."""
import importlib.util
import os
from pathlib import Path
import re
import sys

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

def install(root,env):
    root=root.resolve();target=root/'gtac';config=target/'server.xml'
    if not target.resolve().is_relative_to(root) or not config.resolve().is_relative_to(root):raise ValueError('GTAC destination escapes volume')
    original=config.read_bytes() if config.is_file() else None
    try:module('native-release').install_release(root,identity(env),'gtac','Server')
    finally:
        if original is not None and config.read_bytes()!=original:config.write_bytes(original)
    # Old recipe placed operator resources beside Server. Retain originals and
    # copy them once, following the same confinement policy as the other GTA helpers.
    module('gta-install').migrate(root,'gtac',['server.xml','resources','modules'])

if __name__=='__main__':install(Path(os.environ.get('VOLTRA_SERVER_ROOT','/mnt/server')),os.environ)
