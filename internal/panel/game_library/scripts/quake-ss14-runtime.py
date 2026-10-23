#!/usr/bin/env python3
"""MIT. Native launch adapters sharing the common console supervisor."""
import os
from pathlib import Path
import re
import sys
import threading
import time
import tempfile
import stat
from native_console import run
from quake_ss14_query import query

def text(value,maximum=255):
 if len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid native text value')
 return value

def number(env,key,default,low,high):
 value=int(env.get(key,str(default)))
 if not low<=value<=high:raise ValueError(key+' outside supported range')
 return value

def quoted(value,maximum=255):
 text(value,maximum)
 if any(c in value for c in '"\\;'):raise ValueError('Quake settings cannot contain command delimiters')
 return '"'+value+'"'

QL_FOOTER=b'\n// BEGIN VOLTRA QUAKE MANAGED\nexec voltra-managed.cfg\n// END VOLTRA QUAKE MANAGED\n'

def quake_footer(root):
 target=root/'baseq3/server.cfg';backups=root/'.voltra/quakelive/config-backups'
 if not target.resolve().is_relative_to(root) or not backups.resolve().is_relative_to(root):raise ValueError('Quake operator config escapes volume')
 if target.is_symlink():raise ValueError('Quake operator config cannot be a symlink')
 original=target.read_bytes() if target.exists() else b''
 if original.endswith(QL_FOOTER) and original.count(QL_FOOTER)==1:return
 if b'// BEGIN VOLTRA QUAKE MANAGED' in original or b'// END VOLTRA QUAKE MANAGED' in original:raise ValueError('Restore the managed Quake config footer before changing settings')
 metadata=target.stat() if target.exists() else None
 if metadata:
  backups.mkdir(parents=True,exist_ok=True);fd,name=tempfile.mkstemp(prefix='server-',suffix='.cfg',dir=backups)
  with os.fdopen(fd,'wb') as output:output.write(original)
 target.parent.mkdir(parents=True,exist_ok=True);fd,name=tempfile.mkstemp(prefix='.voltra-',dir=target.parent)
 try:
  with os.fdopen(fd,'wb') as output:output.write(original+QL_FOOTER)
  if metadata:os.chmod(name,stat.S_IMODE(metadata.st_mode));os.chown(name,metadata.st_uid,metadata.st_gid)
  else:os.chmod(name,0o600)
  os.replace(name,target)
 finally:
  if os.path.exists(name):os.unlink(name)

def configure(root,env,kind):
 root=Path(root).resolve();port=number(env,'SERVER_PORT',27960,1025,65535)
 if kind=='ss14':
  game=root/'ss14';maximum=number(env,'SERVER_MAX_PLAYERS',256,1,256)
  if not game.resolve().is_relative_to(root):raise ValueError('SS14 path escapes volume')
  values={'net.port':str(port),'status.bind':'*:'+str(port),'net.tickrate':str(number(env,'SERVER_TICK',60,1,80)),
   'net.max_connections':str(maximum),'game.soft_max_players':str(maximum),'game.hostname':text(env.get('SERVER_NAME','MyServer'),48),'hub.advertise':str(bool(number(env,'PUBLIC_SERVER',0,0,1))).lower()}
  argv=[str(game/'Robust.Server')]
  for key,value in values.items():argv+=['--cvar',key+'='+value]
  return game,argv,port
 if kind!='quakelive':raise ValueError('Unknown reviewed native game')
 if env.get('SRCDS_APPID','349090')!='349090':raise ValueError('Quake Live app mismatch')
 game=root;folder=root/'quake-live-user/baseq3'
 if not folder.resolve().is_relative_to(root):raise ValueError('Quake home path escapes volume')
 folder.mkdir(parents=True,exist_ok=True)
 mapname=env.get('MAP','campgrounds');factory=env.get('FACTORY','ffa')
 if not re.fullmatch('[A-Za-z0-9_-]{1,63}',mapname) or not re.fullmatch('[A-Za-z0-9_-]{1,63}',factory):raise ValueError('Invalid native map/factory')
 enabled=number(env,'RCON_ENABLE',0,0,1);rcon=0
 if enabled:
  if not env.get('RCON_PASSWORD'):raise ValueError('Set a native RCON password before enabling RCON')
  allocated={int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if p};available=sorted(allocated-{port})
  rcon=number(env,'RCON_PORT',0,0,65535) or (available[0] if available else 0)
  if port not in allocated or rcon not in available:raise ValueError('Allocate a distinct native RCON port')
 values={'sv_hostname':env.get('SERVER_NAME','A Quake Live Server'),'sv_serverType':str(number(env,'SERVER_TYPE',1,0,2)),
  'g_password':env.get('PASSWORD',''),'sv_fps':str(number(env,'FPS',40,40,40)),
  'sv_maxclients':str(number(env,'MAX_PLAYERS',16,1,64)),'sv_idleExit':'0','net_strict':'1',
  'zmq_rcon_enable':str(enabled),'zmq_rcon_port':str(rcon),'zmq_rcon_password':env.get('RCON_PASSWORD',''),
  'zmq_stats_enable':'0','serverstartup':'map '+mapname+' '+factory}
 cfg=folder/'voltra-managed.cfg'
 if cfg.is_symlink():raise ValueError('Managed Quake config cannot be a symlink')
 fd=os.open(cfg,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
 with os.fdopen(fd,'w') as output:
  for key,value in values.items():output.write('set '+key+' '+quoted(value)+'\n')
 quake_footer(root)
 argv=[str(root/'qzeroded.x64'),'+set','fs_homepath',str(folder.parent),'+set','net_ip','0.0.0.0','+set','net_port',str(port),'+set','sv_serverType',values['sv_serverType'],'+set','sv_fps',values['sv_fps'],'+set','net_strict','1','+set','zmq_rcon_enable',str(enabled),'+set','zmq_rcon_port',str(rcon),'+exec','server.cfg','+exec','voltra-managed.cfg']
 return game,argv,port

def probe(kind,port):
 for _ in range(240):
  try:
   result=query(kind,'127.0.0.1',port,.5)
   if kind=='ss14' or result.get('map'):
    print('VOLTRA_QSS_NATIVE_READY',flush=True);return
  except (OSError,ValueError):pass
  time.sleep(.5)

def main(kind):
 root=Path.cwd();env=dict(os.environ)
 automatic=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0'))
 if automatic not in ('0','1'):raise ValueError('AUTO_UPDATE must be boolean')
 if kind=='quakelive' and automatic=='1':
  from quake_ss14_install import install
  install(root,kind)
 game,argv,port=configure(root,env,kind);child={**env,'HOME':str(root)}
 for key in ('PYTHONHOME','PYTHONPATH','LD_LIBRARY_PATH','LD_PRELOAD','ROBUST_CVARS'):
  child.pop(key,None)
 if kind=='ss14':child.update(DOTNET_ROOT=str(root/'dotnet'),DOTNET_CLI_TELEMETRY_OPTOUT='1')
 else:child['LD_LIBRARY_PATH']=str(root/'linux64')
 threading.Thread(target=probe,args=(kind,port),daemon=True).start()
 status=run(game,argv,child,'shutdown VoltraStop' if kind=='ss14' else 'quit',credentials=[env.get('PASSWORD',''),env.get('RCON_PASSWORD','')],terminal_input=True,terminal_query_reply=kind=='ss14')
 print('VOLTRA_QSS_EXIT '+str(status),flush=True);return status if status>=0 else 128-status

if __name__=='__main__':raise SystemExit(main(sys.argv[1]))
