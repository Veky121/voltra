#!/usr/bin/env python3
"""MIT. Typed launch/config adapter; native acceptance is required separately."""
import os,re,shlex,stat,sys
from pathlib import Path
import steam_template,native_console
from native_config import patch_ini,resolve_ini_identities

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

def kf2_document(root,relative,sections,managed):
 # Pure preflight: anchored no-follow reads, complete identity resolution, no mkdir.
 confined(root,relative)
 with steam_template._publication_parent(root,relative) as (parent,leaf,_):
  metadata=steam_template._publication_leaf(parent,leaf) if parent is not None else None
  raw=b''
  if metadata:
   if metadata.st_size>4*1024*1024:raise ValueError('Configuration exceeds four MiB')
   fd=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=parent)
   with os.fdopen(fd,'rb') as source:raw=source.read(4*1024*1024+1)
   if len(raw)>4*1024*1024:raise ValueError('Configuration exceeds four MiB')
 text=raw.decode('utf-8');identities=resolve_ini_identities(text.lstrip('\ufeff'),sections)
 # Resolve only the declared scalar identities; unrelated arrays remain opaque.
 effective={};changes={}
 for section,values in identities.items():
  for key,default in values.items():
   match=re.search(r'^\s*\['+re.escape(section)+r'\]\s*(?:[;#].*)?$([\s\S]*?)(?=^\s*\[|\Z)',text.lstrip('\ufeff'),re.M)
   found=re.search(r'^[ \t]*'+re.escape(key)+r'[ \t]*=([^\r\n]*)',match[1],re.M) if match else None
   # Unreal array operators on a declared scalar have ambiguous effective semantics.
   if match and re.search(r'^[ \t]*[+.!-]'+re.escape(key)+r'[ \t]*=',match[1],re.M|re.I):raise ValueError('Ambiguous KF2 scalar array alias')
   effective[(section.casefold(),key.casefold())]=found[1].strip() if found else default
   if not found or (section.casefold(),key.casefold()) in managed:
    if not found or found[1].strip()!=default:changes.setdefault(section,{})[key]=default
 updated=patch_ini(text,changes).encode('utf-8') if changes else raw
 return (relative,raw,updated),effective

def kf2_plan(root,env):
 root=Path(root).resolve()
 if env.get('SRCDS_APPID','232130')!='232130':raise ValueError('Original dedicated-server app ID is required')
 steam_template.arguments(root,232130,env)
 primary,query,web,webport=kf2_ports(env)
 password=line(env.get('ADMIN_PASS',''),'ADMIN_PASS');name=line(env.get('SERVER_NAME','A Pterodactyl Hosted Server'),'SERVER_NAME')
 mapname=env.get('MAP_NAME','kf-bioticslab')
 if not re.fullmatch(r'[A-Za-z0-9_./-]+',mapname) or '..' in mapname:raise ValueError('MAP_NAME must be a map package, not an injected travel URL')
 difficulty=integer(env,'DIFFICULTY',0,0,3)
 extra=shlex.split(line(env.get('EXTRA_FLAGS',''),'EXTRA_FLAGS'))
 for token in extra:
  if not token.startswith('-') or any(c in token for c in '?\x00') or token.split('=',1)[0].casefold() in ['-port','-steamport','-queryport','-webadminport','-adminpassword','-configsubdir','-homedir','-userdir','-ini','-gameini','-engineini']:raise ValueError('EXTRA_FLAGS requires literal optional switches without managed port/path/admin overrides')
 game,values=kf2_document(root,'KFGame/Config/LinuxServer-KFGame.ini',{'Engine.AccessControl':{'AdminPassword':password},'Engine.GameReplicationInfo':{'ServerName':name}},set())
 webdoc,webvalues=kf2_document(root,'KFGame/Config/KFWeb.ini',{'IpDrv.WebServer':{'bEnabled':web,'ListenPort':str(webport)}},{('ipdrv.webserver','listenport')})
 enabled=webvalues[('ipdrv.webserver','benabled')].casefold()
 if enabled not in ['true','false']:raise ValueError('Invalid native WebAdmin enabled value')
 if enabled=='true':
  checked=dict(env,WEB_ADMIN='true');kf2_ports(checked)
  if not values[('engine.accesscontrol','adminpassword')]:raise ValueError('WebAdmin requires ADMIN_PASS')
 argv=[str(confined(root,'Binaries/Win64/KFGameSteamServer.bin.x86_64')),mapname+'?Port='+str(primary)+'?QueryPort='+str(query)+'?Difficulty='+str(difficulty),'-Port='+str(primary),'-QueryPort='+str(query),*extra]
 return argv,[game,webdoc],values[('engine.accesscontrol','adminpassword')]

def kf2_publish(root,plans):
 # Complete refusal before either write. This is not a crash-atomic transaction.
 for relative,raw,updated in plans:
  target=confined(root,relative)
  if (target.read_bytes() if target.exists() else b'')!=raw:raise ValueError('KF2 configuration changed after preflight')
 for relative,raw,updated in plans:
  if raw!=updated:steam_template._publish(root,relative,lambda out,value=updated:out.write(value),0o600)

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
 argv,plans,_=kf2_plan(root,env)
 kf2_publish(root,plans)
 return argv,environment,'\x03',b'DevOnline: Playfab server registered with lobby ID '

def main():
 game=sys.argv[1];root=Path.cwd();env=dict(os.environ)
 auto=env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','0' if game=='exiled' else '1'))
 if auto not in ['0','1']:raise ValueError('AUTO_UPDATE must be 0 or 1')
 # Validate all typed controls before update.
 if game=='kf2':kf2_plan(root,env)
 else:argv,environment,stop,ready=launch(root,game,env)
 if auto=='1':
  from session_servers_install import install
  install(root,game,env)
  if game!='kf2':argv,environment,stop,ready=launch(root,game,env)
 if game=='kf2':argv,environment,stop,ready=launch(root,game,env)
 native_password=kf2_plan(root,env)[2] if game=='kf2' else ''
 return native_console.run(root,argv,environment,stop,credentials=tuple([native_password] if native_password else [])+tuple(env.get(k,'') for k in ['ADMIN_PASS','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'] if env.get(k)),ready_marker=ready,terminal_input=True)

if __name__=='__main__':
 try:sys.exit(main())
 except (ValueError,OSError) as error:print('Session server setup failed: '+str(error),file=sys.stderr);sys.exit(2)
