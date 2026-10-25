#!/usr/bin/env python3
"""MIT. Exact imported AAPG/Battalion/GroundBranch publisher acquisition."""
import json
import os
from pathlib import Path
import shutil
import stat
import tempfile
from steam_template import arguments, update, _publish
from tactical_install import confined

GAMES = {
 'aapg': {'app':203300, 'platform':'linux', 'binaries':['Binaries/Linux/AAPG'], 'preserve':['AAGame/Config','AAGame/Cloud','AAGame/Logs','AAPG/Config','AAPG/Saved','AAPG/ServerConfig','AAPG/Content/Maps','AAEngine/Config']},
 'battalion': {'app':805140, 'platform':'linux', 'binaries':['Battalion/Binaries/Linux/BattalionServer-Linux-Shipping','BattalionServer/BattalionServer.sh'], 'preserve':['Battalion/Saved','Battalion/ServerConfig','Battalion/Config','BattalionServer/Config','BattalionServer/Saved']},
 'groundbranch': {'app':476400, 'platform':'windows', 'binaries':['GroundBranch/Binaries/Win64/GroundBranchServer-Win64-Shipping.exe'], 'preserve':['GroundBranch/ServerConfig','GroundBranch/Saved','GroundBranch/Config','GroundBranch/Mods','steamapps/workshop/content/16900','.wine']}}


def selection(env):
    kind = env.get('VOLTRA_TACTICAL_NEXT', '')
    if kind not in GAMES: raise ValueError('Choose a reviewed tactical recipe')
    info = GAMES[kind]
    if env.get('SRCDS_APPID', str(info['app'])) != str(info['app']): raise ValueError('Dedicated app does not match the original recipe')
    if env.get('WINDOWS_INSTALL', '1' if info['platform']=='windows' else '0') != ('1' if info['platform']=='windows' else '0'): raise ValueError('Original dedicated target platform does not match')
    return kind, info


def native_binary(root, info):
    candidates = [confined(root, name) for name in info['binaries'] if confined(root, name).is_file()]
    if len(candidates) != 1: raise ValueError('Publisher installation must provide exactly one reviewed dedicated launcher layout')
    return candidates[0]


def default_server(root, content):
    name='GroundBranch/ServerConfig/Server.ini'; target=confined(root,name)
    if not target.exists(): _publish(root,name,lambda output:output.write(content if isinstance(content,bytes) else content.encode()),0o600)


def install(root, env, validate=True, groundbranch_default=None):
    root=Path(root).resolve(); kind,info=selection(env)
    arguments(root,info['app'],env,validate,platform=info['platform'])
    retained={}
    with tempfile.TemporaryDirectory(prefix='.tactical-next-retention-',dir=root) as temporary:
        for name in info['preserve']:
            folder=confined(root,name)
            if not folder.exists(): continue
            for path in folder.rglob('*'):
                # Wine's own dosdevices links (including z: -> /) are left
                # untouched in place and never traversed or copied. Steam
                # does not own this prefix. Retain its actual regular state.
                if name=='.wine' and path.is_symlink():continue
                confined(root,path.relative_to(root))
                if path.is_file():
                    metadata=path.stat()
                    if not stat.S_ISREG(metadata.st_mode): raise ValueError('Operator state must contain regular files')
                    relative=str(path.relative_to(root)); backup=Path(temporary)/str(len(retained));shutil.copyfile(path,backup);retained[relative]=(backup,metadata)
        try:
            result=update(root,info['app'],env=env,validate=validate,platform=info['platform'])
            binary=native_binary(root,info)
            if info['platform']=='linux': binary.chmod(binary.stat().st_mode|0o100)
            if kind=='groundbranch':
                if groundbranch_default is None: groundbranch_default=Path(__file__).with_name('groundbranch_original_Server.ini').read_bytes()
                default_server(root,groundbranch_default)
            return result
        finally:
            errors=[]
            for name,(backup,metadata) in retained.items():
                try:
                    confined(root,name)
                    def write(output,backup=backup):
                        with backup.open('rb') as incoming:shutil.copyfileobj(incoming,output)
                    _publish(root,name,write,stat.S_IMODE(metadata.st_mode));target=root/name
                    if os.geteuid()==0:os.chown(target,metadata.st_uid,metadata.st_gid)
                    target.chmod(stat.S_IMODE(metadata.st_mode));os.utime(target,ns=(metadata.st_atime_ns,metadata.st_mtime_ns))
                except Exception as error:errors.append(type(error).__name__)
            if errors:raise RuntimeError('Unable to restore tactical operator state: '+','.join(errors))


if __name__=='__main__':install(Path.cwd(),dict(os.environ))
