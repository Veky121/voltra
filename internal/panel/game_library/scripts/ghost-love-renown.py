#!/usr/bin/env python3
"""MIT. Exact imported MGH/NLL/Renown native controls; no shell interpolation."""
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import struct
import sys
import tempfile
import threading


def helper(name):
    path=Path(__file__).with_name(name+'.py')
    if not path.exists():path=path.with_name(name.replace('_','-')+'.py')
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module;spec.loader.exec_module(module);return module


common=helper('ark_family');steam=common.steam;native=common.native
sys.modules['steam_template']=steam
console=helper('native_console');proton=helper('enshrouded_proton')
confined,text,integer,boolean=common.confined,common.text,common.integer,common.boolean
GAMES={'ghost':(1118810,'MidnightGhostHunt','windows','MidnightGhostHunt/Binaries/Win64/MidnightGhostHuntServer-Win64-Shipping.exe',915810),
       'love':(2833050,'NoLoveLost','windows','NoLoveLost/Binaries/Win64/NoLoveLostServer-Win64-Shipping.exe',1873120),
       'renown':(1512690,'Renown_Combat','linux','Renown_Combat/Binaries/Linux/Renown_CombatServer-Linux-Shipping',1512690)}
RENOWN_SECTION='/Game/Core/Blueprints/Renown_GameInstance.Renown_GameInstance_C'


def literal(value):
    if '"' in value or '\\' in value:raise ValueError('Native quoted Unreal values cannot contain quotes or backslashes')
    return '"'+value+'"'


def private(env,key,default=''):
    value=text(env,key,default,4096)
    if not value or value.casefold() in ('changeme','change_me','rconpassword'):
        raise ValueError('Set your actual private '+key+'; the original placeholder is not ready')
    return value


def allocated(env,game):
    raw=env.get('VOLTRA_ALLOCATED_PORTS','')
    if not re.fullmatch(r'[0-9]+(?:,[0-9]+)*',raw):raise ValueError('Select actual native listener allocations')
    available={int(value) for value in raw.split(',')}
    if any(not 1<=value<=65535 for value in available):raise ValueError('Invalid allocation')
    selected={'SERVER_PORT':integer(env,'SERVER_PORT',7777)}
    keys=['QUERY_PORT'] if game=='love' else ['QUERY_PORT','BEACON_PORT']
    # Renown retains the original explicit RCONPort even when RCON is disabled.
    if game=='renown':keys+=['RCON_PORT']
    for key in keys:
        default=27016 if game=='love' else 27015 if key=='QUERY_PORT' and game=='ghost' else 7787 if game=='ghost' else 0
        selected[key]=integer(env,key,default,1024 if game=='renown' else 1)
    if len(set(selected.values()))!=len(selected) or any(value not in available for value in selected.values()):
        raise ValueError('Game/query/beacon/RCON must use distinct selected same-address allocations')
    return selected


def extras(env):
    value=text(env,'ADDITIONAL_ARGS','',8192)
    args=shlex.split(value)
    managed={'port','queryport','beaconport','multihome','map','gamename','gamemode','region','botdifficulty','password','abslog','log','nolog'}
    for arg in args:
        if not arg.startswith('-') or any(c in arg for c in '\r\n') or arg.lstrip('-').split('=',1)[0].casefold() in managed:
            raise ValueError('Additional native flags must be separate options and cannot override managed listeners/secrets/logs')
    return args


def renown_seeds():
    return json.loads(Path(__file__).with_name('ghost-love-renown-config.json').read_text())


def plan(root,game,env):
    app,folder,platform,binary,client=GAMES[game];ports=allocated(env,game)
    result={'binary':confined(root,binary),'configs':{},'credentials':[],'ports':ports,
            'log':confined(root,folder+'/Saved/Logs/'+('Server.log' if game=='renown' else folder+'.log'))}
    if game=='ghost':
        values={key:text(env,key,default,4096) for key,default in [('MAP','Asylum'),('GAME_NAME','Dedicated_Server_01'),('GAME_MODE','4v4 Hunt'),('REGION','Eastern Europe'),('B_DIFFICULTY','Auto'),('PASSWORD','')]}
        if values['PASSWORD'] and not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',values['PASSWORD']):raise ValueError('PASSWORD must retain original alpha_dash syntax, maximum128')
        # Original unquoted -Map cannot represent spaces. A typed literal can.
        args=['-server','-log','-port='+str(ports['SERVER_PORT']),'-queryport='+str(ports['QUERY_PORT']),'-BeaconPort='+str(ports['BEACON_PORT']),'-multihome=0.0.0.0']
        for flag,key in [('Map','MAP'),('Gamename','GAME_NAME'),('Gamemode','GAME_MODE'),('Region','REGION'),('BotDifficulty','B_DIFFICULTY'),('password','PASSWORD')]:args.append('-'+flag+'='+literal(values[key]))
        additional=extras(env);args+=additional
        result['credentials'] += [arg.split('=',1)[1] for arg in additional if '=' in arg and re.search(r'password|token|secret|auth|key',arg.split('=',1)[0],re.I)]
        result['credentials'].append(values['PASSWORD']);ready=b'IpNetDriver listening on port'
    elif game=='love':
        name=text(env,'SERVER_NAME','A Pterodactyl Server',64)
        args=['-port='+str(ports['SERVER_PORT']),'-queryport='+str(ports['QUERY_PORT']),'-servername='+literal(name),'-log']
        password=text(env,'SERVER_PASSWORD','',128)
        if password:args.append('-serverpassword='+literal(password));result['credentials'].append(password)
        ready=b'seconds to LoadMap'
    else:
        admin=private(env,'ADMIN_PASSWORD','ChangeMe');rcon=text(env,'RCON_PASSWORD','RconPassword')
        enabled=boolean(env,'ENABLE_RCON',True)
        if enabled:rcon=private(env,'RCON_PASSWORD','RconPassword')
        values={'ServerName':text(env,'SERVER_NAME','A Pterodactyl Hosted Server'),
                'ServerPassword':text(env,'SERVER_PASSWORD'),'AdminPassword':admin,
                'EnableRCON':str(enabled),'RCONPort':str(ports['RCON_PORT']),'RCONPassword':rcon,
                'MaxPlayers':str(integer(env,'MAX_PLAYERS',32,1,2147483647)),
                'MapRotation':text(env,'MAP_ROTATION','RSurv-AlgaraIsle_p'),
                'GameSaveName':text(env,'SAVE_NAME','Save_1'),
                'UseFirstMap':str(boolean(env,'USE_FIRST_MAP',True)),
                'Public':str(boolean(env,'PUBLIC',True)),'PrivateSession':str(boolean(env,'SERVER_LIST',False))}
        if not re.fullmatch(r'[A-Za-z0-9_. -]{1,128}',values['GameSaveName']) or values['GameSaveName'] in ('.','..'):raise ValueError('SAVE_NAME must be a native basename')
        result['configs']={folder+'/Saved/Config/LinuxServer/Game.ini':{RENOWN_SECTION:values},
                           folder+'/Saved/Config/LinuxServer/Engine.ini':{'Server':{'FirstPersonOnly':str(int(boolean(env,'FIRST_PERSON_ONLY',True)))}}}
        result['credentials'] += [admin,rcon,values['ServerPassword']]
        args=['Renown_Combat','-PORT='+str(ports['SERVER_PORT']),'-QUERYPORT='+str(ports['QUERY_PORT']),'-BeaconPort='+str(ports['BEACON_PORT']),'-RCONPort='+str(ports['RCON_PORT']),'-LOG=Server.log']
        args+=renown_seeds()['eos_args'];result['credentials'] += [arg.split('=',1)[1] for arg in renown_seeds()['eos_args']]
        ready=b'Playercount = 0'
    result.update(args=args,ready=ready)
    result['credentials'] += [env.get(key,'') for key in ('STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    return result


def configure(root,game,env):
    selected=plan(root,game,env)
    for name,sections in selected['configs'].items():
        path=confined(root,name)
        before=path.read_text(encoding='utf-8-sig') if path.exists() else renown_seeds()['templates'][Path(name).name]
        selected['credentials']+=re.findall(r'(?mi)^\s*\w*Password\s*=\s*([^\r\n]+)',before)
        # Reject ambiguous managed sections; preserve every unknown/repeated native key.
        seen=set();lines=[];canonical={key.casefold():key for key in sections}
        for line in before.splitlines(keepends=True):
            match=re.match(r'^(\s*)\[([^\]]+)\](.*?)(\r?\n)?$',line)
            if match and match[2].casefold() in canonical:
                key=canonical[match[2].casefold()]
                if key in seen:raise ValueError('Duplicate managed Renown section')
                seen.add(key);line=match[1]+'['+key+']'+match[3]+(match[4] or '')
            lines.append(line)
        native.private_write(path,native.patch_ini(''.join(lines),sections))
    return selected


def options(root,game,env):
    app,folder,platform,binary,client=GAMES[game]
    if integer(env,'SRCDS_APPID',app,1,2147483647)!=app:raise ValueError('This exact dedicated recipe requires its original Steam AppID')
    if boolean(env,'WINDOWS_INSTALL',platform=='windows') != (platform=='windows'):raise ValueError('Keep this exact recipe native platform; no unrelated binary fallback')
    selected={key:env.get(key,'') for key in ('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAID','SRCDS_BETAPASS','INSTALL_FLAGS')}
    steam.arguments(root,app,selected,platform=platform,force_platform=True)
    return selected


def windows_sdk(root,game,selected):
    # Separate app1007 manifests, validated before publishing any SDK payload.
    with tempfile.TemporaryDirectory(prefix='voltra-windows-sdk-', dir=confined(root, '.')) as directory:
        sdk_options={key:selected.get(key,'') for key in ('STEAM_USER','STEAM_PASS','STEAM_AUTH')}
        stage=Path(directory);receipt=steam.update(stage,1007,sdk_options,validate=True,platform='windows',force_platform=True)
        payloads={}
        for name in ('steamclient64.dll','tier0_s64.dll','vstdlib_s64.dll'):
            candidates=[path for path in stage.rglob(name) if path.is_file() and not path.is_symlink()]
            if len(candidates)!=1:raise ValueError('Validated Windows Steam SDK is missing or ambiguous: '+name)
            source=confined(stage,candidates[0].relative_to(stage))
            if source.stat().st_size>256*1024**2:raise ValueError('Unexpected Steam SDK DLL size')
            data=source.read_bytes()
            if len(data)<64 or data[:2]!=b'MZ':raise ValueError('Steam SDK is not a Windows PE library')
            offset=struct.unpack_from('<I',data,60)[0]
            if offset+6>len(data) or data[offset:offset+4]!=b'PE\0\0' or struct.unpack_from('<H',data,offset+4)[0]!=0x8664:
                raise ValueError('Steam SDK must contain actual Win64 PE libraries')
            payloads[name]=data
        payloads['.voltra-sdk1007.json']=(json.dumps({'steam':receipt,'platform':'windows','files':{name:hashlib.sha256(data).hexdigest() for name,data in payloads.items()}},sort_keys=True)+'\n').encode()
        prefix=GAMES[game][3].rsplit('/',1)[0]+'/'
        previous={}
        for name in payloads:
            target=confined(root,prefix+name)
            previous[name]=(target.read_bytes(),target.stat()) if target.exists() else None
        published=[]
        try:
            for name,data in payloads.items():
                steam._publish(root,prefix+name,lambda output,data=data:output.write(data),0o644);published.append(name)
        except BaseException:
            for name in reversed(published):
                target=confined(root,prefix+name);old=previous[name]
                if old is None:target.unlink()
                else:
                    data,stat=old;steam._publish(root,prefix+name,lambda output,data=data:output.write(data),stat.st_mode&0o777)
                    target.chmod(stat.st_mode&0o777);os.utime(target,ns=(stat.st_atime_ns,stat.st_mtime_ns))
            raise


def install(root,game,env):
    selected=options(root,game,env);app,folder,platform,binary,client=GAMES[game]
    saved=confined(root,folder+'/Saved')
    protected=[path for path in saved.rglob('*') if path.is_file() and path.suffix.lower() in ('.ini','.cfg','.txt','.json')] if saved.exists() else []
    with tempfile.TemporaryDirectory(prefix='voltra-ghost-retention-', dir=confined(root, '.')) as directory:
        backups=[]
        for index,path in enumerate(protected):
            path=confined(root,path.relative_to(root));backup=Path(directory)/str(index);shutil.copy2(path,backup);backups.append((path.relative_to(root),backup))
        try:
            steam.update(root,app,selected,validate=True,required=(binary,),platform=platform,force_platform=True)
            if platform=='windows':windows_sdk(root,game,selected);proton.provision(root)
        finally:
            for name,backup in backups:
                target=confined(root,name);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(backup,target)
    if game=='love':
        data=b'1873120\n';steam._publish(root,'steam_appid.txt',lambda output:output.write(data),0o644)


def environment(root,game,env):
    result={key:value for key,value in env.items() if key not in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH','ADDITIONAL_ARGS') and not any(word in key for word in ('PASSWORD','TOKEN','STEAM_PASS','STEAM_AUTH','BETAPASS'))}
    result.update(HOME=str(root),SteamAppId=str(GAMES[game][4]))
    if GAMES[game][2]=='windows':
        proton.location(root)
        for key,name in [('STEAM_COMPAT_CLIENT_INSTALL_PATH','.steam/steam'),('STEAM_COMPAT_DATA_PATH','.voltra/ghost-love/'+game+'/compatdata')]:
            path=confined(root,name);path.mkdir(parents=True,exist_ok=True);result[key]=str(path)
        result['WINEPREFIX']=str(confined(root,'.voltra/ghost-love/'+game+'/compatdata/pfx'))
        result['LD_LIBRARY_PATH']=str(confined(root,'.voltra/proton/lib'))+':'+str(confined(root,'.steam/sdk64'))
    return result


def follow_log(root,path,offset,done,credentials,emit):
    """Follow only new bytes; preserve old logs, handle rotation/truncation."""
    identity=None;redactor=steam.Redactor(credentials)
    while True:
        stopping=done.wait(.1)
        target=confined(root,path.relative_to(root))
        if not target.exists():
            if stopping:break
            continue
        stat=target.stat();current=(stat.st_dev,stat.st_ino)
        if identity is not None and identity!=current or stat.st_size<offset:offset=0
        identity=current
        with target.open('rb') as stream:
            stream.seek(offset);data=stream.read(65536);offset=stream.tell()
        if data:emit(redactor.feed(data))
        if stopping:
            # One bounded final drain includes the server's shutdown diagnostics.
            with target.open('rb') as stream:
                stream.seek(offset)
                remaining=stream.read(4*1024**2)
                if remaining:emit(redactor.feed(remaining))
            break
    emit(redactor.feed(b'',final=True))


def run(root,game,selected,child_env):
    done=threading.Event();log=selected['log'];offset=log.stat().st_size if log.exists() else 0
    def emit(data):sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
    thread=threading.Thread(target=follow_log,args=(root,log,offset,done,selected['credentials'],emit),daemon=True);thread.start()
    argv=[str(selected['binary']),*selected['args']]
    if GAMES[game][2]=='windows':argv=[str(proton.location(root)),'run',*argv]
    try:return console.run(root,argv,child_env,'',credentials=selected['credentials'],ready_marker=selected['ready'],stop_signal=signal.SIGINT)
    finally:done.set();thread.join(timeout=2)


def main():
    action,game=sys.argv[1:]
    if action not in ('install','run') or game not in GAMES:raise ValueError('Unknown exact recipe action')
    root=Path.cwd().resolve();env=dict(os.environ)
    if action=='install':install(root,game,env);return 0
    plan(root,game,env)
    if boolean(env,'VOLTRA_STEAM_AUTO_UPDATE',True):install(root,game,env)
    return run(root,game,configure(root,game,env),environment(root,game,env))


if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:
        print(str(error) if isinstance(error,ValueError) else 'Ghost/Love/Renown operation failed: '+type(error).__name__,file=sys.stderr);sys.exit(1)
