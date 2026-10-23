#!/usr/bin/env python3
"""MIT. Native RAGECOOP configuration; no implicit ZeroTier enrollment."""
import importlib.util
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def configure(root,env):
    common=module('gta-runtime');path=root/'ragecoop/Settings.xml'
    raw=path.read_text() if path.is_file() else '<Settings/>'
    if '<!DOCTYPE' in raw.upper() or '<!ENTITY' in raw.upper():raise ValueError('XML entity declarations unsupported')
    config=ET.fromstring(raw,parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    if config.tag!='Settings':raise ValueError('Invalid RAGECOOP settings root')
    primary,ports=common.allocated(env)
    values={'Port':str(primary),'Name':common.text(env,'SERVER_NAME','RAGECOOP server',128),'MaxPlayers':str(common.number(env,'MAX_PLAYERS',32,1,128)),'AnnounceSelf':str(bool(common.number(env,'PUBLIC_SERVER',0,0,1))).lower()}
    for key,value in values.items():
        matches=config.findall(key)
        if len(matches)>1:raise ValueError('Duplicate managed RAGECOOP element '+key)
        node=matches[0] if matches else ET.SubElement(config,key);node.text=value
    # Missing fields retain publisher defaults. Existing operator P2P, voice,
    # ZeroTier, resources and automatic-update choices are never rewritten.
    common.write_config(root,path,ET.tostring(config,encoding='unicode')+'\n');return values

def run(root,env):
    configure(root,env);env=dict(env);env.pop('PYTHONHOME',None);cwd=root/'ragecoop'
    return module('native-console').run(cwd,[str(cwd/'RageCoop.Server')],env,'\x03',ready_marker=b'Listening for clients',terminal_input=True)

if __name__=='__main__':sys.exit(run(Path(os.environ.get('VOLTRA_SERVER_ROOT','/home/container')).resolve(),os.environ))
