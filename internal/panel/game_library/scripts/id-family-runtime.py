#!/usr/bin/env python3
"""MIT. Native ID-family launch controls, console and query readiness."""
import os
from pathlib import Path
import re
import shlex
import threading
import time
from native_console import run
from id_family_query import query

def number(env,key,default,minimum,maximum):
 value=int(env.get(key,'') or default)
 if not minimum<=value<=maximum:raise ValueError(key+' outside supported range')
 return value

def text(value,limit=255):
 if len(value.encode())>limit or any(c in value for c in '\0\r\n'):raise ValueError('Invalid native argument')
 return value

def confined(root,path):
 if not path.resolve().is_relative_to(root.resolve()):raise ValueError('Native path escapes volume')
 return path

def native_value(value):
 value=text(value)
 if any(c in value for c in '"\\'):raise ValueError('Native NZP console strings cannot contain double quotes or backslashes')
 return '"'+value+'"'

def configure(env,root,kind):
 mode=env.get('NZP_ENGINE','vril')
 if kind=='nzportable' and mode not in ('vril','fte_legacy'):raise ValueError('Choose modern Vril or legacy FTE')
 game=confined(root,root/kind/mode if kind=='nzportable' else root/kind);port=number(env,'SERVER_PORT',10666,1,65535)
 if kind=='zandronum':
  binary=game/'zandronum-server';iwad=env.get('IWAD','freedoom1.wad')
  if not iwad or not confined(game,game/'IWAD'/iwad).is_file():raise ValueError('Selected IWAD is missing')
  argv=[str(binary),'-port',str(port),'-config',str(confined(game,game/'zandronum.ini')),'-iwad',str(game/'IWAD'/iwad)]
  pwads=shlex.split(env.get('PWADS',''))
  if pwads:
   argv+=['-file']
   for name in pwads:
    if name.startswith('-') or not confined(game,game/'PWAD'/name).is_file():raise ValueError('Selected PWAD is missing or invalid')
    argv.append(str(game/'PWAD'/name))
  maximum=number(env,'MAX_PLAYERS',16,1,128)
  argv+=['-host',str(maximum),'-skill',str(number(env,'SKILL',3,0,15)),'-netmode','1','+set','sv_maxplayers',str(maximum)]
  for key in ['DMFLAGS','DMFLAGS2','ZADMFLAGS','COMPATFLAGS','COMPATFLAGS2','ZACOMPATFLAGS']:
   argv+=['+set',key.lower(),str(number(env,key,0,-2147483648,4294967295))]
  # Native global console controls remain available; managed values apply last.
  argv+=['+set','sv_hostname',text(env.get('SERVER_NAME','Zandronum server')),
         '+set','sv_broadcast',str(number(env,'PUBLIC_SERVER',0,0,1)),
         '+set','sv_updatemaster',str(number(env,'PUBLIC_SERVER',0,0,1)),
         '+set','sv_password',text(env.get('SERVER_PASSWORD','')),
         '+set','sv_forcepassword','1' if env.get('SERVER_PASSWORD') else '0']
  mapname=env.get('MAP','') or 'e1m1'
 else:
  binary=game/('nzportable-server' if mode=='vril' else 'fteqw-sv64');mapname=env.get('MAP','ndu');tick=env.get('TICKRATE','0.045')
  if not .001<=float(tick)<=20:raise ValueError('TICKRATE outside supported range')
  protocol=text(env.get('PROTOCOL','NZP-REBOOT'),50)
  extra=shlex.split(text(env.get('GAME_ARGS',''),200))
  if mode=='vril':extra=[native_value(value) if any(c.isspace() for c in value) or ';' in value else value for value in extra]
  # Arguments use native argv, never shell evaluation. Native +commands remain supported.
  maximum=number(env,'NZP_MAXPLAYERS',4,1,16)
  if mode=='vril' and port+maximum>65535:raise ValueError('Modern NZP client-port allocations overflow UDP port range')
  if mode=='vril':
   if protocol!='NZP-REBOOT':raise ValueError('Custom FTE/Web PROTOCOL requires the matched legacy FTE engine')
   if number(env,'PUBLIC_SERVER',0,0,1):raise ValueError('Master registration is available only in legacy FTE mode')
   argv=[str(binary),'-dedicated',str(maximum),'-basedir',str(game),'-game','nzp','-port',str(port),'+vid_renderer','headless','+exec','voltra-server.cfg','+sys_ticrate',tick,'+hostname',native_value(env.get('SERVER_NAME','Nazi Zombies: Portable server')),*extra]
  else:
   argv=[str(binary),'-dedicated','-nohome','-basedir',str(game),'-game','nzp','+exec','voltra-server.cfg','+sv_port',str(port),'+sv_port_tcp',str(port),'+com_protocolname',protocol,'+net_enable_websockets',str(int(protocol.upper().endswith(('-WEB','_WEB')))),'+sv_mintic',tick,
         '+hostname',text(env.get('SERVER_NAME','Nazi Zombies: Portable server'),100),'+sv_public',str(number(env,'PUBLIC_SERVER',0,0,1)),*extra]
 if not re.fullmatch(r'[A-Za-z0-9_/-]{1,63}',mapname) or '..' in mapname.split('/'):raise ValueError('Invalid native map basename')
 argv+=['+map',mapname]
 return game,argv,port

def probe(kind,port):
 for _ in range(180):
  try:
   result=query(kind,'127.0.0.1',port,.5)
   if result.get('map'):print('VOLTRA_ID_NATIVE_READY',flush=True);return
  except (ValueError,OSError,KeyError,IndexError):pass
  time.sleep(1)
 print('VOLTRA_ID_NATIVE_QUERY_TIMEOUT',flush=True)

def main():
 import sys
 kind=sys.argv[1]
 if kind not in ('zandronum','nzportable'):raise ValueError('Unknown ID-family game')
 root=Path.cwd().resolve();game,argv,port=configure(os.environ,root,kind)
 environment=dict(os.environ)
 for key in ['PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH']:environment.pop(key,None)
 # Unmodified engine console exit persists native settings before shutdown.
 query_kind='nzportable-vril' if kind=='nzportable' and os.environ.get('NZP_ENGINE','vril')=='vril' else kind
 if query_kind=='nzportable-vril':
  environment.update(LD_LIBRARY_PATH=str(game/'lib'),SDL_VIDEODRIVER='dummy',SDL_AUDIODRIVER='dummy')
 threading.Thread(target=probe,args=(query_kind,port),daemon=True).start()
 result=run(game,argv,environment,'quit',credentials=[os.environ.get('SERVER_PASSWORD','')],terminal_input=True)
 print('VOLTRA_ID_EXIT '+str(result),flush=True)
 return result

if __name__=='__main__':raise SystemExit(main())
