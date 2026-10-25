#!/usr/bin/env python3
"""MIT. Fixed reviewed Palworld loader acquisition and private bundle staging."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import urllib.parse
import urllib.request

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('managed_palworld_loader',HERE/'palworld-loader-install.py')
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
TOOLS='.voltra/palworld-loader-tools/'


def archive(root):
    manifest,_=loader.pins();pin=manifest['archive'];name='.voltra/public-cache/'+pin['sha256']
    existing=loader.read(root,name)
    if existing:
        data=existing[0]
        if len(data)!=pin['bytes'] or hashlib.sha256(data).hexdigest()!=pin['sha256']:
            raise ValueError('Pinned Palworld archive cache entry is corrupt; preserve it for review')
        return root/name
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,request,response,code,message,headers,url):
            target=urllib.parse.urlsplit(url)
            if target.scheme!='https' or target.username or target.password or target.hostname not in {'github.com','release-assets.githubusercontent.com','objects.githubusercontent.com','github-releases.githubusercontent.com'}:
                raise ValueError('Unreviewed Palworld archive redirect')
            return super().redirect_request(request,response,code,message,headers,url)
    source=urllib.parse.urlsplit(pin['url'])
    if source.scheme!='https' or source.hostname!='github.com' or source.username or source.password:
        raise ValueError('Pinned public Palworld archive source is invalid')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),Redirect())
    try:
        with opener.open(urllib.request.Request(pin['url'],headers={'User-Agent':'Voltra-public-loader/1'}),timeout=45) as response:
            length=response.headers.get('Content-Length')
            if length and int(length)!=pin['bytes']:raise ValueError('Pinned Palworld archive size mismatch')
            data=response.read(pin['bytes']+1)
    except ValueError:raise
    except Exception:raise ValueError('Pinned public Palworld archive could not be acquired; no game was launched') from None
    if len(data)!=pin['bytes'] or hashlib.sha256(data).hexdigest()!=pin['sha256']:
        raise ValueError('Pinned public Palworld archive size/SHA256 mismatch')
    loader.publish(root,name,data,0o444)
    verified=loader.read(root,name)
    if not verified or hashlib.sha256(verified[0]).hexdigest()!=pin['sha256']:
        raise ValueError('Pinned Palworld archive cache publication failed')
    return root/name


def bundle():
    record=json.loads((HERE/'bundle.json').read_bytes())
    if record.get('schema')!=1 or not isinstance(record.get('files'),dict):raise ValueError('Unsupported Palworld runtime bundle')
    for name,expected in record['files'].items():
        if '/' in name or '\\' in name or name in ('','.','..'):raise ValueError('Unsafe runtime bundle path')
        path=HERE/name
        if path.is_symlink() or not stat.S_ISREG(path.stat().st_mode):raise ValueError('Regular runtime bundle files required')
        if hashlib.sha256(path.read_bytes()).hexdigest()!=expected:raise ValueError('Runtime bundle checksum mismatch')
    return record


def publish_bundle(root):
    record=bundle();receipt=loader.read(root,TOOLS+'bundle.json')
    if receipt:
        previous=json.loads(receipt[0])
        if previous.get('files')!=record['files']:raise ValueError('Different private runtime bundle requires an explicit reviewed upgrade')
    for name,expected in record['files'].items():
        existing=loader.read(root,TOOLS+name)
        if existing:
            if hashlib.sha256(existing[0]).hexdigest()!=expected:raise ValueError('Private runtime bundle was modified: '+name)
        else:loader.publish(root,TOOLS+name,(HERE/name).read_bytes(),0o644)
    loader.publish(root,TOOLS+'bundle.json',(HERE/'bundle.json').read_bytes(),0o600)


def main():
    if sys.argv[1:] not in (['preflight'],['install'],['verify']):raise ValueError('Only fixed preflight/install/verify operations are supported')
    root=Path.cwd().absolute();manifest,pin_hash=loader.pins();operation=sys.argv[1]
    bundle()
    paths={}
    if operation=='preflight':
        loader.preflight(root,manifest,pin_hash)
        paths=loader.inventory(root)
    elif operation=='install':
        # Refuse conflicts before acquisition or any owned-volume writes.
        loader.preflight(root,manifest,pin_hash)
        loader.install(root,archive(root));publish_bundle(root);loader.verify(root)
    else:loader.verify(root)
    print(json.dumps({'operation':operation,'revision':manifest['revision'],'native_verified':False,**paths}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error) if isinstance(error,ValueError) else 'Palworld runtime operation failed; preserve its private state for review',file=sys.stderr)
        sys.exit(1)
