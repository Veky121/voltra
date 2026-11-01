#!/usr/bin/env python3
"""Sons-only adapter. Native config is authoritative after first seed."""
import json, os, signal, sys
from pathlib import Path
import importlib.util

def family():
    source = Path(__file__).with_name('forest-survival.py')
    spec = importlib.util.spec_from_file_location('sons_family', source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

# Reviewed dependencies have guarded CLIs and no acquisition at import.
f = family()
CONFIG = 'serverconfig/dedicatedserver.cfg'

def pairs(rows):
    result = {}
    for key, value in rows:
        if key.casefold() in {k.casefold() for k in result}:
            raise ValueError('Duplicate or case-variant config key: ' + key)
        result[key] = value
    return result

def preflight(root, env):
    root = Path(root).resolve()
    if env.get('SRCDS_APPID', '2465200') != '2465200' or env.get('WINDOWS_INSTALL', '1') != '1':
        raise ValueError('Original Windows dedicated app required')
    f.steam.arguments(root, 2465200, env, platform='windows', force_platform=True)
    ports = f.roles('sons', env)
    if env.get('ACCEPT_WINDOWS_RUNTIME_LICENSES', 'false') != 'true':
        raise ValueError('Explicit Windows runtime license acceptance required before acquisition')
    if env.get('WINEPREFIX', str(root/'.wine')) != str(root/'.wine') or env.get('WINEARCH', 'win64') != 'win64':
        raise ValueError('Original private win64 prefix required')
    f.path(root, '.wine/system.reg')
    registry = root/'.wine/system.reg'
    if registry.exists() and '#arch=win32' in registry.read_text(errors='replace')[:1024]:
        raise ValueError('Existing win32 prefix retained; win64 required')
    f.shared.confined(root, Path(env.get('WINEPATH', str(root))))
    f.text(env, 'WINEDEBUG', '-all', 32)
    verbs = env.get('VOLTRA_WINETRICKS_RUN', env.get('WINETRICKS_RUN', 'mono vcrun2019')).split()
    if not verbs or len(set(verbs)) != len(verbs) or any(v not in ('mono', 'vcrun2019') for v in verbs):
        raise ValueError('Unsupported typed Sons runtime prerequisites')
    f.choice(env, 'VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE', '1'), ['0', '1'])
    slot = f.text(env, 'SAVE_SLOT', '0000000001', 30)
    if not slot.isascii() or not slot.isdecimal() or not 1 <= int(slot) <= 2147483647:
        raise ValueError('SAVE_SLOT requires positive Int32')
    seed = dict(IpAddress='0.0.0.0', GamePort=ports['SERVER_PORT'], QueryPort=ports['QUERY_PORT'], BlobSyncPort=ports['BLOBSYNC_PORT'],
                ServerName=f.text(env, 'SRV_NAME', 'Pterodactyl hosted Server', 60), Password=f.text(env, 'SRV_PW', 'changeme', 40),
                MaxPlayers=f.integer(env, 'MAX_PLAYERS', 4, 1, 8), SaveSlot=int(slot), SaveMode='Continue',
                GameMode=f.choice(env, 'GAME_MODE', 'normal', ['normal','hard','hardsurvival','peaceful','custom']),
                SkipNetworkAccessibilityTest=f.choice(env, 'SKIP_TESTS', 'false', ['true','false']) == 'true',
                LogFilesEnabled=True, TimestampLogFilenames=True)
    target = f.path(root, CONFIG)
    f.path(root, 'serverconfig/ownerswhitelist.txt')
    if target.exists():
        if target.stat().st_size > 4*1024*1024: raise ValueError('Config exceeds budget')
        config = json.loads(target.read_text(encoding='utf-8-sig'), object_pairs_hook=pairs,
                            parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Non-finite JSON')))
        if not isinstance(config, dict): raise ValueError('Config must be object')
        for key in ('ServerName', 'Password'):
            if key in config and (not isinstance(config[key], str) or any(c in config[key] for c in '\r\n\0')): raise ValueError('Invalid '+key)
        for key, low, high in [('MaxPlayers',1,8),('SaveSlot',1,2147483647)]:
            if key in config and (type(config[key]) is not int or not low <= config[key] <= high): raise ValueError('Invalid '+key)
        for key in ('LanOnly','SkipNetworkAccessibilityTest','LogFilesEnabled','TimestampLogFilenames','TimestampLogEntries'):
            if key in config and type(config[key]) is not bool: raise ValueError('Invalid '+key)
        for key in ('GameSettings','CustomGameModeSettings'):
            if key in config and config[key] is not None and not isinstance(config[key], dict): raise ValueError('Invalid '+key)
        if 'Password' in config and len(config['Password']) > 40: raise ValueError('Invalid Password')
        if 'SaveInterval' in config and type(config['SaveInterval']) is not int: raise ValueError('Invalid SaveInterval')
        for key, values in [('GameMode', ('normal','hard','hardsurvival','peaceful','creative','custom')), ('SaveMode', ('new','continue'))]:
            if key in config and (not isinstance(config[key], str) or config[key].lower() not in values): raise ValueError('Invalid '+key)
    else: config = seed
    return root, ports, config, not target.exists()

def execute(root, env, operation):
    root, ports, config, missing = preflight(root, env)
    if operation == 'check': return 0
    # All game inputs/consent/path checks above precede runtime and Steam writes.
    runtime = f.wine.prepare(root, env, 'mono vcrun2019', f.PINS, ('mono','vcrun2019'))
    if operation == 'install' or env.get('VOLTRA_STEAM_AUTO_UPDATE', env.get('AUTO_UPDATE','1')) == '1':
        f.install(root, 'sons', env)
    if missing and not f.path(root, CONFIG).exists():
        f.publish(root, CONFIG, (json.dumps(config, indent=2)+'\n').encode())
    if not f.path(root, 'serverconfig/ownerswhitelist.txt').exists():
        f.publish(root, 'serverconfig/ownerswhitelist.txt', b'')
    if operation == 'install': return 0
    argv = ['xvfb-run','--auto-servernum','--server-args=-screen 0 640x480x24:32','wine',str(f.path(root,'SonsOfTheForestDS.exe')),
            '-userdatapath',str(f.path(root,'serverconfig'))]
    # Allocations alone override the native file. Gameplay/password remain native.
    for key, value in [('IpAddress','0.0.0.0'),('GamePort',ports['SERVER_PORT']),('QueryPort',ports['QUERY_PORT']),('BlobSyncPort',ports['BLOBSYNC_PORT'])]:
        argv += ['-dedicatedserver.'+key,str(value)]
    return f.console.run(root, argv, runtime, '\x03', credentials=tuple(v for v in [config.get('Password')] if v),
                         ready_marker=b'#DSL Dedicated server loaded.', terminal_input=True, stop_signal=signal.SIGINT)

if __name__ == '__main__':
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in ('check','install','run'): raise ValueError('Expected check/install/run')
        sys.exit(execute(Path.cwd(),dict(os.environ),sys.argv[1]))
    except (ValueError,OSError) as error:
        print('Sons setup refused: '+str(error),file=sys.stderr); sys.exit(2)
