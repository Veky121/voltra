#!/usr/bin/env python3
"""MIT integration. Discontinued toolkits require an operator-authorized archive."""
import importlib.util
import os
from pathlib import Path
import re
import sys
import urllib.parse

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def identity(game,env):
    if game not in ['altv','ragemp','samp']:raise ValueError('Unknown archived GTA toolkit')
    url=env.get('DEDICATED_ARCHIVE_URL','');digest=env.get('DEDICATED_ARCHIVE_SHA256','').lower()
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:raise ValueError('Public dedicated distribution is unavailable. Supply your authorized dedicated-server HTTPS archive URL and SHA256; no mirror or replacement toolkit is selected.')
    if not re.fullmatch(r'[0-9a-f]{64}',digest):raise ValueError('Authorized dedicated archive requires DEDICATED_ARCHIVE_SHA256')
    build=env.get('BUILD','release') if game=='altv' else env.get('Version',env.get('VERSION','0.3.7')) if game=='samp' else 'operator-archive'
    if game=='samp' and not re.fullmatch(r'[A-Za-z0-9._-]{1,32}',build):raise ValueError('Invalid original Version')
    if game=='altv' and build not in ['release','rc','dev']:raise ValueError('Invalid BUILD')
    prefix=env.get('DEDICATED_ARCHIVE_PREFIX','')
    if prefix and not re.fullmatch(r'[A-Za-z0-9._-]{1,100}',prefix):raise ValueError('Archive prefix must be one safe directory name')
    return {'version':build+'-'+digest[:12],'url':url,'sha256':digest,'prefix':prefix or None}

def install(game,root,env):
    root=root.resolve();target=root/game;config=target/('server.toml' if game=='altv' else 'server.cfg' if game=='samp' else 'conf.json')
    if any(not (root/name).resolve().is_relative_to(root) for name in ['.voltra/'+game,'.voltra/public-cache']):raise ValueError('Archived toolkit installer state escapes volume')
    if not config.resolve().is_relative_to(root):raise ValueError('Toolkit config escapes volume')
    original=config.read_bytes() if config.is_file() else None
    try:module('native-release').install_release(root,identity(game,env),game,'altv-server' if game=='altv' else 'samp03svr' if game=='samp' else 'ragemp-server')
    finally:
        if original is not None and config.read_bytes()!=original:config.write_bytes(original)
    module('gta-install').migrate(root,game,['server.toml','modules','resources','data'] if game=='altv' else ['server.cfg','gamemodes','filterscripts','plugins','scriptfiles','samp.ban'] if game=='samp' else ['conf.json','packages','client_packages','plugins','maps','dotnet/resources','dotnet/settings.xml'])

if __name__=='__main__':install(sys.argv[1],Path(os.environ.get('VOLTRA_SERVER_ROOT','/mnt/server')),os.environ)
