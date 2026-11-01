#!/usr/bin/env python3
"""ATS-only prerequisite gate and native-file authority. No acquisition on import."""
import json
import os
from pathlib import Path
import re
import sys
import importlib.util

FOLDER = '.local/share/American Truck Simulator'
DEFAULTS = {'lobby_name':'American Truck Simulator server','description':'','welcome_message':'','password':'','max_players':8,'max_vehicles_total':100,'max_ai_vehicles_player':50,'max_ai_vehicles_player_spawn':50,'connection_virtual_port':100,'query_virtual_port':101,'connection_dedicated_port':27015,'query_dedicated_port':27016,'server_logon_token':'','player_damage':True,'traffic':True,'hide_in_company':False,'hide_colliding':True,'force_speed_limiter':False,'mods_optioning':False,'timezones':2,'service_no_collision':False,'in_menu_ghosting':False,'name_tags':True,'moderator_list':0}

def confined(root, relative):
    root = Path(root).absolute()
    target = root / relative
    for path in [target, *target.parents]:
        if path.is_symlink(): raise ValueError('ATS paths cannot use symlinks')
        if path == root: break
    if not target.resolve().is_relative_to(root.resolve()): raise ValueError('ATS path escapes volume')
    return target

def scalar(value):
    return json.dumps(value, ensure_ascii=False)

def parse(content):
    # Accept only the documented single SII unit, retaining all original spans.
    pattern = r'\A\s*SiiNunit\s*\{\s*server_config\s*:\s*[\w.]+\s*\{\s*\n(?P<body>[\s\S]*?)\n\s*\}\s*\}\s*\Z'
    unit = re.fullmatch(pattern, content)
    if not unit: raise ValueError('Unsupported ATS SII structure')
    fields = {}
    offset = unit.start('body')
    for line in unit['body'].splitlines(keepends=True):
        if not line.strip() or line.lstrip().startswith(('#','//')):
            offset += len(line); continue
        match = re.fullmatch(r'\s*([a-z_]+(?:\[\d+\])?)\s*:\s*("(?:\\.|[^"\\])*"|true|false|-?\d+)(?:[ \t]*(?://[^\r\n]*|#[^\r\n]*)?)?\r?\n?', line)
        if not match or match[1] in fields: raise ValueError('Malformed/duplicate ATS setting')
        fields[match[1]] = (json.loads(match[2]), offset+match.start(2), offset+match.end(2))
        offset += len(line)
    for key, default in DEFAULTS.items():
        if key not in fields: raise ValueError('Missing ATS field: '+key)
        value = fields[key][0]
        if type(value) is not type(default): raise ValueError('Invalid ATS field type: '+key)
    for key, limit in [('lobby_name',63),('description',63),('welcome_message',127),('password',63),('server_logon_token',32)]:
        text(fields[key][0], key, limit)
    for key, lo, hi in [('max_players',1,8),('timezones',0,2),('connection_virtual_port',100,200),('query_virtual_port',100,200),('connection_dedicated_port',1,65535),('query_dedicated_port',1,65535)]:
        if not lo <= fields[key][0] <= hi: raise ValueError('Out of range ATS field: '+key)
    return fields

def text(value, key, limit):
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value): raise ValueError('Invalid '+key)
    return value

def preflight(root, env):
    if env.get('SRCDS_APPID','2239530') != '2239530': raise ValueError('Wrong ATS server AppID')
    for key in ('AUTO_UPDATE','VOLTRA_STEAM_AUTO_UPDATE'):
        if env.get(key,'0') not in ('0','1'): raise ValueError('Invalid '+key)
    if any(env.get(k,'') for k in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')) or env.get('STEAM_USER','anonymous') not in ('','anonymous'): raise ValueError('ATS uses anonymous acquisition')
    lobby = text(env.get('LOBBY_NAME',DEFAULTS['lobby_name']),'LOBBY_NAME',63)
    token = text(env.get('STEAM_TOKEN',''),'STEAM_TOKEN',32)
    if token and not re.fullmatch('[0-9a-fA-F]{32}',token): raise ValueError('Invalid Steam token format')
    raw = env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch(r'\d+(?:,\d+)*',raw): raise ValueError('Missing allocations')
    available = {int(p) for p in raw.split(',')}
    if any(not 1<=p<=65535 for p in available): raise ValueError('Invalid allocation')
    primary = int(env['SERVER_PORT'])
    query = int(env['QUERY_PORT']) if env.get('QUERY_PORT') else next(iter(sorted(available-{primary})),0)
    if primary not in available or query not in available or primary==query: raise ValueError('Distinct allocated ATS ports required')
    for name in ('server_packages.sii','server_packages.dat'):
        path = confined(root,FOLDER+'/'+name)
        if not path.is_file() or path.stat().st_size==0: raise ValueError('Upload matching operator-exported '+name+' before acquisition')
    target = confined(root,FOLDER+'/server_config.sii')
    content = target.read_text(encoding='utf-8') if target.exists() else 'SiiNunit\n{\nserver_config : voltra.ats {\n'+''.join(' '+key+': '+scalar(value)+'\n' for key,value in {**DEFAULTS,'lobby_name':lobby,'server_logon_token':token}.items())+'}\n}\n'
    fields = parse(content)
    changes = {'connection_dedicated_port':primary,'query_dedicated_port':query}
    for key,value in sorted(changes.items(),key=lambda row:fields[row[0]][1],reverse=True):
        _,start,end = fields[key]; content = content[:start]+str(value)+content[end:]
    return target,content,fields['server_logon_token'][0]

def shared():
    path=Path(__file__).with_name('truck-trackmania-native.py')
    spec=importlib.util.spec_from_file_location('ats_shared_native',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def main(mode,root,env):
    target,content,token = preflight(root,env)
    if mode=='preflight': return 0
    if mode not in ('install','run'): raise ValueError('Unknown ATS action')
    native=shared()
    if mode=='install' or env.get('VOLTRA_STEAM_AUTO_UPDATE','0')=='1': native.install(root,'ats',env)
    if mode=='install': return 0
    # Seed once; thereafter only allocation-owned ports are reconciled.
    if not target.exists() or target.read_text(encoding='utf-8')!=content: native.native.private_write(target,content)
    environment=dict(env,HOME=str(root),XDG_DATA_HOME=str(root/'.local/share'))
    for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD'): environment.pop(key,None)
    code=native.helper('native-console').run(root,[str(root/'bin/linux_x64/amtrucks_server')],environment,'\x03',[token,parse(content)['password'][0]],terminal_input=True)
    return code if code>=0 else 128-code

if __name__=='__main__':
    try: sys.exit(main(sys.argv[1],Path.cwd(),dict(os.environ)))
    except (ValueError,OSError,KeyError):
        print('ATS setup refused. Check allocated ports, native config and matching operator package exports.',file=sys.stderr);sys.exit(1)

