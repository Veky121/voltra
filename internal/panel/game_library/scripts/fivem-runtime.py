#!/usr/bin/env python3
"""MIT. Native FXServer/txAdmin with an explicit documented LAN-only mode."""
import importlib.util
import os
from pathlib import Path
import re
import sys

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def quote(value):
    if any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid native configuration text')
    return '"'+value.replace('\\','\\\\').replace('"','\\"')+'"'

def configure(root,env,require_license=True):
    common=module('gta-runtime');primary,ports=common.allocated(env)
    lan=common.number(env,'LAN_ONLY',1,0,1);txadmin=common.number(env,'TXADMIN_ENABLE',0,0,1)
    license=common.text(env,'FIVEM_LICENSE',env.get('CFX_LICENSE',''),256)
    if require_license and not license:raise ValueError('Current FXServer artifact requires your real Cfx server license key, including LAN mode. Obtain your own key from the Cfx portal; no account or credential is created by setup.')
    game=env.get('TXHOST_GAME_NAME',env.get('VOLTRA_CFX_GAME','fivem'))
    if game not in ['fivem','redm']:raise ValueError('Invalid TXHOST_GAME_NAME')
    txport=common.number(env,'TXHOST_TXA_PORT',0,0,65535)
    if txadmin:
        available=sorted(ports-{primary})
        if not txport:
            if not available:raise ValueError('txAdmin needs an additional allocated HTTP port')
            txport=available[0]
        if txport not in ports or txport==primary:raise ValueError('txAdmin HTTP port must be a distinct allocation')
    txdata=env.get('TXHOST_DATA_PATH','/home/container/txData')
    # Retain the original container path API and allow only owned descendants.
    path=root/'txData' if txdata=='/home/container/txData' else (Path(txdata) if Path(txdata).is_absolute() else root/txdata)
    if not path.resolve().is_relative_to(root):raise ValueError('TXHOST_DATA_PATH escapes owned volume')
    if txadmin:path.mkdir(parents=True,exist_ok=True)
    cfg=root/'server.cfg';raw=cfg.read_text() if cfg.is_file() else ''
    keys=['sv_licenseKey','steam_webApiKey','sv_maxclients','sv_maxplayers','sv_hostname','sv_lan','gamename']
    pattern=re.compile(r'^\s*(?:(?:set|setr|sets)\s+)?(?:'+('|'.join(keys))+r')\s+',re.I)
    # Preserve comments, resource startup, ACE/ACL/RCON and every other convar.
    lines=[line for line in raw.splitlines() if not pattern.match(line) and not re.match(r'^\s*endpoint_add_(?:tcp|udp)\s+',line,re.I)]
    maximum=32 if env.get('VOLTRA_CFX_GAME')=='redm' else 48
    lines.extend(['endpoint_add_tcp '+quote('0.0.0.0:'+str(primary)),'endpoint_add_udp '+quote('0.0.0.0:'+str(primary)),'sv_hostname '+quote(common.text(env,'SERVER_HOSTNAME','My new FXServer!',128)),'sv_maxclients '+str(common.number(env,'MAX_PLAYERS',32 if maximum==32 else 48,1,maximum)),'set sv_lan '+('true' if lan else 'false'),'set gamename '+quote('rdr3' if game=='redm' else 'gta5'),'sv_licenseKey '+quote(license),'set steam_webApiKey '+quote(common.text(env,'STEAM_WEBAPIKEY','none',256))])
    common.write_config(root,cfg,'\n'.join(lines)+'\n')
    return {'txadmin':bool(txadmin),'txport':txport,'txdata':path,'game':game,'lan':bool(lan),'primary':primary}

def run(root,env):
    settings=configure(root,env);env=dict(env);env.pop('PYTHONHOME',None)
    engine=root/'fivem/alpine';server=engine/'opt/cfx-server'
    argv=[str(server/'ld-musl-x86_64.so.1'),'--library-path',':'.join(str(engine/p) for p in ['usr/lib/v8','lib','usr/lib']),'--',str(server/'FXServer'),'+set','citizen_dir',str(server/'citizen'),'+set','sv_lan','true' if settings['lan'] else 'false']
    if settings['txadmin']:argv.extend(['+set','txAdminPort',str(settings['txport']),'+set','txDataPath',str(settings['txdata']),'+set','gamename','rdr3' if settings['game']=='redm' else 'gta5'])
    else:argv.extend(['+exec','server.cfg'])
    return module('native-console').run(root,argv,env,'quit',credentials=[env.get('FIVEM_LICENSE',''),env.get('CFX_LICENSE',''),env.get('STEAM_WEBAPIKEY','')],terminal_input=True)

if __name__=='__main__':sys.exit(run(Path(os.environ.get('VOLTRA_SERVER_ROOT','/home/container')).resolve(),os.environ))
