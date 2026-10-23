#!/usr/bin/env python3
"""MIT. Additional Source games using the shared native configuration/console."""
import os
from pathlib import Path
import re
import time
import threading
import shutil
from source_runtime import GAMES, configure, private_write
from native_console import run
from source_install import update
from source_l4d import query_ready, local_query_address

READY='VOLTRA_SOURCE_MAP_READY'


class CoopBoot:
    """Only this invocation's real plugin initialization can satisfy readiness."""
    def __init__(self):
        self.pending=b'';self.initialized=threading.Event()
    def feed(self,data):
        self.pending+=data
        while b'\n' in self.pending:
            line,self.pending=self.pending.split(b'\n',1)
            line=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',line).strip()
            match=re.fullmatch(rb'\[SRCCOOP\] Scanned ([1-9][0-9]{0,5}) maps for voting in [0-9]{1,12}(?:\.[0-9]{1,12})? seconds\.',line)
            if match:self.initialized.set()
        self.pending=self.pending[-8192:]


class ContagionBoot:
    def __init__(self,game_map):
        self.game_map=game_map;self.pending=b'';self.phase=0;self.initialized=threading.Event()
    def feed(self,data):
        self.pending+=data
        while b'\n' in self.pending:
            line,self.pending=self.pending.split(b'\n',1)
            line=re.sub(rb'\x1b\[[0-?]*[ -/]*[@-~]',b'',line).decode('utf-8','replace').strip()
            if line.startswith('Host_NewGame on map '):
                self.phase=1 if line.removeprefix('Host_NewGame on map ').strip().strip('"')==self.game_map else 0
                self.initialized.clear()
            elif line=='VOLTRA_CONTAGION_CONFIG_APPLIED' and self.phase==1:self.phase=2
            elif line in ('VAC secure mode disabled.','VAC secure mode enabled.') and self.phase==2:self.initialized.set()
        self.pending=self.pending[-8192:]


def contagion_verified(host,settings,cancel):
    from source_wine_runtime import command
    text=command(host,int(settings['SERVER_PORT']),settings['RCON_PASSWORD'],'status;sv_password',cancel)
    name=re.search(r'^hostname\s*:\s*(.*?)\s*$',text,re.M);game_map=re.search(r'^map\s*:\s*(\S+)',text,re.M)
    slots=re.search(r'^players\s*:.*?\((\d+) max\)',text,re.M);password=re.search(r'"sv_password"\s*=\s*"([^"\r\n]*)"',text)
    return bool(name and name.group(1)==settings.get('HOSTNAME','Source dedicated server') and game_map and game_map.group(1)==settings.get('SRV_MAP','ce_barlowe') and slots and int(slots.group(1))==int(settings.get('SRV_MAXPLAYERS','8')) and password and password.group(1)==settings.get('SERVER_PASSWORD',''))


def contagion_ready(boot,settings,cancel,*,host,timeout=120,emit=print):
    deadline=time.monotonic()+timeout
    while not cancel.is_set() and time.monotonic()<deadline:
        if boot.initialized.is_set():
            try:
                verified=not settings.get('RCON_PASSWORD') or contagion_verified(host,settings,cancel)
                if verified and boot.initialized.is_set() and not cancel.is_set():emit(READY,flush=True);return
            except (OSError,ValueError,UnicodeError):pass
        cancel.wait(0.25)

GAMES.update({'4020':('garrysmod','gm_flatgrass',128),
              '244310':('open_fortress','dm_2fort',32),
              '346680':('bms','bm_c0a0a',128),
              '293030':('contagion','ce_barlowe',32)})


def launch(root, settings):
    env = dict(settings)
    app = env.get('SRCDS_APPID')
    if app not in ('4020', '244310', '346680', '293030'): raise ValueError('Choose a reviewed additional Source application')
    launcher='srcds_run'
    if app=='293030':
        env['SRCDS_MAP']=env.get('SRV_MAP','ce_barlowe');env['MAX_PLAYERS']=env.get('SRV_MAXPLAYERS','8')
        windows=env.get('WINDOWS_INSTALL','0')
        if windows not in ('0','1'):raise ValueError('WINDOWS_INSTALL must be 0 or 1')
        launcher='contagionds.exe' if windows=='1' else 'contagion_dedicated'
        config=env.get('SRV_CONFIG','server.cfg')
        if not re.fullmatch(r'[A-Za-z0-9_/-]{1,124}\.cfg',config) or any(p in ('','.','..')for p in config.split('/')) or config.startswith('voltra-'):
            raise ValueError('Choose a native relative configuration filename outside the managed namespace')
        if windows=='1':
            if env.get('WINEARCH','win32') not in ('win32','win64'):raise ValueError('Choose win32 or win64 Wine prefix architecture')
            if not re.fullmatch(r'[A-Za-z0-9_+,-]{0,256}',env.get('WINEDEBUG','-all')):raise ValueError('Invalid Wine debug channels')
            if any(ord(c)<32 for c in env.get('WINEPATH','/home/container')) or len(env.get('WINEPATH',''))>1024:raise ValueError('Invalid Wine library path')
            tricks=env.get('WINETRICKS_RUN','vcrun2013 vcrun2015 corefonts').split()
            if len(tricks)!=len(set(tricks)) or any(t not in ('vcrun2013','vcrun2015','corefonts')for t in tricks):raise ValueError('Choose supported Contagion Wine runtime components')
            if not shutil.which('wine'):raise ValueError('Choose the pinned Wine runtime image for the Windows package')
    if app == '346680':
        if env.get('VOLTRA_SOURCE_RECIPE') != 'sourcecoop':raise ValueError('Choose the SourceCoop profile for this adapter')
        env['HOSTNAME']=env.get('SERVER_NAME','Black Mesa: Coop')
        env['SRCDS_MAP']=env.get('STARTING_MAP','bm_c0a0a')
        if env.get('SERVER_PASSWORD')=='0':env['SERVER_PASSWORD']=''
        for key in ('FRIENDLY_FIRE','MOD_FORCETOUCHDATA'):
            if env.get(key,'0' if key=='FRIENDLY_FIRE' else '1') not in ('0','1'):raise ValueError('SourceCoop controls must be 0 or 1')
    if app == '4020':
        env['STEAM_GSLT'] = env.get('STEAM_TOKEN', '')
        mode = env.get('GAMEMODE', 'sandbox')
        workshop = env.get('WORKSHOP_ID', '')
        tickrate = int(env.get('TICKRATE', '22'))
        refresh = env.get('LUA_REFRESH', '0')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', mode): raise ValueError('Choose an installed native gamemode folder')
        if workshop and not re.fullmatch(r'[1-9][0-9]{0,19}', workshop): raise ValueError('Workshop collection ID must be a positive decimal ID')
        if not 1 <= tickrate <= 100 or refresh not in ('0', '1'): raise ValueError('Choose a supported tick rate and Lua refresh toggle')
        if env.get('PUBLIC_SERVER', '0') == '1' and not env['STEAM_GSLT']:
            raise ValueError('Garrys Mod Internet mode requires a real game server login token')
    elif app=='244310': env['MAX_PLAYERS'] = env.get('MAXPLAYERS', '24')
    argv, environment = configure(root, env,launcher=launcher)
    if app == '4020':
        argv[1:1] = ['-tickrate', str(tickrate), '+gamemode', mode]
        if refresh == '0': argv[1:1] = ['-disableluarefresh']
        if workshop: argv[1:1] = ['+host_workshop_collection', workshop]
    elif app=='346680':
        target=root.resolve()/'bms/cfg/voltra-coop.cfg'
        backups=root.resolve()/'.voltra/source-next/config-backups'
        defaults=root.resolve()/'bms/cfg/voltra-coop-defaults.cfg'
        if any(not p.resolve().is_relative_to(root.resolve()) for p in (target,backups,defaults)):raise ValueError('SourceCoop configuration escapes server volume')
        content='mp_teamplay 1\nmp_friendlyfire '+env.get('FRIENDLY_FIRE','0')+'\nmod_forcetouchdata '+env.get('MOD_FORCETOUCHDATA','1')+'\n'
        if target.exists() and target.read_text()!=content:private_write(backups/(str(time.time_ns())+'.cfg'),target.read_text())
        private_write(target,content)
        private_write(defaults,'mp_timelimit 0\nmp_fraglimit 0\nsv_always_run 0\nmp_mapcycle_empty_timeout_seconds 3600\nsourcecoop_homemap "bm_c0a0a"\nsv_tags "custom, coop, sourcecoop"\nsv_cheats 0\nsv_alltalk 1\n')
        private_write(root.resolve()/'bms/cfg/voltra-server.cfg','exec voltra-coop-defaults.cfg\nexec server.cfg\nexec voltra-managed.cfg\nexec voltra-coop.cfg\n')
    elif app=='293030':
        argv[1:1]=['-steam','-dedicated','-log','-condebug','-conclearlog','-tickrate','128']
        private_write(root.resolve()/'contagion/cfg/voltra-server.cfg','exec "'+config+'"\nexec voltra-managed.cfg\necho VOLTRA_CONTAGION_CONFIG_APPLIED\n')
        if windows=='1':argv.insert(0,shutil.which('wine'))
    return argv, environment


def run_ready(root,argv,environment,credentials,settings,*,native_runner=None):
    app=settings['SRCDS_APPID'];coop=app=='346680'
    name=settings.get('SERVER_NAME' if coop else 'HOSTNAME','Black Mesa: Coop' if coop else 'Source dedicated server')
    game_map=settings.get('STARTING_MAP' if coop else 'SRV_MAP' if app=='293030' else 'SRCDS_MAP',GAMES[app][1])
    password=settings.get('SERVER_PASSWORD','')
    if coop and password=='0':password=''
    cancel=threading.Event();host=local_query_address()
    boot=CoopBoot() if coop else ContagionBoot(game_map) if app=='293030' else None
    def emit(_marker,flush=True):
        if boot:
            deadline=time.monotonic()+120
            while not boot.initialized.is_set() and not cancel.is_set() and time.monotonic()<deadline:cancel.wait(0.1)
            if not boot.initialized.is_set():return
        if not cancel.is_set():print(READY,flush=flush)
    observer=threading.Thread(target=contagion_ready,args=(boot,settings,cancel),kwargs={'host':host},daemon=True) if app=='293030' else threading.Thread(target=query_ready,args=(int(settings['SERVER_PORT']),name,game_map,bool(password),cancel),kwargs={'host':host,'emit':emit},daemon=True)
    try:
        observer.start()
        options={'terminal_input':True}
        if boot:options['output_observer']=boot.feed
        return (native_runner or run)(root,argv,environment,'quit',credentials,**options)
    finally:
        cancel.set()
        if observer.ident is not None:observer.join(timeout=1)


if __name__ == '__main__':
    root = Path.cwd()
    automatic = os.environ.get('VOLTRA_STEAM_AUTO_UPDATE', os.environ.get('AUTO_UPDATE', '0'))
    if automatic not in ('0', '1'): raise ValueError('AUTO_UPDATE must be 0 or 1')
    if automatic == '1':
        if os.environ['SRCDS_APPID']=='244310':
            from source_openfortress_install import install
            install(root,dict(os.environ),validate=False)
        elif os.environ['SRCDS_APPID']=='293030':
            windows=os.environ.get('WINDOWS_INSTALL','0')=='1'
            update(root,293030,validate=False,platform='windows' if windows else 'linux',required=('contagionds.exe' if windows else 'contagion_dedicated',))
        else:update(root, int(os.environ['SRCDS_APPID']), validate=False, required=('srcds_run',))
    argv, environment = launch(root, os.environ)
    credentials = [os.environ.get(key, '') for key in ('SERVER_PASSWORD','RCON_PASSWORD','STEAM_TOKEN','STEAM_GSLT','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')]
    native_runner=None
    if os.environ['SRCDS_APPID']=='293030' and os.environ.get('WINDOWS_INSTALL','0')=='1':
        from source_wine_runtime import run as native_runner
    raise SystemExit(run_ready(root, argv, environment, credentials, os.environ,native_runner=native_runner))
