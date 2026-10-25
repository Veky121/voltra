#!/usr/bin/env python3
"""MIT. Typed launch/config adapter; native acceptance is required separately."""
import os,re,shlex,stat,sys
from pathlib import Path
import steam_template,native_console
from native_config import patch_ini

APPS={'scp':'996560','exiled':'996560','kf2':'232130'}

def confined(root,name):
 root=Path(root).resolve();relative=Path(name)
 if relative.is_absolute() or '..' in relative.parts:raise ValueError('Path must remain inside the server volume')
 current=root
 for part in relative.parts:
  current=current/part
  if current.is_symlink():raise ValueError('Symlink in managed path')
 return current

def scp_configuration_file(root,name):
 target=confined(root,name)
 # Absence is the only permission to initialize defaults. Never turn a
 # symlink, inaccessible path or unexpected object into a fresh-install claim.
 for current in reversed([target,*target.parents]):
  if current==root or root not in current.parents:continue
  try:metadata=current.lstat()
  except FileNotFoundError:continue
  if current!=target and not stat.S_ISDIR(metadata.st_mode):raise ValueError('LocalAdmin configuration parent must be a directory')
  if current==target and not stat.S_ISREG(metadata.st_mode):raise ValueError('LocalAdmin configuration must be a regular file')
 return target.is_file()

def scp_first_run(root,primary):
 # Publisher PathManager honors this operator policy before resolving its
 # normal XDG config root. Match that layout rather than overlooking it.
 policy=confined(root,'hoster_policy.txt');base='.config/SCP Secret Laboratory/config'
 if scp_configuration_file(root,'hoster_policy.txt'):
  if policy.stat().st_size>1024*1024:raise ValueError('LocalAdmin hoster policy exceeds one MiB')
  if any('gamedir_for_configs: true' in row.casefold() for row in policy.read_text(encoding='utf-8-sig').splitlines()):base='AppData/config'
 per_port=scp_configuration_file(root,base+'/'+str(primary)+'/config_localadmin.txt')
 global_config=scp_configuration_file(root,base+'/config_localadmin_global.txt')
 return not per_port and not global_config

def line(value,name):
 if any(c in value for c in '\r\n\x00'):raise ValueError(name+' contains a line/control separator')
 return value

def integer(env,name,default,minimum=1,maximum=65535):
 value=env.get(name,str(default))
 if not re.fullmatch(r'[0-9]+',value) or not minimum<=int(value)<=maximum:raise ValueError('Invalid '+name)
 return int(value)

def port(env,name,default,used):
 value=integer(env,name,default,1025)
 allowed=env.get('VOLTRA_ALLOCATED_PORTS','')
 if not allowed or str(value) not in allowed.split(','):raise ValueError(name+' must be an explicitly allocated port')
 if value in used:raise ValueError('Service ports must be distinct')
 used.add(value);return value

def kf2_ports(env):
 used=set();primary=port(env,'SERVER_PORT',7777,used)
 steam=primary+12783
 if steam>65535:raise ValueError('KF2 game port + 12783 Steam socket exceeds 65535')
 if str(steam) not in env.get('VOLTRA_ALLOCATED_PORTS','').split(','):raise ValueError('KF2 requires an allocation at game port + 12783 for its Steam socket')
 used.add(steam)
 query=port(env,'QUERY_PORT',27015,used)
 web=env.get('WEB_ADMIN','false')
 if web not in ['true','false']:raise ValueError('WEB_ADMIN must be true or false')
 webport=integer(env,'WEB_ADMIN_PORT',8089,1025)
 if web=='true':webport=port(env,'WEB_ADMIN_PORT',8089,used)
 return primary,query,web,webport

def configuration(root,relative,sections):
 target=confined(root,relative)
 if target.exists() and target.stat().st_size>4*1024*1024:raise ValueError('Configuration exceeds four MiB')
 previous=target.read_text(encoding='utf-8-sig') if target.exists() else ''
 # Unreal section/key names are case insensitive. Preserve unrelated duplicate keys
 # (Workshop subscription arrays, map cycles, MultiAdmin and mutator configuration).
 canonical={s.casefold():s for s in sections};rows=[];section=None
 for row in previous.splitlines(keepends=True):
  header=re.fullmatch(r'\s*\[([^\]]+)\]\s*',row.strip())
  if header:
   section=canonical.get(header[1].casefold());row='['+section+']\n' if section else row
  elif section and '=' in row and not row.lstrip().startswith((';','#')):
   left,right=row.split('=',1);key=next((k for k in sections[section] if k.casefold()==left.strip().casefold()),None)
   if key:row=key+'='+right
  rows.append(row)
 updated=patch_ini(''.join(rows),sections).encode()
 if updated!=previous.encode():steam_template._publish(root,relative,lambda out:out.write(updated),0o600)

def launch(root,game,env):
 root=Path(root).resolve();app=APPS[game]
 if env.get('SRCDS_APPID',app)!=app:raise ValueError('Original dedicated-server app ID is required')
 steam_template.arguments(root,int(app),env) # Credentials/private branches fail before writes.
 environment=dict(env)
 for key in ['PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH']:environment.pop(key,None)
 if game in ('scp','exiled'):
  # Voltra's explicit field is separate from the publisher environment variable:
  # a host/container inherited value must never silently accept new terms.
  consent=env.get('SCPSL_ACCEPT_EULA','0')
  if consent not in ['0','1','false','true']:raise ValueError('SCPSL_ACCEPT_EULA must be a boolean')
  environment.pop('ACCEPT_SCPSL_EULA',None)
  if consent in ['1','true']:environment['ACCEPT_SCPSL_EULA']='TRUE'
 environment.update(HOME=str(root),XDG_CONFIG_HOME=str(confined(root,'.config')))
 used=set();primary=port(env,'SERVER_PORT',7777 if game=='kf2' else 7777,used)
 if game!='kf2':
  extraction=env.get('DOTNET_BUNDLE_EXTRACT_BASE_DIR','./dotnet-bundle')
  environment['DOTNET_BUNDLE_EXTRACT_BASE_DIR']=str(confined(root,extraction))
  environment.update(DOTNET_ROOT=str(confined(root,'.voltra/scp-dotnet')),DOTNET_MULTILEVEL_LOOKUP='0')
  argv=[str(confined(root,'LocalAdmin')),str(primary)]
  if game in ('scp','exiled') and scp_first_run(root,primary):argv.append('--useDefault')
  return argv,environment,'EXIT',b'Waiting for players'
 primary,query,web,webport=kf2_ports(env)
 password=line(env.get('ADMIN_PASS',''),'ADMIN_PASS');name=line(env.get('SERVER_NAME','A Pterodactyl Hosted Server'),'SERVER_NAME')
 if web=='true' and not password:raise ValueError('WebAdmin requires ADMIN_PASS')
 mapname=env.get('MAP_NAME','kf-bioticslab')
 if not re.fullmatch(r'[A-Za-z0-9_./-]+',mapname) or '..' in mapname:raise ValueError('MAP_NAME must be a map package, not an injected travel URL')
 difficulty=integer(env,'DIFFICULTY',0,0,3)
 extra=shlex.split(line(env.get('EXTRA_FLAGS',''),'EXTRA_FLAGS'))
 for token in extra:
  if not token.startswith('-') or any(c in token for c in '?\x00') or token.split('=',1)[0].casefold() in ['-port','-steamport','-queryport','-webadminport','-adminpassword','-configsubdir','-homedir','-userdir']:raise ValueError('EXTRA_FLAGS requires literal optional switches without managed port/path/admin overrides')
 configuration(root,'KFGame/Config/KFWeb.ini',{'IpDrv.WebServer':{'bEnabled':web,'ListenPort':str(webport)}})
 configuration(root,'KFGame/Config/LinuxServer-KFGame.ini',{'Engine.AccessControl':{'AdminPassword':password},'Engine.GameReplicationInfo':{'ServerName':name}})
 return [str(confined(root,'Binaries/Win64/KFGameSteamServer.bin.x86_64')),mapname+'?Port='+str(primary)+'?QueryPort='+str(query)+'?Difficulty='+str(difficulty),'-Port='+str(primary),'-QueryPort='+str(query),*extra],environment,'\x03',b'DevOnline: Playfab server registered with lobby ID '

def main():
 game=sys.argv[1];root=Path.cwd();env=dict(os.environ)
 auto=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0' if game=='exiled' else '1'))
 if auto not in ['0','1']:raise ValueError('AUTO_UPDATE must be 0 or 1')
 # Validate all typed controls before update.
 argv,environment,stop,ready=launch(root,game,env)
 if auto=='1':
  from session_servers_install import install
  install(root,game,env)
  argv,environment,stop,ready=launch(root,game,env)
 return native_console.run(root,argv,environment,stop,credentials=tuple(env.get(k,'') for k in ['ADMIN_PASS','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'] if env.get(k)),ready_marker=ready,terminal_input=True)

if __name__=='__main__':
 try:sys.exit(main())
 except (ValueError,OSError) as error:print('Session server setup failed: '+str(error),file=sys.stderr);sys.exit(2)
