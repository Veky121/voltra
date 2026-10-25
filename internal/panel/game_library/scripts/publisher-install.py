#!/usr/bin/env python3
"""MIT. Bounded original publisher tooling and lawful operator-file handoff."""
import hashlib
import json
import os
from pathlib import Path,PurePosixPath
import shutil
import stat
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile
from contextlib import contextmanager
from steam_template import _publish
from tactical_install import confined
from source_next_install import apply_payload

QUERY={'url':'https://github.com/physgun-com/hytale-sourcequery/releases/download/v1.1.0/sourcequery.jar','sha256':'418179580bac047f929382d290463fc34bc7e4b72feff5e5d187abee048478f5','bytes':14134}
URLS={'hytale':'https://downloader.hytale.com/hytale-downloader.zip','titans':'https://launcher-cdn.alderongames.com/AlderonGamesCmd-Linux-x64'}
HOSTS={'downloader.hytale.com','launcher-cdn.alderongames.com','cdn.discordapp.com','media.discordapp.net','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'}


def selection(env):
    kind=env.get('VOLTRA_PUBLISHER','');mode=env.get('ACQUISITION_MODE','publisher')
    if kind not in('hytale','titans','hogwarp')or mode not in('publisher','operator'):raise ValueError('Choose a reviewed publisher profile and lawful acquisition mode')
    return kind,mode


def public_url(url):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!='https'or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.fragment:raise ValueError('Acquisition requires an approved original publisher HTTPS host')
    return url


class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,url):
        public_url(url);return super().redirect_request(request,fp,code,message,headers,url)


def digest(path):
    result=hashlib.sha256()
    with path.open('rb')as source:
        for block in iter(lambda:source.read(1048576),b''):result.update(block)
    return result.hexdigest()


@contextmanager
def retain_operators(root,names):
    records={}
    with tempfile.TemporaryDirectory(prefix='.publisher-retention-',dir=root)as temporary:
        for name in names:
            source=confined(root,name)
            if not source.exists():continue
            for path in source.rglob('*')if source.is_dir()else[source]:
                confined(root,path.relative_to(root))
                if path.is_file():
                    metadata=path.stat();backup=Path(temporary)/str(len(records));shutil.copyfile(path,backup);records[str(path.relative_to(root))]=(backup,metadata)
        try:yield
        finally:
            errors=[]
            for name,(backup,metadata)in records.items():
                try:
                    def write(output,backup=backup):
                        with backup.open('rb')as source:shutil.copyfileobj(source,output)
                    _publish(root,name,write,metadata.st_mode&0o777);target=root/name
                    if os.geteuid()==0:os.chown(target,metadata.st_uid,metadata.st_gid)
                    target.chmod(metadata.st_mode&0o777);os.utime(target,ns=(metadata.st_atime_ns,metadata.st_mtime_ns))
                except Exception as error:errors.append(type(error).__name__)
            if errors:raise RuntimeError('Unable to restore publisher operator state: '+','.join(errors))


def download(url,target,maximum,expected=None):
    public_url(url);size=0;hashing=hashlib.sha256()
    with urllib.request.build_opener(Redirect()).open(urllib.request.Request(url,headers={'User-Agent':'Voltra-Publisher-Installer'}),timeout=120)as source,target.open('xb')as output:
        while True:
            block=source.read(1048576)
            if not block:break
            size+=len(block)
            if size>maximum:raise ValueError('Publisher download exceeds its bounded size')
            output.write(block);hashing.update(block)
    if expected and hashing.hexdigest()!=expected:raise ValueError('Publisher asset expected checksum mismatch')
    # Signed download queries may contain private material: record no URL query.
    parsed=urllib.parse.urlsplit(url)
    return{'source':urllib.parse.urlunsplit((parsed.scheme,parsed.netloc,parsed.path,'','')),'bytes':size,'computed_sha256':hashing.hexdigest(),'expected_checksum_checked':bool(expected)}


def extract(archive,target,maximum=20*1024**3):
    seen=set();size=0
    def destination(name,length,regular,directory):
        nonlocal size
        path=PurePosixPath(name)
        if not path.parts or path.is_absolute()or '..'in path.parts or '\\'in name or name in seen or not(regular or directory):raise ValueError('Unsafe publisher archive entry')
        seen.add(name);size+=length
        if len(seen)>60000 or size>maximum:raise ValueError('Publisher archive expansion exceeds limit')
        result=target.joinpath(*path.parts)
        if directory:result.mkdir(parents=True,exist_ok=True);return None
        result.parent.mkdir(parents=True,exist_ok=True);return result
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive)as source:
            for member in source.infolist():
                mode=stat.S_IFMT(member.external_attr>>16);path=destination(member.filename,member.file_size,mode in(0,stat.S_IFREG),member.is_dir())
                if path:
                    with source.open(member)as incoming,path.open('xb')as output:shutil.copyfileobj(incoming,output)
                    path.chmod(0o755 if(member.external_attr>>16)&0o111 else 0o644)
    else:
        with tarfile.open(archive,'r:*')as source:
            for member in source:
                path=destination(member.name,member.size,member.isfile(),member.isdir())
                if path:
                    with source.extractfile(member)as incoming,path.open('xb')as output:shutil.copyfileobj(incoming,output)
                    path.chmod(member.mode&0o755)


def payload_namespace(ready):
    for path in ready.iterdir():
        if path.name in('.voltra','.steam','.wine'):raise ValueError('Publisher payload cannot replace private helper, Steam or Wine namespaces')


def install_query(root,mode,enabled=True):
    target=confined(root,'mods/hytale-sourcequery.jar')
    disabled=confined(root,'.voltra/publisher/disabled-sourcequery.jar')
    if not enabled:
        if target.exists():
            if digest(target)!=QUERY['sha256']:raise ValueError('Existing custom SourceQuery cannot be disabled automatically; move it privately before removing its allocation')
            _publish(root,'.voltra/publisher/disabled-sourcequery.jar',lambda output:output.write(target.read_bytes()),0o600)
            if digest(target)!=QUERY['sha256']:raise ValueError('SourceQuery changed during disable')
            target.unlink()
        return
    if target.exists():
        if digest(target)!=QUERY['sha256']:raise ValueError('Existing SourceQuery differs from pinned release; preserve it and review compatibility before replacement')
        return
    if disabled.exists():
        if digest(disabled)!=QUERY['sha256']:raise ValueError('Preserved SourceQuery differs from pinned release')
        _publish(root,'mods/hytale-sourcequery.jar',lambda output:output.write(disabled.read_bytes()));return
    if mode=='operator':raise ValueError('Enabled SourceQuery requires the lawful pinned plugin in mods/hytale-sourcequery.jar')
    with tempfile.TemporaryDirectory(prefix='.query-',dir=root)as directory:
        asset=Path(directory)/'query.jar';download(QUERY['url'],asset,1024**2,QUERY['sha256'])
        if asset.stat().st_size!=QUERY['bytes']:raise ValueError('Pinned SourceQuery asset size mismatch')
        _publish(root,'mods/hytale-sourcequery.jar',lambda output:output.write(asset.read_bytes()))


def install(root,env):
    root=Path(root).resolve();kind,mode=selection(env)
    # Operator mode is an actual supported file handoff, never stub download
    # success. Runtime validates every required original publisher payload.
    if mode=='operator':return
    state=confined(root,'.voltra/publisher');state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='acquire-',dir=state)as temporary:
        stage=Path(temporary);asset=stage/'asset';ready=stage/'ready';ready.mkdir()
        if kind=='titans':
            report=download(URLS[kind],asset,64*1024**2)
            if asset.read_bytes()[:4]!=b'\x7fELF':raise ValueError('Original Alderon downloader is not a Linux executable')
            _publish(root,'AlderonGamesCmd-Linux',lambda output:output.write(asset.read_bytes()),0o555)
        elif kind=='hytale':
            report=download(URLS[kind],asset,128*1024**2);extract(asset,ready,256*1024**2)
            cli=ready/'hytale-downloader-linux-amd64'
            if not cli.is_file():raise ValueError('Original Hytale downloader Linux payload missing')
            _publish(root,'hytale-downloader/hytale-downloader-linux',lambda output:output.write(cli.read_bytes()),0o555)
        else:
            archive=env.get('OPERATOR_ARCHIVE','')
            if archive:
                source=confined(root,archive)
                if not source.is_file()or source.stat().st_size>4*1024**3:raise ValueError('Provide a lawful bounded HogWarp server archive inside this volume')
                shutil.copyfile(source,asset);report={'source':'operator archive','computed_sha256':digest(asset),'expected_checksum_checked':False}
            else:report=download(env.get('DOWNLOAD_URL',''),asset,4*1024**3)
            extract(asset,ready,8*1024**3)
            payload_namespace(ready)
            candidates=[ready/name for name in('HogWarpServer.exe','Server.Loader.exe')if(ready/name).is_file()]
            if len(candidates)!=1:raise ValueError('HogWarp archive requires exactly one original or current documented launcher at its root')
            receipt=confined(root,'.voltra/publisher/hogwarp-files.json');previous=json.loads(receipt.read_text())if receipt.exists()else{}
            with retain_operators(root,['config.json','plugins','data','saves']):files,preserved=apply_payload(root,'',ready,previous)
            payload=json.dumps({'files':files,'preserved_operator_files':preserved}).encode();_publish(root,'.voltra/publisher/hogwarp-files.json',lambda output:output.write(payload),0o600)
        _publish(root,'.voltra/publisher/'+kind+'-acquisition.json',lambda output:output.write(json.dumps(report).encode()),0o600)


if __name__=='__main__':install(Path.cwd(),dict(os.environ))
