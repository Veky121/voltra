#!/usr/bin/env python3
"""MIT. Night of the Dead/No One Survived/Plains of Pain source adapters."""
import hashlib,importlib.util,json,os,re,shlex,signal,stat,sys,threading
from pathlib import Path

def helper(name):
 path=Path(__file__).with_name(name+'.py')
 if not path.exists():path=path.with_name(name.replace('-','_')+'.py')
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);sys.modules[name.replace('-','_')]=module;spec.loader.exec_module(module);return module
shared=helper('steam-native-next');steam=shared.steam;native=shared.native;console=helper('native-console');wine=helper('private-wine-prerequisites');preservation=helper('wasteland-preservation');logs=helper('wasteland-log')
PINS=json.loads(Path(__file__).with_name('wasteland-servers-pins.json').read_text())
GAMES={'night':(1420710,'windows','LF/Binaries/Win64/LFServer-Win64-Shipping.exe'),'noone':(2329680,'windows','WRSHServer.exe'),'plains':(2227360,'linux','PlainsOfPain.x86_64')}
def path(root,name):return shared.confined(root,root/name)
def text(env,key,default='',limit=255):return shared.text(env,key,default,limit)
def integer(env,key,default,low=1,high=65535):return shared.integer(env,key,default,low,high)
def choice(env,key,default,values):
 value=text(env,key,default)
 if value not in values:raise ValueError('Invalid '+key)
 return value
def signed(env,key,default):
 value=text(env,key,str(default),20)
 if not re.fullmatch(r'-?[0-9]+',value) or not -2147483648<=int(value)<=2147483647:raise ValueError(key+' requires a native signed Int32')
 return int(value)
def save_name(env,key,default):
 value=text(env,key,default,32)
 if not value or value in ['.','..'] or any(c in value for c in '/\\:'):raise ValueError(key+' must be a save name, not a path')
 return value
def ports(env,default_query):
 game=integer(env,'SERVER_PORT',7777);query=integer(env,'QUERY_PORT',default_query);raw=env.get('VOLTRA_ALLOCATED_PORTS','')
 if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Explicit allocations are required')
 available={int(v) for v in raw.split(',')}
 if any(not 1<=v<=65535 for v in available) or game not in available or query not in available or game==query:raise ValueError('Distinct allocated game/query ports required')
 return game,query
def write(root,name,data):
 path(root,name);steam._publish(root,name,lambda output:output.write(data),0o600)
def ini_plan(root,name,sections,default=''):
 target=path(root,name)
 if target.exists() and target.stat().st_size>8*1024**2:raise ValueError('Native INI exceeds budget')
 previous=target.read_text(encoding='utf-8-sig') if target.exists() else default
 # Unreal INI section/managed-key names are case-insensitive; avoid ambiguous
 # duplicate logical settings while retaining repeated unmanaged arrays.
 canonical={section.casefold():section for section in sections};rows=[];active=None
 for row in previous.splitlines(keepends=True):
  header=re.fullmatch(r'\s*\[([^\]]+)\]\s*(?:[;#].*)?',row.strip())
  if header:
   active=canonical.get(header[1].casefold())
   if active:row='['+active+']\n'
  elif active and '=' in row and not row.lstrip().startswith((';','#','//')):
   left,right=row.split('=',1);key=next((value for value in sections[active] if value.casefold()==left.strip().casefold()),None)
   if key:row=key+'='+right
  rows.append(row)
 return name,native.patch_ini(''.join(rows),sections).encode()
def original_gate(root,game,env):
 app,platform,binary=GAMES[game]
 if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Original dedicated app ID required')
 if platform=='windows' and env.get('WINDOWS_INSTALL','1')!='1':raise ValueError('Original Windows platform required')
 steam.arguments(root,app,env,platform=platform,force_platform=True)
 return app,platform,binary
def agreement(game,env):
 if game=='plains' and env.get(PINS['plains_eula']['environment'])!=PINS['plains_eula']['sha256']:
  raise ValueError('Review the current Plains of Pain publisher agreement and explicitly agree before installation or launch')

def verify_plains_eula(root):
 pin=PINS['plains_eula'];target=path(root,pin['path'])
 # Nonblocking/no-follow open prevents a substituted FIFO or final symlink
 # from hanging verification or supplying terms outside this volume.
 fd=os.open(target,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  meta=os.fstat(fd)
  if not stat.S_ISREG(meta.st_mode) or meta.st_size!=pin['bytes'] or meta.st_size>65536:raise ValueError('Packaged Plains EULA missing, unsafe or revised; publisher agreement review required')
  value=b''
  while len(value)<=pin['bytes']:
   chunk=os.read(fd,min(4096,pin['bytes']+1-len(value)))
   if not chunk:break
   value+=chunk
  if len(value)!=pin['bytes'] or hashlib.sha256(value).hexdigest()!=pin['sha256']:raise ValueError('Packaged Plains EULA differs from reviewed terms; publisher agreement review required')
 finally:os.close(fd)

def configure(root,game,env):
 agreement(game,env)
 root=Path(root).resolve()
 if game=='plains':verify_plains_eula(root)
 app,platform,binary=original_gate(root,game,env);primary,query=ports(env,27015 if game=='noone' else 27016);plans=[]
 password=text(env,'SERVER_PASSWORD','',32 if game!='plains' else 20);secrets=[password]
 if game=='night':
  admin=text(env,'SERVER_ADMIN_PASSWORD','',32);secrets.append(admin)
  extra=shlex.split(text(env,'OTHER_ARGS','',8192))
  for value in extra:
   if not value.startswith('-') or any(c in value for c in ['?','\x00']) or value.split('=',1)[0].casefold() in ['-port','-queryport','-userdir','-savedir','-abslog','-config','-exec']:raise ValueError('OTHER_ARGS requires literal optional switches, without managed ports/paths/exec overrides')
  choice(env,'XVFB','1',['1'])
  settings={'ServerSettings':{'ServerName':text(env,'SERVER_NAME','Pterodactyl',32),'Password':password},'SystemSettings':{'SaveName':save_name(env,'SERVER_SAVEGAME','savedgame1'),'IngameAdminPassword':admin,'DefaultMessageOfTheDay':text(env,'SERVER_MOTD','Welcome to the server.',8192)},'GameSettings':{'Difficulty':choice(env,'DIFFICULTY','Normal',['Normal','Peaceful','Easy','Hard','Survival','Challenge','Legend'])},'GameSettings/General':{'MODSelect':choice(env,'PVP','1',['0','1'])}}
  plans.append(ini_plan(root,'LF/Saved/Config/ServerSettings.ini',settings,PINS['night_default_ini']['content']))
  argv=['xvfb-run','-a','wine',str(path(root,binary)),'?listen','-Port='+str(primary),'-QueryPort='+str(query),'-console','-log','--CRASHREPORTS',*extra]
  log='LF/Saved/Logs/LF.log'
 elif game=='noone':
  admin=text(env,'SERVER_ADMIN_PASSWORD','',32);secrets.append(admin)
  plans.append(ini_plan(root,'WRSH/Saved/Config/WindowsServer/Engine.ini',{'URL':{'Port':str(primary)},'OnlineSubsystemSteam':{'bUseSteamNetworking':choice(env,'STEAM_NETWORKING','False',['False','True']),'GameServerQueryPort':str(query)}}))
  plans.append(ini_plan(root,'WRSH/Saved/Config/WindowsServer/Game.ini',{'ServerSetting':{'SaveName':save_name(env,'SERVER_SAVE_NAME','MySave'),'ServerName':text(env,'SERVER_NAME','Test',32),'NeedPassword':choice(env,'SERVER_NEED_PASSWORD','False',['False','True']),'Password':password,'MaxPlayers':str(integer(env,'SERVER_PLAYERS',50,1,100)),'NumOfZombieSpawn':str(integer(env,'SERVER_NUM_ZOMBIES',50,25,100)),'Region':choice(env,'SERVER_REGION','All',['All','AF','AS','EU','NA','OC','SA']),'AdminPassword':admin}}))
  argv=['xvfb-run','-a','wine',str(path(root,binary)),'-server','-log','-Port='+str(primary),'-QueryPort='+str(query)];log=None
 else:
  config=path(root,'configs/server.json')
  if config.exists() and config.stat().st_size>8*1024**2:raise ValueError('Native JSON exceeds budget')
  if config.exists():value=shared.json_unique(config.read_text(encoding='utf-8-sig'))
  else:
   default=path(root,'configs/default.json')
   if default.exists() and default.stat().st_size<=8*1024**2:value=shared.json_unique(default.read_text(encoding='utf-8-sig'))
   else:raise ValueError('Publisher configs/default.json missing or oversized; reinstall the original depot')
  if not isinstance(value,dict):raise ValueError('Publisher configuration must be a JSON object')
  value.update(serverName=text(env,'SERVER_NAME','A Pterodactyl Hosted Server'),worldId=signed(env,'WORLD_ID',1),mapId=signed(env,'MAP_ID',256),seed=signed(env,'SEED',12345),difficulty=integer(env,'DIFFICULTY',1,1,4),worldSize=int(choice(env,'WORLD_SIZE','21',['11','21','31','41','51'])),port=primary,queryPort=query,maxPlayers=integer(env,'MAX_PLAYERS',10,1,200),password=password)
  plans.append(('configs/server.json',(json.dumps(value,indent=2)+'\n').encode()))
  argv=[str(path(root,binary)),'-nographics','-batchmode','-ignorecompilererrors','-cc','-config','configs/server.json','-port',str(primary),'-queryPort',str(query)];log=None
 # Validate every config/field before the first managed file is changed.
 for name,data in plans:write(root,name,data)
 return argv,tuple(value for value in secrets if value),log
def preserved(game):
 return ['Mods','BepInEx/config','BepInEx/plugins','MelonLoader/Mods']+{'night':['LF/Saved'],'noone':['WRSH/Saved'],'plains':['configs','saves','worlds','Saves','Worlds','.config/unity3d/Flying Rat Studio','.config/unity3d/PlainsOfPain','.config/unity3d/CobraByteDigital/PlainsOfPain']}[game]
def install(root,game,env):
 agreement(game,env)
 root=Path(root).resolve();app,platform,binary=original_gate(root,game,env);ports(env,27015 if game=='noone' else 27016)
 with preservation.preserve(root,preserved(game)):receipt=steam.update(root,app,env,platform=platform,force_platform=True,required=(binary,))
 if game=='plains':verify_plains_eula(root)
 if game=='night' and not path(root,'LF/Saved/Config/ServerSettings.ini').exists():write(root,'LF/Saved/Config/ServerSettings.ini',PINS['night_default_ini']['content'].encode())
 if game=='plains' and not path(root,'configs/server.json').exists():
  source=path(root,'configs/default.json')
  if not source.is_file() or source.stat().st_size>8*1024**2:raise ValueError('Publisher default config missing or oversized')
  data=source.read_bytes();shared.json_unique(data.decode('utf-8-sig'));write(root,'configs/server.json',data)
 return receipt
def run(root,game,env):
 agreement(game,env)
 root=Path(root).resolve();auto=choice(env,'VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'),['0','1'])
 if auto=='1':install(root,game,env)
 argv,secrets,log=configure(root,game,env)
 if game!='plains':environment=wine.prepare(root,env,'vcrun2022 corefonts',PINS,('vcrun2022','corefonts'))
 else:
  environment=dict(env);environment.update(HOME=str(root),XDG_CONFIG_HOME=str(path(root,'.config')))
  for key in ['PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH','STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS']:environment.pop(key,None)
 finish=threading.Event();failures=[];worker=None
 if log:
  follower=logs.NativeLog(root,log,secrets,steam)
  def emit(data):sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
  def tail():
   try:
    while not finish.wait(.1):follower.scan(emit)
    follower.scan(emit);emit(follower.redactor.feed(b'',final=True))
   except Exception:failures.append(True);print('Native log relay failed confined regular-file checks.',file=sys.stderr)
  worker=threading.Thread(target=tail,daemon=True);worker.start()
 try:
  code=console.run(root,argv,environment,'\x03',credentials=secrets,terminal_input=True,stop_signal=signal.SIGINT)
  if failures:print('Native log relay failed; raw process exit retained.',file=sys.stderr)
  return code
 finally:
  finish.set()
  if worker:worker.join(timeout=3)
if __name__=='__main__':
 try:
  action,game=sys.argv[1:]
  if action not in ['run','install'] or game not in GAMES:raise ValueError('Expected install/run and an original family game')
  sys.exit(run(Path.cwd(),game,dict(os.environ)) if action=='run' else (install(Path.cwd(),game,dict(os.environ)) and 0))
 except (ValueError,OSError) as error:print('Wasteland server setup failed: '+str(error),file=sys.stderr);sys.exit(2)
