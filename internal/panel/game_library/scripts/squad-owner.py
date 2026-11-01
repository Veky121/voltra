"""Squad-only preflight, seed-once native authority, shared native supervisor."""
import os
from pathlib import Path
import re
import signal
from steam_template import arguments, _publish
from tactical_install import selection, confined, workshop_ids, install
from tactical_runtime import environment_aliases, service_ports, integer, boolean, text
from native_console import run

CONFIG = 'SquadGame/ServerConfig/Server.cfg'
FIELDS = [('AllowTeamChanges','allowteamchange'), ('ShouldAdvertise','advertise'), ('PreventTeamChangeIfUnbalanced','ptciu'), ('EnforceTeamBalance','teambal'), ('RecordDemos','recorddemos')]

def plan(root, env):
    root = Path(root).resolve()
    env = environment_aliases(env)
    kind, app, _, executable = selection(env)
    if kind != 'squad': raise ValueError('Exact Squad recipe required')
    automatic = env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE','0'))
    if automatic not in ('0','1'): raise ValueError('Auto update must be 0 or 1')
    arguments(root, app, env, False)
    workshop_ids(env.get('WORKSHOP_ITEMS',''))
    main, ports, _, _ = service_ports(env, kind)
    maximum = integer(env, 'maxplayers',80,1,100)
    reserved = integer(env,'reservedslots',0,0,maximum)
    name = text(env.get('servername','Squad Server'),80)
    if any(c in name for c in '\"\\'): raise ValueError('Invalid native server name')
    values = {'ServerName':'"'+name+'"','MaxPlayers':str(maximum),'NumReservedSlots':str(reserved)}
    values.update({key:boolean(env,alias) for key,alias in FIELDS})
    path = confined(root,CONFIG)
    before = path.read_bytes() if path.exists() else b''
    if len(before)>8*1024**2: raise ValueError('Configuration exceeds limit')
    content = before.decode('utf-8-sig')
    present = {m[1].casefold() for line in content.splitlines() if (m:=re.match(r'^\s*([A-Za-z][A-Za-z0-9_]*)\s*=',line))}
    newline = b'\r\n' if b'\r\n' in before else b'\n'
    additions = [f'{key}={value}'.encode() for key,value in values.items() if key.casefold() not in present]
    after = before
    if additions: after += (newline if before and not before.endswith((b'\r',b'\n')) else b'') + newline.join(additions)+newline
    library = env.get('LD_LIBRARY_PATH',str(root/'linux64'))
    if library == '.': library=str(root)
    for part in library.split(':'):
        if not part or not Path(part).resolve().is_relative_to(root): raise ValueError('Native library path must remain in server volume')
    child = dict(os.environ)
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'): child.pop(key,None)
    child.update(HOME=str(root),LD_LIBRARY_PATH=library)
    binary = confined(root,executable)
    argv=[str(binary),'SquadGame','Port='+str(main),'QueryPort='+str(ports['QUERY_PORT']),'-beaconport='+str(ports['BEACON_PORT']),'RCONPORT='+str(ports['RCON_PORT']),'-stdout','-FullStdOutLogOutput']
    return env, automatic, path, before, after, argv, child

def seed(root, planned):
    _,_,path,before,after,_,_=planned
    if before == after: return
    if (path.read_bytes() if path.exists() else b'') != before: raise ValueError('Native configuration changed during planning')
    metadata=path.stat() if path.exists() else None
    _publish(Path(root).resolve(),CONFIG,lambda output:output.write(after),metadata.st_mode & 0o777 if metadata else 0o600)
    if metadata and getattr(os,'geteuid',lambda:-1)()==0: os.chown(path,metadata.st_uid,metadata.st_gid)

def acquire(root,env,validate=True):
    planned=plan(root,env)  # complete preflight before any acquisition or writes
    result=install(root,planned[0],validate=validate)
    seed(root,plan(root,env))  # publisher-shipped keys also retain authority
    return result

def main(root,env):
    planned=plan(root,env)
    if planned[1]=='1': acquire(root,env,False)
    planned=plan(root,env)
    if not Path(planned[5][0]).is_file(): raise ValueError('Publisher dedicated binary is missing')
    seed(root,planned)
    secrets=[env.get(k,'') for k in ('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return run(Path(root).resolve(),planned[5],planned[6],'\x03',credentials=secrets,ready_marker=b'Engine Initialization',terminal_input=True,stop_signal=signal.SIGINT)

if __name__=='__main__': raise SystemExit(main(Path.cwd(),dict(os.environ)))
