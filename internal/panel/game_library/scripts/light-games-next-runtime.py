"""MIT. Publisher Unity server adapters; no shell interpolation or credential fallback."""
import json,os,re,sys,time,hashlib
from pathlib import Path
from native_config import private_write
from native_console import run

APPS={'banana':'2406780','nuclear':'3930080','puck':'3481440'}
def confined(root,relative):
 p=root/relative
 if not p.resolve().is_relative_to(root) or any(x.is_symlink() for x in [p,*p.parents] if x!=root.parent):raise ValueError('Unsafe server path')
 return p
def text(value,maximum=200):
 if not isinstance(value,str) or len(value)>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Expected bounded single-line text')
 return value
def integer(value,low,high):
 if not re.fullmatch(r'[0-9]+',str(value)) or not low<=int(value)<=high:raise ValueError('Native integer outside supported range')
 return int(value)
def boolean(value):
 if str(value).lower() not in ('0','1','false','true'):raise ValueError('Expected true/false or 0/1')
 return str(value).lower() in ('1','true')
def pairs(items):
 result={}
 for key,value in items:
  if key in result:raise ValueError('Duplicate native JSON setting')
  result[key]=value
 return result
def read_config(path):
 if not path.exists():return {}
 if path.stat().st_size>4*1024*1024:raise ValueError('Native JSON exceeds four MiB')
 value=json.loads(path.read_text(encoding='utf-8-sig'),object_pairs_hook=pairs,parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
 if not isinstance(value,dict):raise ValueError('Native configuration must be an object')
 return value
def merge(target,values):
 for key,value in values.items():
  if isinstance(value,dict):
   if key not in target:target[key]={}
   if not isinstance(target[key],dict):raise ValueError('Managed JSON object has incompatible type')
   merge(target[key],value)
  else:target[key]=value
 return target
def write_config(root,path,value,label):
 content=json.dumps(value,indent=2,allow_nan=False)+'\n'
 if path.exists() and read_config(path)==value:return
 metadata=path.stat() if path.exists() else None
 if metadata:private_write(confined(root,'.voltra/light-games-next/backups/'+label+'-'+str(time.time_ns())+'.json'),path.read_text(encoding='utf-8-sig'))
 private_write(path,content)
 if metadata:
  os.chmod(path,metadata.st_mode & 0o777)
  if hasattr(os,'chown'):os.chown(path,metadata.st_uid,metadata.st_gid)
def puck_current(root,legacy,values):
 path=confined(root,'server_config.json');current=read_config(path)
 mods=[]
 for item in legacy.get('mods',current.get('mods',[])):
  if not isinstance(item,dict) or 'id' not in item:raise ValueError('Puck mods require native objects with an id')
  item=dict(item);item['id']=str(item['id'])
  item['isEnabled']=boolean(item.pop('enabled',item.get('isEnabled',False)))
  item['isClientRequired']=boolean(item.pop('clientRequired',item.get('isClientRequired',False)))
  mods.append(item)
 current.update(port=values['port'],name=text(legacy.get('name',current.get('name','Pterodactyl Puck Server')),200),maxPlayers=values['maxPlayers'],password=values['password'],tickRate=values['clientTickRate'],isPublic=boolean(legacy.get('isPublic',current.get('isPublic',True))),useVoip=boolean(legacy.get('voip',current.get('useVoip',False))),mods=mods)
 current.setdefault('useWhitelist',False);current.setdefault('gameMode','public');current.setdefault('level','default')
 public_path=confined(root,'public_game_mode_config.json');public=read_config(public_path)
 if not public:public={'phaseDurationMap':{'None':0,'Warmup':60,'PreGame':10,'FaceOff':4,'Play':300,'BlueScore':4,'RedScore':4,'Replay':9,'Intermission':10,'GameOver':30,'PostGame':10}}
 if 'phaseDurationMap' in legacy:
  durations=legacy['phaseDurationMap']
  if not isinstance(durations,dict):raise ValueError('Puck phase durations must be an object')
  aliases={'Playing':'Play','PeriodOver':'Intermission'}
  managed={aliases.get(k,k):integer(v,0,2147483647) for k,v in durations.items()}
  public=merge(public,{'phaseDurationMap':managed})
 return [(path,current,'puck-current'),(public_path,public,'puck-public')]
def config_path(root,game,env):
 if game=='banana':
  name=env.get('SERVER','PterodactylServer')
  if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',name):raise ValueError('SERVER must be a plain folder name')
  return confined(root,'Servers/'+name+'/Config.json')
 return confined(root,'DedicatedServerConfig.json' if game=='nuclear' else 'server_configuration.json')
def configure(root,game,env):
 root=root.resolve();port=integer(env.get('SERVER_PORT',''),1,65535)
 allocated={integer(v,1,65535) for v in env.get('VOLTRA_ALLOCATED_PORTS','').split(',') if v}
 if port not in allocated:raise ValueError('Primary port must be allocated')
 query=None
 if game!='banana':
  query=integer(env.get('QUERY_PORT','7777' if game=='nuclear' else '7778'),1025,65535)
  if query not in allocated or query==port:raise ValueError('QUERY_PORT must explicitly select a different allocated port; legacy defaults are not silently remapped')
 path=config_path(root,game,env);old=read_config(path)
 if game=='banana':
  token=text(env.get('STEAM_GSLT',''),256)
  if not old:old={'Config_Version':'1.363','Server':{'DLC_Only':False,'VAC_Secure':True,'Enable_Scheduled_Shutdown':True,'Scheduled_Restart_Time':'T02:00:00','Scheduled_Restart_Warnings':['00:30:00','00:15:00','00:05:00','00:01:00','00:00:30','00:00:15','00:00:03','00:00:02','00:00:01'],'Enable_Update_Restart':True,'Update_Shutdown_Check_Interval':300.0,'Update_Shutdown_Warnings':['00:03:00','00:01:00','00:00:30','00:00:15','00:00:03','00:00:02','00:00:01']},'Browser':{'Description_Short':''},'Game':{'Random_Map':False,'Random_GameMode':False,'Minimal_Player_Amount':2,'Server_Type':1}}
  values={'Server':{'Login_Token':token,'STEAM_GSLT':token},'Browser':{'Server_Name':text(env.get('SERVER_NAME','BananaShooter'),25)}}
  argv=[str(confined(root,'BSDS.x86_64')),'-batchmode','-nographics','+ServerName',env.get('SERVER','PterodactylServer'),'+maxplayercount','40','+port',str(port)];stop='quit';ready='Connect to steam server successfully';secrets=[token]
 elif game=='nuclear':
  password=text(env.get('SERVER_PASSWORD','ChangeMe'))
  values={'ServerName':text(env.get('SERVER_NAME','Pterodactyl-server'),30),'Password':password,'MaxPlayers':integer(env.get('MAX_PLAYERS','20'),1,1024),'ModdedServer':boolean(env.get('MODDED_SERVER','false')),'Port':{'IsOverride':True,'Value':port},'QueryPort':{'IsOverride':True,'Value':query},'MissionDirectory':str(confined(root,'NuclearOption-Missions'))}
  if not old:old={'BanListPaths':['ban_list.txt'],'MissionRotation':[{'Key':{'Group':'BuiltIn','Name':'Escalation'},'MaxTime':7200},{'Key':{'Group':'BuiltIn','Name':'Terminal Control'},'MaxTime':7200}],'NoPlayerStopTime':30,'RotationType':0}
  argv=[str(confined(root,'NuclearOptionServer.x86_64')),'-batchmode','-nographics','-logFile','-','-DedicatedServer',str(path),'-limitframerate','30'];stop='\x03';ready='[DedicatedServerManager] Waiting for Players before loading next map';secrets=[password]
 else:
  password=text(env.get('SRV_PASSWORD',''),64)
  values={'port':port,'pingPort':query,'maxPlayers':integer(env.get('MAX_PLAYERS','10'),1,32),'password':password,'kickTimeout':integer(env.get('KICK_TIMEOUT','300'),0,2147483647),'targetFrameRate':integer(env.get('FRAME_RATE','120'),1,380),'serverTickRate':integer(env.get('SERVER_TICK_RATE','100'),1,360),'clientTickRate':integer(env.get('CLIENT_TICK_RATE','360'),1,720)}
  if not old:old={'name':'Pterodactyl Puck Server','voip':False,'isPublic':True,'adminSteamIds':[],'reloadBannedSteamIds':False,'usePuckBannedSteamIds':True,'printMetrics':True,'sleepTimeout':60,'joinMidMatchDelay':10,'startPaused':False,'allowVoting':True,'phaseDurationMap':{'Warmup':600,'FaceOff':3,'Playing':300,'BlueScore':5,'RedScore':5,'Replay':10,'PeriodOver':15,'GameOver':15},'mods':[{'id':3493628417,'enabled':False,'clientRequired':False}]}
  argv=['/bin/bash',str(confined(root,'start_server.sh')),'--serverConfigPath',str(confined(root,'server_config.json'))];stop='\x03';ready='is ready to accept clients on';secrets=[password]
 updated=merge(old,values)
 if game=='puck':
  for target,value,label in puck_current(root,updated,values):write_config(root,target,value,label)
 write_config(root,path,updated,game)
 environment={k:v for k,v in env.items() if k not in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','STEAM_PASS','STEAM_AUTH')}
 environment.update(HOME=str(root),XVFB='0',LD_LIBRARY_PATH=str(root/'linux64')+':'+str(root/'.steam/sdk64'))
 if game=='puck':
  for key in ['FRAME_RATE','SERVER_TICK_RATE','CLIENT_TICK_RATE','KICK_TIMEOUT']:environment[key]=str(values[{'FRAME_RATE':'targetFrameRate','SERVER_TICK_RATE':'serverTickRate','CLIENT_TICK_RATE':'clientTickRate','KICK_TIMEOUT':'kickTimeout'}[key]])
  environment['QUERY_PORT']=str(query)
 return argv,environment,stop,secrets,ready
class PuckObserver:
 def __init__(self,env):self.env=env;self.pending=b'';self.ready=False;self.proof=None;self.emitted=False
 def __call__(self,block):
  self.pending+=block
  if len(self.pending)>1024*1024:raise ValueError('Puck native output line exceeds observer bound')
  while b'\n' in self.pending:
   line,self.pending=self.pending.split(b'\n',1);line=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',line)
   if b'[VoltraLegacyControls] Native proof ' in line:
    proof=json.loads(line.split(b'[VoltraLegacyControls] Native proof ',1)[1],object_pairs_hook=pairs)
    expected={'serverPhysicsTick':int(self.env['SERVER_TICK_RATE']),'advertisedClientInputTick':int(self.env['CLIENT_TICK_RATE']),'engineTargetFrameRate':int(self.env['FRAME_RATE']),'configuredKickTimeout':int(self.env['KICK_TIMEOUT']),'nativeQueryPort':int(self.env['QUERY_PORT'])}
    if any(proof.get(key)!=value for key,value in expected.items()) or not proof.get('nativeQueryListening') or proof.get('failure') or abs(proof.get('probedNativeKickTweenSeconds',-1)-expected['configuredKickTimeout'])>.01:raise ValueError('Puck native control proof differs from original requested controls')
    self.proof=proof
   if b'is ready to accept clients on' in line:self.ready=True
   if b'Failed to enable plugin VoltraLegacyControls' in line or b'[VoltraLegacyControls] Compatibility initialization failed:' in line:raise ValueError('Puck compatibility plugin failed')
   if self.proof and self.ready and not self.emitted:
    print('Voltra Puck compatibility ready',flush=True);self.emitted=True
def check_puck_plugin(root):
 record=confined(root,'.voltra/puck-compat-release.json')
 if not record.is_file() or record.stat().st_size>32768:raise ValueError('Install the reviewed Puck compatibility plugin before starting')
 receipt=json.loads(record.read_text(),object_pairs_hook=pairs)
 for relative in ['Puck_Data/Managed/Puck.dll','Puck_Data/Managed/0Harmony.dll','.voltra/puck_legacy_controls.cs','.voltra/puck_legacy_controls.csproj','Plugins/VoltraLegacyControls/VoltraLegacyControls.dll']:
  path=confined(root,relative)
  if not path.is_file() or receipt.get('sha256',{}).get(relative)!=hashlib.sha256(path.read_bytes()).hexdigest():raise ValueError('Puck publisher/plugin source changed; update or reinstall to compile its current compatibility plugin')
def main():
 from light_games_next_install import install
 game=sys.argv[1];root=Path.cwd().resolve();env=dict(os.environ)
 if boolean(env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1' if game!='puck' else '0'))):install(root,game,env,False)
 argv,environment,stop,secrets,ready=configure(root,game,env)
 if game=='puck':check_puck_plugin(root)
 observer=PuckObserver(environment) if game=='puck' else None
 result=run(root,argv,environment,stop,credentials=secrets,ready_marker=ready.encode('utf-8'),terminal_input=True,**({'output_observer':observer} if observer else {}))
 if observer and result==0 and not observer.emitted:raise ValueError('Puck stopped without a verified native compatibility-ready state')
 return result
if __name__=='__main__':sys.exit(main())
