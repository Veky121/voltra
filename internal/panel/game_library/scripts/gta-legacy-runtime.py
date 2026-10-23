#!/usr/bin/env python3
"""MIT. Operator archive configuration; no current publisher support implied."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tomllib

def module(name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def patch_toml(raw,values):
    before=tomllib.loads(raw);lines=raw.splitlines();seen=set();out=[];section=False;multiline=None
    for line in lines:
        if multiline:
            out.append(line)
            if multiline in line:multiline=None
            continue
        opening=re.match(r'^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(\x22\x22\x22|\x27\x27\x27)',line)
        if opening and line.count(opening[1])==1:
            multiline=opening[1];out.append(line);continue
        if line.lstrip().startswith('[') and not section:
            out.extend(key+' = '+json.dumps(value,ensure_ascii=False) for key,value in values.items() if key not in seen);section=True
        match=re.match(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=',line)
        if not section and match and match[1] in values:
            key=match[1];out.append(key+' = '+json.dumps(values[key],ensure_ascii=False));seen.add(key)
        else:out.append(line)
    if not section:out.extend(key+' = '+json.dumps(value,ensure_ascii=False) for key,value in values.items() if key not in seen)
    result='\n'.join(out)+'\n';after=tomllib.loads(result)
    if any(after.get(key)!=value for key,value in before.items() if key not in values):raise ValueError('TOML patch would modify operator-owned data')
    if any(after.get(key)!=value for key,value in values.items()):raise ValueError('Unsupported managed TOML syntax')
    return result

def configure(game,root,env):
    common=module('gta-runtime');primary,ports=common.allocated(env)
    if game=='altv':
        path=root/'altv/server.toml';raw=path.read_text() if path.is_file() else 'modules = []\nresources = []\nannounce = false\n'
        values={'host':'0.0.0.0','port':primary,'password':common.text(env,'PASSWORD','',128),'description':common.text(env,'SERVER_DESC','A Pterodactyl Hosted Server.',250)}
        common.write_config(root,path,patch_toml(raw,values));return values
    if game=='ragemp':
        if primary+1 not in ports:raise ValueError('RAGE MP requires allocated game port+1 for HTTP')
        path=root/'ragemp/conf.json';config=json.loads(path.read_text()) if path.is_file() else {'announce':False,'gamemode':'freeroam','language':'en','stream-distance':500.0,'csharp':False}
        if not isinstance(config,dict):raise ValueError('RAGE MP config must be an object')
        config.update({'bind':'0.0.0.0','port':primary,'name':common.text(env,'SERVER_NAME','RAGE:MP Unofficial server',64),'maxplayers':common.number(env,'MAX_PLAYERS',50,1,100)})
        common.write_config(root,path,json.dumps(config,indent=2)+'\n');return config
    raise ValueError('Unknown discontinued toolkit')

def run(game,root,env):
    configure(game,root,env);env=dict(env);env.pop('PYTHONHOME',None);cwd=root/game
    env['LD_LIBRARY_PATH']=str(cwd)+os.pathsep+env.get('LD_LIBRARY_PATH','')
    return module('native-console').run(cwd,[str(cwd/('altv-server' if game=='altv' else 'ragemp-server'))],env,'quit' if game=='altv' else '\x18',credentials=[env.get('PASSWORD','')],terminal_input=True)

if __name__=='__main__':sys.exit(run(sys.argv[1],Path(os.environ.get('VOLTRA_SERVER_ROOT','/home/container')).resolve(),os.environ))
