"""MIT literal-argument native adapters. Existing native operator files remain editable."""
import os,re,sys,time,urllib.request
from pathlib import Path
from native_config import private_write
from native_console import run

def text(value,maximum=200):
 if not isinstance(value,str) or len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Native text must be a single bounded line')
 return value
def number(value,low,high):
 if not re.fullmatch('[0-9]+',str(value)) or not low<=int(value)<=high:raise ValueError('Native number outside supported range')
 return str(int(value))
def confined(root,path):
 if not path.resolve().is_relative_to(root):raise ValueError('Native path leaves server volume')
 return path
def patch(content,values):
 lines=[];seen=set()
 for line in content.splitlines(keepends=True):
  if not line.lstrip().startswith(('#',';','--','//')) and '=' in line:
   key=line.split('=',1)[0].strip()
   if key in values:
    if key in seen:raise ValueError('Duplicate managed native setting')
    seen.add(key);line=key+'='+values[key]+'\n'
  lines.append(line)
 if lines and not lines[-1].endswith('\n'):lines[-1]+='\n'
 return ''.join(lines)+''.join(k+'='+v+'\n' for k,v in values.items() if k not in seen)
def configure(root,game,env):
 root=root.resolve();port=number(env.get('SERVER_PORT',''),1,65535)
 if int(port) not in {int(x) for x in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if x}:raise ValueError('Choose an allocated primary port')
 environment={k:v for k,v in env.items() if k not in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH')};environment.update(HOME=str(root),XDG_CONFIG_HOME=str(root/'.voltra/small-games-family/config'),DOTNET_CLI_TELEMETRY_OPTOUT='1',DOTNET_EnableDiagnostics='0',XVFB='0')
 credentials=[];cwd=confined(root,root/game)
 if game=='clone':
  password=text(env.get('SERVER_PASSWORD',''),128);name=text(env.get('SERVER_DISPLAY_NAME','Clone Hero Server'),80)
  if not name:raise ValueError('Choose a server display name')
  argv=[str(cwd/'Server'),'-l',number(env.get('LOG_LEVEL','4'),0,4),'-n',name,'-p',port,'-a','0.0.0.0']+(['-ps',password] if password else ['-np']);stop='\x03';ready='Server running...';credentials=[password]
 elif game=='tachyon':
  path=confined(root,cwd/'config.cfg');previous=path.read_text() if path.exists() else '';values={'SERVER_PORT':port}
  updated=patch(previous,values)
  if updated!=previous:
   if path.exists():private_write(root/'.voltra/small-games-family/backups'/('tachyon-'+str(time.time_ns())+'.cfg'),previous)
   private_write(path,updated)
  heap=max(128,int(number(env.get('SERVER_MEMORY','1024'),256,65536))*75//100)
  argv=[str(root/'.voltra/java8/bin/java'),'-Xms128M','-Xmx'+str(heap)+'M','-Djava.awt.headless=true','-jar','TachyonsCEServer.jar'];stop='/exit';ready='[Server] SERVER STARTED.'
 elif game=='stk':
  name=text(env.get('CONFIG_NAME','config.xml'),100)
  if not re.fullmatch(r'[A-Za-z0-9_.-]+\.xml',name):raise ValueError('Choose a plain XML configuration filename')
  config=confined(root,root/name)
  argv=[str(cwd/'bin/supertuxkart'),'--no-graphics','--server-config='+str(config),'--lan-server='+text(env.get('SERVER_NAME','SuperTuxKart Server'),50),'--network-console','--port='+port,'--difficulty='+number(env.get('DIFFICULTY','0'),0,3),'--mode='+number(env.get('MODE','0'),0,5),'--max-players='+number(env.get('MAX_PLAYERS','8'),1,24),'--motd='+text(env.get('MOTD',''),100)];stop='quit';ready='Available command:'
  environment['SUPERTUXKART_DATADIR']=str(cwd/'data')
 elif game=='mohaa':
  base=confined(root,Path(env.get('BASE_PATH') or str(root)));logs=confined(root,Path(env.get('LOG_DIR') or str(root/'Logs')))
  # The open engine does not license or include EA's original assets.
  if not (base/'main/Pak0.pk3').is_file():raise ValueError('MOHAA requires your legally acquired main/Pak*.pk3 files under BASE_PATH; original game assets are not downloaded')
  config=confined(root,base/'main/server.cfg');name=text(env.get('SERVER_NAME','MOHAA Server'));maximum=number(env.get('SERVER_MAXCLIENTS','14'),1,64);password=text(env.get('SERVER_PASSWORD',''));rcon=text(env.get('RCON_PASSWORD',''));mapname=text(env.get('SERVER_MAP','dm/mohdm7'),80)
  if not re.fullmatch(r'(dm|obj)/[A-Za-z0-9_-]+',mapname):raise ValueError('Invalid native MOHAA map')
  for value in [name,password,rcon]:
   if any(c in value for c in ['"','\\',';']):raise ValueError('MOHAA config values cannot contain native command separators')
  if not config.exists():
   url=env.get('CONFIG_URL','')
   if not url.startswith('https://'):raise ValueError('Initial MOHAA config requires its configured HTTPS template URL')
   with urllib.request.urlopen(url,timeout=30) as response:template=response.read(1048577)
   if len(template)>1048576:raise ValueError('Initial MOHAA config is too large')
   private_write(config,template.decode('utf-8-sig'))
  managed=confined(root,base/'main/voltra-server.cfg');private_write(managed,'exec server.cfg\n'+f'seta sv_hostname "{name}"\nseta sv_maxclients "{maximum}"\nseta rconPassword "{rcon}"\nseta g_password "{password}"\nmap "{mapname}"\n')
  # OpenMoHAA uses fs_homepath for writable output; the old closed engine's
  # fs_outputpath variable is not implemented and must not be silently ignored.
  argv=[str(cwd/'omohaaded'),'+set','com_target_game','0','+set','sv_punkbuster','0','+set','fs_basepath',str(base),'+set','fs_homepath',str(logs),'+set','com_logfile','1','+set','dedicated','2','+set','net_ip','0.0.0.0','+set','net_port',port,'+exec','voltra-server.cfg'];stop='quit';ready='Server Initialization Complete';credentials=[password,rcon];environment['LD_LIBRARY_PATH']=str(cwd)
 else:raise ValueError('Unknown small native game')
 if not Path(argv[0]).is_file():raise ValueError('Install the reviewed native server before starting')
 return cwd,argv,environment,stop,credentials,ready
if __name__=='__main__':
 cwd,argv,environment,stop,credentials,ready=configure(Path.cwd(),sys.argv[1],dict(os.environ))
 sys.exit(run(cwd,argv,environment,stop,credentials,ready_marker=ready.encode(),terminal_input=True,terminal_query_reply=True))
