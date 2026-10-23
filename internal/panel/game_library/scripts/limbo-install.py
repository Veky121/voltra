#!/usr/bin/env python3
"""MIT. Verified standalone Limbo releases for the existing managed Java runtime."""
import hashlib
import io
import ipaddress
import json
import os
from pathlib import Path
import re
import socket
import stat
import tempfile
import urllib.parse
import urllib.request
import zipfile

RELEASES = {
    'limbo': {'version':'2026.0.3-ALPHA-26.3-b76', 'url':'https://ci.loohpjames.com/job/Limbo/76/artifact/target/Limbo-2026.0.3-ALPHA-26.3.jar', 'sha256':'a2de91fcaa2255aed8a111b8786f370213423c7798eee778c00d016d83aa65d2'},
    'nano-limbo': {'version':'v1.13.0', 'url':'https://github.com/Nan1t/NanoLimbo/releases/download/v1.13.0/NanoLimbo.jar', 'sha256':'884dc3d4941fb0964dfd348cebc66afb692b156a213cc980d6f47f02441432cf'},
}


def public_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment or parsed.port not in (None,443):
        raise ValueError('Download URL must be a public HTTPS URL without credentials')
    addresses = socket.getaddrinfo(parsed.hostname,443,type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise ValueError('Download host must resolve to public addresses')
    return url


class Redirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        return super().redirect_request(req,fp,code,msg,headers,public_url(newurl))


def fetch(url, maximum=64*1024**2):
    request = urllib.request.Request(public_url(url),headers={'User-Agent':'Voltra-GameLibrary/1.0'})
    with urllib.request.build_opener(Redirects()).open(request,timeout=90) as response:
        data = response.read(maximum+1)
    if len(data)>maximum:raise ValueError('Limbo download exceeds its size limit')
    return data


def confined(root,name):
    target=root/name
    if not target.resolve().is_relative_to(root):raise ValueError('Installation path leaves this volume')
    return target


def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    previous=path.stat() if path.exists() else None
    if path.is_file() and path.read_bytes()==data:return
    fd,tmp=tempfile.mkstemp(prefix='.limbo-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as output:output.write(data)
        os.chmod(tmp,stat.S_IMODE(previous.st_mode) if previous else 0o644)
        if previous:os.chown(tmp,previous.st_uid,previous.st_gid)
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def select_release(kind,env):
    release=dict(RELEASES[kind])
    if kind=='nano-limbo':
        custom=env.get('DOWNLOAD_URL','').strip()
        version=env.get('VERSION','latest').strip()
        if custom:
            expected=env.get('DOWNLOAD_SHA256','').strip().lower()
            if expected and not re.fullmatch('[0-9a-f]{64}',expected):raise ValueError('Custom SHA256 must contain 64 hex digits')
            return {'version':'operator-custom','url':custom,'sha256':expected}
        if version not in ('latest','v1.13.0','1.13.0'):
            if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',version):raise ValueError('Invalid NanoLimbo version')
            metadata=json.loads(fetch('https://api.github.com/repos/Nan1t/NanoLimbo/releases/tags/'+version,1024**2))
            assets=[asset for asset in metadata.get('assets',[]) if asset['name'].endswith('.jar') and 'sources' not in asset['name'].lower()]
            if len(assets)!=1:raise ValueError('Choose a release with exactly one executable jar asset')
            digest=assets[0].get('digest') or ''
            release={'version':version,'url':assets[0]['browser_download_url'],'sha256':digest.removeprefix('sha256:') if digest.startswith('sha256:') else ''}
    return release


def inspect_jar(data,kind):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        if package.getinfo('META-INF/MANIFEST.MF').file_size>65536:raise ValueError('Jar manifest exceeds its size limit')
        manifest=package.read('META-INF/MANIFEST.MF').decode('utf-8')
        manifest=re.sub(r'\r?\n ','',manifest)
        match=re.search(r'^Main-Class: ([^\r\n]+)',manifest,re.M)
        if not match:raise ValueError('Download is not an executable jar')
        main=match[1].strip()
        with package.open(main.replace('.','/')+'.class') as source:header=source.read(8)
        if header[:4]!=bytes.fromhex('cafebabe') or int.from_bytes(header[6:8],'big')>69:
            raise ValueError('This jar exceeds the available Java25 runtime; choose a compatible release')
        name='server.properties' if kind=='limbo' else 'settings.yml'
        config=package.getinfo(name)
        if config.file_size>1024**2:raise ValueError('Default configuration exceeds its size limit')
        return name,package.read(config),main,int.from_bytes(header[6:8],'big')


def install(root,kind,env):
    root=Path(root).resolve()
    if kind not in RELEASES:raise ValueError('Unknown standalone limbo profile')
    jar=env.get('SERVER_JARFILE','Limbo.jar' if kind=='limbo' else 'server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,120}\.jar',jar):raise ValueError('Choose a jar filename within this volume')
    target=confined(root,jar)
    release=select_release(kind,env)
    cache=confined(root,'.voltra/limbo/download.jar')
    data=cache.read_bytes() if release['sha256'] and cache.is_file() and hashlib.sha256(cache.read_bytes()).hexdigest()==release['sha256'] else fetch(release['url'])
    actual=hashlib.sha256(data).hexdigest()
    if release['sha256'] and actual!=release['sha256']:raise ValueError('Server jar checksum mismatch')
    name,config,main,major=inspect_jar(data,kind)
    config_path=confined(root,name)
    write(cache,data)
    write(target,data)
    if not config_path.exists():write(config_path,config)
    # Operator download URLs may carry signed query credentials. The hash is
    # sufficient provenance; never publish those credentials in a receipt.
    public_source=urllib.parse.urlsplit(release['url'])._replace(query='').geturl()
    receipt={**release,'url':public_source,'sha256':actual,'expected_checksum_available':bool(release['sha256']),'main_class':main,'class_major':major}
    write(confined(root,'.voltra/limbo/release.json'),(json.dumps(receipt,sort_keys=True,indent=2)+'\n').encode())
    print('Verified '+kind+' installation complete; existing native configuration retained.')


if __name__=='__main__':
    import sys
    install(Path.cwd(),sys.argv[1],os.environ)
