#!/usr/bin/env python3
"""MIT. Preserve native GTAC scripting/module configuration and console."""
import importlib.util
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def configure(root,env):
    common=module('gta-runtime');path=root/'gtac/server.xml';raw=path.read_text()
    if '<!DOCTYPE' in raw.upper() or '<!ENTITY' in raw.upper():raise ValueError('XML entity declarations unsupported')
    config=ET.fromstring(raw,parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    if config.tag!='server':raise ValueError('Invalid GTAC configuration root')
    primary,ports=common.allocated(env)
    game=env.get('GAMETYPE','gta:iv')
    if game not in ['gta:iii','gta:vc','gta:sa','gta:ug','gta:iv','gta:eflc']:raise ValueError('Invalid GAMETYPE')
    public=env.get('SERVERBROWSER','false')
    if public not in ['true','false']:raise ValueError('Invalid SERVERBROWSER')
    values={'servername':common.text(env,'SERVERNAME','Pterodactyl Server',60),'game':game,'port':str(primary),'httpport':str(primary),'bindip':'0.0.0.0','serverbrowser':public,'maxplayers':str(common.number(env,'MAX_PLAYERS',32,1,128)),'password':common.text(env,'SERVER_PASSWORD','',128)}
    for key,value in values.items():
        matches=config.findall(key)
        if len(matches)>1:raise ValueError('Duplicate managed GTAC element '+key)
        node=matches[0] if matches else ET.SubElement(config,key);node.text=value
    common.write_config(root,path,ET.tostring(config,encoding='unicode')+'\n')
    return values

def run(root,env):
    configure(root,env);env=dict(env);env.pop('PYTHONHOME',None);cwd=root/'gtac'
    env['LD_LIBRARY_PATH']=str(cwd)+os.pathsep+env.get('LD_LIBRARY_PATH','')
    return module('native-console').run(cwd,[str(cwd/'Server')],env,'quit',credentials=[env.get('SERVER_PASSWORD','')],terminal_input=True)

if __name__=='__main__':sys.exit(run(Path(os.environ.get('VOLTRA_SERVER_ROOT','/home/container')).resolve(),os.environ))
