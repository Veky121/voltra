"""Install-time only seed for Factorio; existing native bytes stay authoritative."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile

FIELDS={'SERVER_NAME':('name',str,100),'SERVER_DESC':('description',str,200),'MAX_SLOTS':('max_players',int,999),'SERVER_USERNAME':('username',str,40),'SERVER_TOKEN':('token',str,100),'GAME_PASSWORD':('game_password',str,100),'SAVE_INTERVAL':('autosave_interval',int,999),'SAVE_SLOTS':('autosave_slots',int,999),'AFK_KICK':('afk_autokick_interval',int,999)}

def pairs(rows):
    result={}
    for key,value in rows:
        if key in result:raise ValueError('Duplicate native JSON key')
        result[key]=value
    return result

def read(path):
    if path.stat().st_size>4*1024*1024:raise ValueError('Native settings exceed limit')
    value=json.loads(path.read_text(encoding='utf-8'),object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('Non-finite JSON')))
    if not isinstance(value,dict):raise ValueError('Native settings must be an object')
    return value

def values(env):
    result={}
    for variable,(key,kind,maximum) in FIELDS.items():
        value=env.get(variable,'')
        if kind is int:
            if not re.fullmatch(r'[0-9]{1,3}',value)or not (1 if variable=='SAVE_SLOTS'else 0)<=int(value)<=maximum:raise ValueError('Invalid '+variable)
            value=int(value)
        elif len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+variable)
        result[key]=value
    result['visibility']={}
    for variable,key in [('PUBLIC_SERVER','public'),('LAN_SERVER','lan')]:
        if env.get(variable)not in ('0','1'):raise ValueError('Invalid '+variable)
        result['visibility'][key]=env[variable]=='1'
    if result['visibility']['public']and not(result['username']and result['token']):raise ValueError('Public listing requires Factorio username and token')
    return result

def validate(value):
    for key,kind in [(row[0],row[1])for row in FIELDS.values()]:
        if key in value and type(value[key])is not kind:raise ValueError('Invalid native '+key)
    if 'password'in value and type(value['password'])is not str:raise ValueError('Invalid native password')
    visibility=value.get('visibility',{})
    if not isinstance(visibility,dict):raise ValueError('Invalid native visibility')
    for key in ('public','lan'):
        if key in visibility and type(visibility[key])is not bool:raise ValueError('Invalid native visibility')
    if visibility.get('public')and not(value.get('username')and(value.get('token')or value.get('password'))):raise ValueError('Native public listing requires Factorio credentials')

def prepare(root,env,seed=False):
    root=Path(root);target=root/'data/server-settings.json';example=root/'data/server-settings.example.json'
    if root.is_symlink()or root.resolve()!=root.absolute():raise ValueError('Unsafe server root')
    for p in (root/'data',target,example):
        if p.is_symlink():raise ValueError('Native settings paths must not be symlinks')
    creation=values(env)
    if target.exists():
        validate(read(target));return False
    if not seed:return False
    initial=read(example)
    visibility=initial.get('visibility',{})
    if not isinstance(visibility,dict):raise ValueError('Invalid example visibility')
    initial.update({k:v for k,v in creation.items()if k!='visibility'})
    initial['visibility']={**visibility,**creation['visibility']};validate(initial)
    # Exclusive creation only: a concurrent/operator file is never replaced.
    fd,name=tempfile.mkstemp(prefix='.factorio-seed-',dir=target.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8',newline='\n')as output:
            json.dump(initial,output,ensure_ascii=False,indent=2,allow_nan=False);output.write('\n');output.flush();os.fsync(output.fileno())
        os.link(name,target) # Publish complete fresh bytes; refuse an existing destination.
    finally:
        os.unlink(name)
    return True

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--seed',action='store_true');args=p.parse_args()
    try:prepare(Path(args.root),os.environ,args.seed)
    except (ValueError,OSError)as error:
        # Do not include native JSON, URLs or credentials in diagnostics.
        print('Factorio native settings preflight refused; verify settings types, paths and creation controls.',file=sys.stderr);return 2
    return 0
if __name__=='__main__':raise SystemExit(main())
