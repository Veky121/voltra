#!/usr/bin/env python3
"""MIT. Original crafting server installs, scoped license phase and retention."""
import os
import json
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
from steam_template import arguments, bootstrap, update, Redactor, _publish, _publication_check
from tactical_install import confined

GAMES={
 'craftopia':(1670340,'linux','Craftopia.x86_64',('ServerSetting.ini','DedicatedServerSave','PPSave','.config','.local/share','BepInEx','mods')),
 'cubic':(3858450,'windows','server/CubicOdysseyServer.exe',('config','save_server','server/save_server','saves','.wine','mods')),
 'romestead':(4763510,'linux','Server.dll',('config.json','.config','.local/share','worlds','saves','saved_worlds','Mods','BepInEx'))}


def selection(env):
    kind=env.get('VOLTRA_CRAFTING','')
    if kind not in GAMES:raise ValueError('Choose an original crafting server profile')
    app,platform,binary,preserve=GAMES[kind]
    if env.get('SRCDS_APPID',str(app))!=str(app):raise ValueError('Dedicated application does not match original recipe')
    if env.get('WINDOWS_INSTALL','1'if platform=='windows'else'0')!=('1'if platform=='windows'else'0'):raise ValueError('Dedicated target platform does not match original recipe')
    return kind,app,platform,binary,preserve


def request_cubic_license(root,env):
    args=arguments(root,3858450,env,platform='windows');args=args[:args.index('+app_info_update')]+['+app_license_request','3858450','+quit']
    _publication_check(root)
    bootstrap(root)
    _publication_check(root)
    child_env={**os.environ,'HOME':str(root)}
    for key in('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'):child_env.pop(key,None)
    child=subprocess.Popen(['timeout','--signal=TERM','--kill-after=30s','300s',*args],cwd=root,env=child_env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    redactor=Redactor([env.get(key,'')for key in('STEAM_USER','STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS')])
    try:
        for block in iter(lambda:child.stdout.read1(16384),b''):
            sys.stdout.buffer.write(redactor.feed(block));sys.stdout.buffer.flush()
        sys.stdout.buffer.write(redactor.feed(b'',final=True));sys.stdout.buffer.flush()
        if child.wait()!=0:raise RuntimeError('Cubic Odyssey original publisher license request failed')
    except BaseException:
        if child.poll()is None:
            child.terminate()
            try:child.wait(timeout=30)
            except subprocess.TimeoutExpired:child.kill();child.wait()
        raise RuntimeError('Cubic Odyssey license request did not complete; inspect redacted publisher output')from None
    # Exit0 is not a license entitlement claim: shared update must subsequently
    # acquire and validate the actual original dedicated application manifest.


def install(root,env,validate=True,craftopia_default=None):
    root=Path(root).resolve();kind,app,platform,binary,preserve=selection(env)
    arguments(root,app,env,validate,platform=platform)
    initial_romestead=None
    if kind=='romestead'and not confined(root,'config.json').exists():
        from crafting_runtime import romestead_document
        initial_romestead=romestead_document(env)
    retained={}
    with tempfile.TemporaryDirectory(prefix='.crafting-retention-',dir=root)as temporary:
        for name in preserve:
            path=confined(root,name)
            if not path.exists():continue
            for candidate in path.rglob('*')if path.is_dir()else[path]:
                if name=='.wine'and candidate.is_symlink():continue
                confined(root,candidate.relative_to(root))
                if candidate.is_file():
                    metadata=candidate.stat()
                    if not stat.S_ISREG(metadata.st_mode):raise ValueError('Crafting operator state must be regular files')
                    relative=str(candidate.relative_to(root));backup=Path(temporary)/str(len(retained));shutil.copyfile(candidate,backup);retained[relative]=(backup,metadata)
        try:
            if kind=='cubic':request_cubic_license(root,env)
            result=update(root,app,env=env,validate=validate,platform=platform,force_platform=kind=='romestead',required=(binary,))
            native=confined(root,binary)
            if platform=='linux'and kind!='romestead':native.chmod(native.stat().st_mode|0o100)
            if kind=='craftopia'and not confined(root,'ServerSetting.ini').exists():
                if craftopia_default is None:craftopia_default=Path(__file__).with_name('craftopia_original_server.ini').read_bytes()
                _publish(root,'ServerSetting.ini',lambda output:output.write(craftopia_default),0o600)
            if initial_romestead is not None:
                # Genuine pre-update absence is the first-install boundary. A
                # publisher ships config.json with autocreate disabled; retain
                # its unknown keys while applying the original egg defaults.
                # Existing operator config never enters this branch.
                target=confined(root,'config.json')
                from crafting_runtime import romestead_document
                document=json.loads(romestead_document(env,target.read_bytes()if target.exists()else b''))
                document.update(json.loads(initial_romestead))
                initialized=(json.dumps(document,ensure_ascii=False,indent=2)+'\n').encode()
                _publish(root,'config.json',lambda output:output.write(initialized),0o600)
            if kind=='romestead':
                for name in('.local/share','.config','logs'):confined(root,name).mkdir(parents=True,exist_ok=True)
            return result
        finally:
            errors=[]
            for name,(backup,metadata)in retained.items():
                try:
                    confined(root,name)
                    def write(output,backup=backup):
                        with backup.open('rb')as incoming:shutil.copyfileobj(incoming,output)
                    _publish(root,name,write,stat.S_IMODE(metadata.st_mode));target=root/name
                    if os.geteuid()==0:os.chown(target,metadata.st_uid,metadata.st_gid)
                    target.chmod(stat.S_IMODE(metadata.st_mode));os.utime(target,ns=(metadata.st_atime_ns,metadata.st_mtime_ns))
                except Exception as error:errors.append(type(error).__name__)
            if errors:raise RuntimeError('Unable to restore crafting operator state: '+','.join(errors))


if __name__=='__main__':install(Path.cwd(),dict(os.environ))
