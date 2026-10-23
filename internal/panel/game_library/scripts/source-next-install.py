#!/usr/bin/env python3
"""MIT. Typed SourceCoop plugin assets, bounded extraction and operator preservation."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import tempfile
import urllib.parse
import urllib.request
import zipfile
from source_install import update

PINNED = {
 'mms-1148': {'url':'https://mms.alliedmods.net/mmsdrop/1.11/mmsource-1.11.0-git1148-linux.tar.gz','bytes':1859973,'sha256':'977607008ec94dd5fff6e5bc351fcf1610e2e9852ac61268fc798a6a1d282a2d'},
 'sm-6960': {'url':'https://sm.alliedmods.net/smdrop/1.11/sourcemod-1.11.0-git6960-linux.tar.gz','bytes':65600805,'sha256':'30c5a3bd48b21d488f04dc6ed1a7698b830c9d0385bde25f5ca182ce2f747b1c'},
 'mms-1155': {'url':'https://mms.alliedmods.net/mmsdrop/1.11/mmsource-1.11.0-git1155-linux.tar.gz','bytes':1839453,'sha256':'66666dceb5caea9a8c91da7a8efb35c422e0f2e478efdb5ea5123c43e969b673'},
 'sm-7163': {'url':'https://sm.alliedmods.net/smdrop/1.12/sourcemod-1.12.0-git7163-linux.tar.gz','bytes':68563004,'sha256':'56d6a396fae37412c602e86ed163c5e58a45d90b8ee7f3046929aebd2e3b6267'},
 'sourcecoop-v1.6': {'url':'https://github.com/ampreeT/SourceCoop/releases/download/v1.6/SourceCoop-1.6-bms.zip','bytes':1672925,'sha256':'eab5e1f49b21f2f61abc2689fb818cdc8a4672fac46830aff5a94784513b8b8e'},
}
HOSTS = ('github.com','api.github.com','mms.alliedmods.net','sm.alliedmods.net','beans.adastral.net')


def public_url(url, redirect=False):
    value=urllib.parse.urlsplit(url)
    signed=redirect and value.hostname in ('release-assets.githubusercontent.com','objects.githubusercontent.com')
    if value.scheme!='https' or value.username or value.password or value.fragment or value.hostname not in HOSTS and not signed or value.query and not signed:
        raise ValueError('Module asset must use its trusted public HTTPS publisher')
    return url


class Redirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,url):
        public_url(url,True)
        return super().redirect_request(request,fp,code,message,headers,url)


def download(record,target,maximum=256*1024**2):
    public_url(record['url']);digest=hashlib.sha256();total=0
    managed=next((p for p in target.parents if p.name=='.voltra'),None)
    cached=managed/'public-cache'/record['sha256'] if managed and record.get('sha256') else None
    if cached and cached.exists():
        if not cached.resolve().is_relative_to(managed.parent.resolve()) or cached.is_symlink() or not cached.is_file():raise ValueError('Module public cache escapes server volume')
        with cached.open('rb') as incoming,target.open('xb') as output:
            while True:
                block=incoming.read(1048576)
                if not block:break
                total+=len(block)
                if total>maximum:raise ValueError('Cached module asset exceeds size limit')
                output.write(block);digest.update(block)
        if digest.hexdigest()!=record['sha256'] or record.get('bytes') and total!=record['bytes']:raise ValueError('Cached module asset integrity mismatch')
        return {**record,'downloaded_bytes':total,'computed_sha256':digest.hexdigest(),'expected_checksum_checked':True,'public_cache_hit':True}
    opener=urllib.request.build_opener(Redirect())
    request=urllib.request.Request(record['url'],headers={'User-Agent':'Voltra-Source-Installer'})
    with opener.open(request,timeout=120) as incoming,target.open('xb') as output:
        while True:
            block=incoming.read(1048576)
            if not block:break
            total+=len(block)
            if total>maximum:raise ValueError('Module download exceeds its size limit')
            output.write(block);digest.update(block)
    actual=digest.hexdigest()
    if record.get('bytes') and total!=record['bytes']:raise ValueError('Module asset size mismatch')
    if record.get('sha256') and actual!=record['sha256']:raise ValueError('Module asset checksum mismatch')
    return {**record,'downloaded_bytes':total,'computed_sha256':actual,'expected_checksum_checked':bool(record.get('sha256'))}


def extract(archive,directory):
    """No links/devices, duplicate paths, traversal or unbounded expansion."""
    seen=set();total=0;selected=[]
    def target(name,size,kind):
        nonlocal total
        path=PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or '\\' in name or not path.parts or str(path) in seen or kind not in ('file','dir'):
            raise ValueError('Unsafe Source module archive entry')
        seen.add(str(path));total+=size
        if len(seen)>30000 or total>1024**3:raise ValueError('Source module archive expansion exceeds limit')
        # All three upstream distributions install only under the selected game.
        if path.parts[0] not in ('addons','cfg','materials','models','sound','scripts','resource'):
            raise ValueError('Unexpected Source module archive root')
        destination=directory.joinpath(*path.parts)
        if kind=='dir':destination.mkdir(parents=True,exist_ok=True);return None
        destination.parent.mkdir(parents=True,exist_ok=True);selected.append(str(path));return destination
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                mode=stat.S_IFMT(member.external_attr>>16)
                kind='dir' if member.is_dir() else 'file' if mode in (0,stat.S_IFREG) else 'link'
                destination=target(member.filename,member.file_size,kind)
                if destination:
                    with source.open(member) as incoming,destination.open('wb') as output:shutil.copyfileobj(incoming,output)
                    destination.chmod(0o644)
    else:
        with tarfile.open(archive,'r:*') as source:
            for member in source:
                destination=target(member.name,member.size,'dir' if member.isdir() else 'file' if member.isfile() else 'link')
                if destination:
                    with source.extractfile(member) as incoming,destination.open('wb') as output:shutil.copyfileobj(incoming,output)
                    destination.chmod(member.mode&0o755)
    if not selected:raise ValueError('Module archive has no files')
    return selected


def selection(env):
    version=env.get('VERSION','latest');match=env.get('MATCH','bms')
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,64}',version) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}',match):raise ValueError('Choose a SourceCoop release tag and asset keyword')
    mms=int(env.get('MMS_BUILD','1155'));sm=int(env.get('SM_BUILD','7163'))
    if not 1131<=mms<=99999 or not 6940<=sm<=99999:raise ValueError('Choose supported numeric module builds')
    series=env.get('SM_SERIES','auto')
    if series=='auto':series='1.12' if sm>=7000 else '1.11'
    if series not in ('1.11','1.12'):raise ValueError('Choose a supported SourceMod release series')
    sm_pin=PINNED.get('sm-'+str(sm),{})
    if '/'+series+'/' not in sm_pin.get('url',''):sm_pin={}
    records=[dict(PINNED.get('mms-'+str(mms),{'url':f'https://mms.alliedmods.net/mmsdrop/1.11/mmsource-1.11.0-git{mms}-linux.tar.gz'})),
             dict(sm_pin or {'url':f'https://sm.alliedmods.net/smdrop/{series}/sourcemod-{series}.0-git{sm}-linux.tar.gz'})]
    if sm==7163 and series!='1.12':raise ValueError('Reviewed SourceMod7163 requires release series1.12')
    if version in ('latest','v1.6') and match=='bms':records.append(dict(PINNED['sourcecoop-v1.6']))
    else:
        url='https://api.github.com/repos/ampreeT/SourceCoop/releases/'+('latest' if version=='latest' else 'tags/'+urllib.parse.quote(version,safe=''))
        with urllib.request.build_opener(Redirect()).open(urllib.request.Request(url,headers={'User-Agent':'Voltra-Source-Installer'}),timeout=30) as response:
            data=response.read(1024**2+1)
        if len(data)>1024**2:raise ValueError('SourceCoop release metadata exceeds limit')
        release=json.loads(data);assets=[a for a in release.get('assets',[]) if match.casefold() in a.get('name','').casefold() and a.get('name','').endswith('.zip')]
        if len(assets)!=1:raise ValueError('SourceCoop asset keyword must match exactly one ZIP release asset')
        asset=assets[0];record={'url':public_url(asset['browser_download_url']),'bytes':asset['size']}
        digest=asset.get('digest','') or ''
        if digest.startswith('sha256:') and re.fullmatch(r'[a-f0-9]{64}',digest[7:]):record['sha256']=digest[7:]
        records.append(record)
    for record,key in zip(records,('MMS_SHA256','SM_SHA256','SOURCECOOP_SHA256')):
        expected=env.get(key,'')
        if expected:
            if not re.fullmatch(r'[a-f0-9]{64}',expected):raise ValueError('Optional module checksum must be lowercase SHA256')
            if record.get('sha256') and record['sha256']!=expected:raise ValueError('Optional checksum differs from reviewed release')
            record['sha256']=expected
    return records


def apply_payload(root,game,ready,old):
    owner=root.stat();files={};preserved={}
    for source in sorted(ready.rglob('*')):
        if source.is_symlink():raise ValueError('Staged module links are unsupported')
        if not source.is_file():continue
        relative=source.relative_to(ready);target=root/game/relative
        if not target.resolve().is_relative_to(root):raise ValueError('Module installation target escapes server volume')
        if target.is_symlink() and not target.is_file():raise ValueError('Module target has a broken symbolic link')
        prior=old.get('files',{}).get(str(relative))
        configuration=any(p in ('cfg','config','configs','savedata') for p in relative.parts[:-1]) or source.suffix.lower() in ('.cfg','.ini','.vdf') or source.name=='gameinfo.txt'
        if target.exists():
            current=hashlib.sha256(target.read_bytes()).hexdigest()
            if target.is_symlink() or configuration or not prior or current!=prior:
                preserved[str(relative)]=current
                if prior:files[str(relative)]=prior
                continue
        target.parent.mkdir(parents=True,exist_ok=True);os.chown(source,owner.st_uid,owner.st_gid);os.replace(source,target)
        files[str(relative)]=hashlib.sha256(target.read_bytes()).hexdigest()
    return files,preserved


def install(root,env):
    root=Path(root).resolve();state=root/'.voltra/source-next'
    if not state.resolve().is_relative_to(root):raise ValueError('Module state escapes server volume')
    records=selection(env);state.mkdir(parents=True,exist_ok=True)
    owner=root.stat();manifest=state/'sourcecoop.json'
    if not manifest.resolve().is_relative_to(root):raise ValueError('Module receipt escapes server volume')
    old=json.loads(manifest.read_text()) if manifest.exists() else {}
    with tempfile.TemporaryDirectory(prefix='install-',dir=state) as temporary:
        stage=Path(temporary);ready=stage/'ready';ready.mkdir();receipts=[]
        for index,record in enumerate(records):
            archive=stage/(str(index)+'.archive');receipts.append(download(record,archive));extract(archive,ready)
        # Download/extract all plugin assets before touching publisher data.
        update(root,346680,env=env,required=('srcds_run',))
        files,preserved=apply_payload(root,'bms',ready,old)
        for required in ('addons/metamod.vdf','addons/sourcemod/plugins/srccoop.smx'):
            if not (root/'bms'/required).is_file():raise ValueError('SourceCoop required module missing')
        report={'assets':receipts,'files':files,'preserved_operator_files':preserved,'provenance':'Trusted upstream releases. computed_sha256 records downloaded bytes; expected_checksum_checked identifies independent reviewed/API pins.'}
        descriptor,name=tempfile.mkstemp(prefix='.receipt-',dir=state)
        try:
            with os.fdopen(descriptor,'w') as output:json.dump(report,output,indent=2);output.write('\n')
            os.chown(name,owner.st_uid,owner.st_gid);os.replace(name,manifest)
        finally:
            if os.path.exists(name):os.unlink(name)


if __name__=='__main__':install(Path.cwd(),dict(os.environ))
