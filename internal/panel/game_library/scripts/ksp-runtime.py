"""MIT. Managed DMP/LMP native settings and supported-runtime launch."""
import json,os,re,sys,time,xml.etree.ElementTree as ET
from pathlib import Path
from native_config import private_write
from native_console import run
def text(value,limit):
    if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid multiplayer text setting')
    return value
def integer(value,low,high):
    if not re.fullmatch('[0-9]+',str(value)) or not low<=int(value)<=high:raise ValueError('Invalid multiplayer numeric setting')
    return int(value)
def choice(env,key,values,default):
    value=env.get(key,default)
    if value not in values:raise ValueError('Invalid '+key)
    return value
def boolean(value):
    if value not in ('True','False','true','false','0','1'):raise ValueError('Invalid multiplayer boolean setting')
    return str(value in ('True','true','1')).lower()
def confined(root,path):
    if not path.resolve().is_relative_to(root):raise ValueError('Multiplayer settings escape the volume')
    if path.exists() and (not path.is_file() or path.stat().st_size>8*1024**2):raise ValueError('Invalid native settings file')
    return path
def write(root,path,value):
    confined(root,path)
    if path.exists():
        previous=path.read_bytes()
        if previous==value.encode():path.chmod(0o600);return
        backup=root/'.voltra/ksp/config-backups'/(str(time.time_ns())+'-'+path.name);confined(root,backup);backup.parent.mkdir(parents=True,exist_ok=True)
        with os.fdopen(os.open(backup,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as output:output.write(previous)
    private_write(path,value)
def properties(content,values):
    lines=[];seen=set()
    for line in content.splitlines(keepends=True):
        if not line.lstrip().startswith(('#',';')) and '=' in line:
            key=line.split('=',1)[0].strip()
            if key in values:
                if key in seen:raise ValueError('Duplicate managed DMP setting')
                seen.add(key);line=key+'='+str(values[key])+'\n'
        lines.append(line)
    if lines and not lines[-1].endswith('\n'):lines[-1]+='\n'
    lines.extend(key+'='+str(value)+'\n' for key,value in values.items() if key not in seen)
    return ''.join(lines)
def dmp_settings(content,values):
    # Native file owns operator settings after first seed. Only allocation-owned
    # listeners remain enforced on subsequent launches. Refuse ambiguous aliases.
    present=set();known={key.casefold():key for key in values}
    for line in content.lstrip('\ufeff').splitlines():
        if line.lstrip().startswith(('#',';')) or '=' not in line:continue
        key=line.split('=',1)[0].strip();canonical=known.get(key.casefold())
        if canonical:
            if canonical!=key or key in present:raise ValueError('Ambiguous DMP setting')
            present.add(key)
    managed={key:value for key,value in values.items() if key not in present or key in ('address','supportIpv6','port','httpPort')}
    # Preserve BOM and newline convention, including opaque secrets/arrays.
    bom='\ufeff' if content.startswith('\ufeff') else ''
    newline='\r\n' if '\r\n' in content else '\n'
    return bom+properties(content.removeprefix(bom),managed).replace('\r\n','\n').replace('\n',newline)
def xml(root,path,name,values):
    confined(root,path)
    raw=path.read_bytes() if path.exists() else b''
    # LMP's StringWriter emits an utf-16 declaration but File.WriteAllText
    # stores UTF8 bytes. Decode actual bytes first; also accept genuine UTF16.
    decoded=raw.decode('utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig')
    if '<!DOCTYPE' in decoded.upper() or '<!ENTITY' in decoded.upper():raise ValueError('XML entities/DTDs are unsupported')
    tree=ET.fromstring(decoded,parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))) if decoded else ET.Element(name)
    if tree.tag!=name:raise ValueError('Unexpected native XML root')
    for key,value in values.items():
        matches=tree.findall(key)
        if len(matches)>1:raise ValueError('Duplicate managed native XML field')
        element=matches[0] if matches else ET.SubElement(tree,key);element.text=str(value)
    write(root,path,ET.tostring(tree,encoding='unicode')+'\n')
def configure(root,game,env):
    env=dict(env)
    # Original LMP eggs use mixed-case names, while Wings uppercases every
    # environment key. Preserve API names and accept their actual native form.
    for original in ['MaxPlayers','GameDifficulty','GameMode']:
        upper=original.upper()
        if original in env and upper in env and env[original]!=env[upper]:raise ValueError('Conflicting original and Wings variable '+original)
        if upper in env:env[original]=env[upper]
    root=Path(root).resolve();port=integer(env.get('SERVER_PORT','0'),1,65535)
    allocated={integer(value,1,65535) for value in env.get('VOLTRA_ALLOCATED_PORTS',str(port)).split(',')}
    if port not in allocated:raise ValueError('Primary game port is not allocated')
    raw_status=env.get('STATUS_PORT','');status=integer(raw_status,1,65535) if raw_status else (port if game=='lmp' else 0)
    if status and (status not in allocated or (game=='dmp' and status==port)):raise ValueError('Status HTTP port needs an appropriate allocation')
    environment=dict(os.environ)
    for name in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):environment.pop(name,None)
    environment.update({'HOME':str(root),'DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_NOLOGO':'1','DOTNET_EnableDiagnostics':'0'})
    if game=='dmp':
        binary=confined(root,root/'DMPServer.dll')
        if not binary.is_file():raise ValueError('Install the selected KSP server first')
        runtime=root/'.voltra/ksp/dmp.runtimeconfig.json';confined(root,runtime)
        values={'address':'0.0.0.0','supportIpv6':'False','port':port,'httpPort':status,'serverName':text(env.get('SERVERNAME','DMP Server'),48),'maxPlayers':integer(env.get('MAX_PLAYERS','20'),1,1000),'modpackMode':choice(env,'MODPACKMODE',['NONE','CKAN','GAMEDATA'],'NONE'),'warpMode':choice(env,'WARPMODE',['MCW_FORCE','MCW_VOTE','MCW_LOWEST','SUBSPACE_SIMPLE','SUBSPACE','NONE'],'SUBSPACE'),'gameMode':choice(env,'GAMEMODE',['SANDBOX','CAREER','SCIENCE'],'SANDBOX'),'gameDifficulty':choice(env,'DIFFICULTY',['EASY','NORMAL','MODERATE','HARD','CUSTOM'],'NORMAL'),'whitelisted':boolean(env.get('WHITELIST','False')).title()}
        target=root/'Config/Settings.txt';confined(root,target);write(root,target,dmp_settings(target.read_bytes().decode('utf-8') if target.exists() else '',values))
        binary=confined(root,root/'DMPServer.dll')
        runtime=root/'.voltra/ksp/dmp.runtimeconfig.json';confined(root,runtime);private_write(runtime,json.dumps({'runtimeOptions':{'tfm':'net10.0','framework':{'name':'Microsoft.NETCore.App','version':'10.0.0'}}}))
        argv=['dotnet','exec','--runtimeconfig',str(runtime),str(binary)];cwd=root;stop='/exit';ready='Ready!';credentials=[]
    elif game=='lmp':
        cwd=root/'LMPServer'
        if not cwd.resolve().is_relative_to(root):raise ValueError('LMP root escapes volume')
        binary=confined(root,cwd/'Server.dll')
        if not binary.is_file():raise ValueError('Install the selected KSP server first')
        config=cwd/'Config'
        # Validate every environment value and target before the first config write.
        plans=[('ConnectionSettings','ConnectionSettingsDefinition',{'ListenAddress':'0.0.0.0','Port':port,'Upnp':'false'}, {'ListenAddress','Port','Upnp'}),
            ('GeneralSettings','GeneralSettingsDefinition',{'ServerName':text(env.get('SERVER_NAME','Luna Server'),30),'Password':text(env.get('PASSWORD',''),30),'AdminPassword':text(env.get('ADMIN_PASSWORD',''),30),'MaxPlayers':integer(env.get('MaxPlayers','20'),1,1000),'GameDifficulty':choice(env,'GameDifficulty',['Easy','Normal','Moderate','Hard','Custom'],'Easy'),'GameMode':choice(env,'GameMode',['Sandbox','Career','Science'],'Sandbox')},set()),
            ('MasterServerSettings','MasterServerSettingsDefinition',{'RegisterWithMasterServer':boolean(env.get('PUBLIC_LISTING','0'))},set()),
            ('WebsiteSettings','WebsiteSettingsDefinition',{'EnableWebsite':'true','ListenAddress':'0.0.0.0','Port':status},{'ListenAddress','Port'})]
        rendered=[];credentials=[]
        for filename,name,values,always in plans:
            path=confined(root,config/(filename+'.xml'))
            raw=path.read_bytes() if path.exists() else b''
            decoded=raw.decode('utf-16' if raw.startswith((b'\xff\xfe',b'\xfe\xff')) else 'utf-8-sig')
            if '<!DOCTYPE' in decoded.upper() or '<!ENTITY' in decoded.upper():raise ValueError('XML entities/DTDs are unsupported')
            tree=ET.fromstring(decoded,parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))) if decoded else ET.Element(name)
            if tree.tag!=name:raise ValueError('Unexpected native XML root')
            changed=False
            for key,value in values.items():
                matches=[node for node in tree if isinstance(node.tag,str) and node.tag.casefold()==key.casefold()]
                if len(matches)>1 or (matches and matches[0].tag!=key):raise ValueError('Ambiguous managed native XML field')
                if not matches or key in always:
                    element=matches[0] if matches else ET.SubElement(tree,key)
                    if element.text!=str(value):element.text=str(value);changed=True
            if filename=='GeneralSettings':credentials=[tree.findtext('Password',''),tree.findtext('AdminPassword','')]
            if changed:rendered.append((path,ET.tostring(tree,encoding='unicode')+'\n'))
        # GameplaySettings and the historical preset marker remain operator-owned.
        confined(root,root/'.voltra/ksp/config-backups')
        for path,value in rendered:write(root,path,value)
        argv=['dotnet',str(binary)];stop='\x03';ready='All systems up and running'
    else:raise ValueError('Unknown KSP server family')
    if not binary.is_file():raise ValueError('Install the selected KSP server first')
    return cwd,argv,environment,stop,credentials,ready
if __name__=='__main__':
    cwd,argv,environment,stop,credentials,ready=configure(Path.cwd(),sys.argv[1],dict(os.environ))
    sys.exit(run(cwd,argv,environment,stop,credentials,ready_marker=ready.encode(),terminal_input=True,terminal_query_reply=True))
