#!/usr/bin/env python3
"""Forest-only native authority adapter; source acceptance only."""
import importlib.util, os, signal, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('forest_family', Path(__file__).with_name('forest-survival.py'))
f = importlib.util.module_from_spec(spec); spec.loader.exec_module(f)
CONFIG = f.FOREST_CONFIG
PORTS = {'serverIP':'0.0.0.0','serverSteamPort':'STEAM_PORT','serverGamePort':'SERVER_PORT','serverQueryPort':'QUERY_PORT'}

def parse(data):
    # Unknown rows remain opaque bytes. Only inherited managed keys are decoded.
    keys = set(PORTS) | {'serverName','serverPlayers','serverPassword','serverPasswordAdmin','serverSteamAccount','enableVAC','initType','difficulty'}
    found = {}
    for row in data.splitlines(keepends=True):
        parts = row.strip().split(None,1)
        if not parts or parts[0].startswith(b'//'): continue
        raw = parts[0]
        matches = [key for key in keys if key.lower().encode() == raw.lower()]
        if not matches: continue
        key = matches[0]
        if raw != key.encode() or key in found: raise ValueError('Ambiguous Forest setting: '+key)
        value = parts[1].decode('utf-8') if len(parts)>1 else ''
        if any(c in value for c in '\r\n\0'): raise ValueError('Invalid Forest setting: '+key)
        found[key] = value
    return found

def plan(root, env):
    root=Path(root).resolve()
    if env.get('SRCDS_APPID','556450')!='556450' or env.get('WINDOWS_INSTALL','1')!='1': raise ValueError('Original Windows dedicated app required')
    f.steam.arguments(root,556450,env,platform='windows',force_platform=True)
    ports=f.roles('forest',env)
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES','false')!='true': raise ValueError('Explicit runtime license acceptance required before acquisition')
    if env.get('WINEPREFIX',str(root/'.wine'))!=str(root/'.wine') or env.get('WINEARCH','win64')!='win64': raise ValueError('Original private win64 prefix required')
    registry=f.path(root,'.wine/system.reg')
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]: raise ValueError('Existing win32 prefix retained')
    f.shared.confined(root,Path(env.get('WINEPATH',str(root))))
    f.text(env,'WINEDEBUG','-all',32)
    verbs=env.get('VOLTRA_WINETRICKS_RUN',env.get('WINETRICKS_RUN','sound=disabled')).split()
    if not verbs or len(set(verbs))!=len(verbs) or any(v not in ('mono','vcrun2019','vcrun2022','sound=disabled') for v in verbs): raise ValueError('Unsupported typed Forest runtime prerequisite')
    f.choice(env,'VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'),['0','1'])
    target=f.path(root,CONFIG)
    if target.exists() and target.stat().st_size>4*1024*1024: raise ValueError('Forest config exceeds budget')
    data=target.read_bytes() if target.exists() else f.PINS['forest_default_config'].encode()
    values=parse(data)
    seeds={'serverName':f.text(env,'SERVER_NAME','Pterodactyl Forest Server',64),'serverPlayers':str(f.integer(env,'MAX_PLAYERS',10,1,100)), 'serverPassword':f.text(env,'SERVER_PASS','',20),'serverPasswordAdmin':f.text(env,'ADMIN_PASS','cHanGetHePaSwWord',20),'serverSteamAccount':f.text(env,'STEAM_ACC',''), 'enableVAC':f.choice(env,'VAC','off',['on','off']), 'initType':f.choice(env,'INIT_TYPE','New',['New','Continue']), 'difficulty':f.choice(env,'SERVER_DIFFICULTY','Normal',['Peaceful','Normal','Hard'])}
    # Publisher/native schema not independently current: preserve existing values
    # without inventing bounds or normalizing unknown content.
    for key,default in seeds.items():
        if not target.exists() or key not in values: values[key]=default
    replacement={key:('0.0.0.0' if key=='serverIP' else str(ports[role])) for key,role in PORTS.items()}
    if not target.exists(): replacement.update(seeds)
    # Inspect preservation targets before runtime setup makes any writes.
    for relative in f.preserve_paths('forest'):
        origin=f.path(root,relative)
        if origin.exists():
            for parent,dirs,files in os.walk(origin,followlinks=False):
                for name in dirs+files: f.shared.confined(root,Path(parent)/name)
    output=[];seen=set()
    for row in data.splitlines(keepends=True):
        parts=row.strip().split(None,1)
        key=parts[0].decode('ascii',errors='replace') if parts else ''
        if key in replacement:
            seen.add(key)
            if parse(data).get(key)!=replacement[key]: row=(key+' '+replacement[key]).encode()+(b'\r\n' if row.endswith(b'\r\n') else b'\n')
        output.append(row)
    additions={**{k:v for k,v in seeds.items() if k not in parse(data)}, **{k:v for k,v in replacement.items() if k not in seen}}
    result=b''.join(output)
    if additions:
        if result and not result.endswith(b'\n'): result+=b'\n'
        result+=b''.join((k+' '+v+'\n').encode() for k,v in additions.items())
    return root,target,data,result,values

def launch_argv(root, target, values):
    # Publisher-linked guide documents config passwords and explicit path selection.
    # Native access settings remain in the selected config, never duplicated in argv.
    return ['xvfb-run','--auto-servernum','--server-args=-screen 0 640x480x24:32','wine',str(f.path(root,'TheForestDedicatedServer.exe')),'-batchmode','-nographics','-inittype',values['initType'],'-nosteamclient','-savefolderpath',str(f.path(root,'TheForestDedicatedServer_Data')),'-configfilepath',str(target)]


def execute(root,env,operation):
    root,target,before,after,values=plan(root,env)
    if operation=='check': return 0
    runtime=f.wine.prepare(root,env,'sound=disabled',f.PINS,('mono','vcrun2019','vcrun2022','sound=disabled'))
    if operation=='install' or env.get('VOLTRA_STEAM_AUTO_UPDATE',env.get('AUTO_UPDATE','1'))=='1': f.install(root,'forest',env)
    if not target.exists() or target.read_bytes()!=after: f.publish(root,CONFIG,after)
    if operation=='install': return 0
    argv=launch_argv(root,target,values)
    return f.console.run(root,argv,runtime,'\x03',credentials=tuple(values[k] for k in ('serverPassword','serverPasswordAdmin','serverSteamAccount') if values[k]),ready_marker=b'Game autosave started',terminal_input=True,stop_signal=signal.SIGINT)

if __name__=='__main__':
    try:
        if len(sys.argv)!=2 or sys.argv[1] not in ('check','install','run'): raise ValueError('Expected check/install/run')
        sys.exit(execute(Path.cwd(),dict(os.environ),sys.argv[1]))
    except (ValueError,OSError):
        print('Forest setup refused; review configuration and prerequisites',file=sys.stderr);sys.exit(2)
