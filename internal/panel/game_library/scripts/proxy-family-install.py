#!/usr/bin/env python3
"""MIT integration. Verified native proxy jars through the shared Java backend."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import sys
import urllib.parse
import zipfile
from limbo_install import fetch, confined, write

PINNED=json.loads(Path(__file__).with_name('proxy-family-releases.json').read_text())

def metadata(url):return json.loads(fetch(url,8*1024**2))

def custom_url(template,game,version,build,jar):
    for key,value in {'PROJECT':game,'MINECRAFT_VERSION':version,'VELOCITY_VERSION':version,'BUILD_NUMBER':build,'SERVER_JARFILE':jar}.items():
        for pattern in ['{{'+key+'}}','${'+key+'}']:template=template.replace(pattern,urllib.parse.quote(value,safe=''))
    if '{{' in template or '${' in template:raise ValueError('Unknown proxy URL placeholder')
    return template

def select_release(game,env,jar):
    if game not in PINNED:raise ValueError('Unknown proxy family')
    pinned=PINNED[game]
    version=env.get('VELOCITY_VERSION' if game=='velocity' else 'WATERDOG_VERSION' if game=='waterdog' else 'MINECRAFT_VERSION','latest')
    build=env.get('BUILD_NUMBER','latest')
    custom=env.get('DL_PATH','') or env.get('DL_LINK','')
    checksum=env.get('DOWNLOAD_SHA256','').lower()
    if checksum and not re.fullmatch('[0-9a-f]{64}',checksum):raise ValueError('Invalid custom SHA256')
    if custom:
        if not checksum:raise ValueError('Custom proxy jar requires reviewed DOWNLOAD_SHA256')
        return {'version':version,'build':build,'url':custom_url(custom,game,version,build,jar),'sha256':checksum}
    if game=='viaaas':return dict(pinned)
    if game=='waterdog':
        if version in ['latest',pinned['build']]:return dict(pinned)
        if not re.fullmatch('[0-9]{1,12}',version):raise ValueError('WATERDOG_VERSION must be latest or an exact original Jenkins build')
        if not checksum:raise ValueError('Historical Jenkins build requires trusted DOWNLOAD_SHA256; no silent substitution')
        return {'version':version,'build':version,'url':'https://jenkins.waterdog.dev/job/Waterdog/job/WaterdogPE/job/release/'+version+'/artifact/target/Waterdog.jar','sha256':checksum}
    if version=='latest':version=pinned['version']
    if version==pinned['version'] and build in ['latest',pinned['build']]:return dict(pinned)
    if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,63}',version) or (build!='latest' and not re.fullmatch('[0-9]{1,12}',build)):raise ValueError('Invalid exact proxy version/build')
    base='https://fill.papermc.io/v3/projects/'+game+'/versions/'+version+'/builds'
    if build=='latest':
        rows=metadata(base);rows=[r for r in rows if r.get('channel')=='STABLE'] or rows
        if not rows:raise ValueError('No published proxy build')
        row=max(rows,key=lambda r:int(r['id']))
    else:row=metadata(base+'/'+build)
    if build!='latest' and str(row['id'])!=build:raise ValueError('Publisher returned another build')
    a=row.get('downloads',{}).get('server:default') or row.get('downloads',{}).get('application')
    if not a or not re.fullmatch('[0-9a-f]{64}',a.get('checksums',{}).get('sha256','')):raise ValueError('Publisher checksum missing')
    return {'version':version,'build':str(row['id']),'url':a['url'],'sha256':a['checksums']['sha256'],'modules':row['downloads']}

def jar_info(data):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        info=package.getinfo('META-INF/MANIFEST.MF')
        if info.file_size>65536:raise ValueError('Proxy manifest too large')
        manifest=re.sub(r'\r?\n ','',package.read(info).decode())
        match=re.search(r'^Main-Class: ([^\r\n]+)',manifest,re.M)
        if not match:raise ValueError('Proxy jar has no executable main class')
        main=match[1].strip();header=package.read(main.replace('.','/')+'.class')[:8]
        if header[:4]!=bytes.fromhex('cafebabe') or int.from_bytes(header[6:8],'big')>69:raise ValueError('Proxy requires an unsupported Java version')
        return main,int.from_bytes(header[6:8],'big')

def verified(root,identity):
    digest=identity['sha256'];cache=confined(root,'.voltra/proxy-family/cache/'+digest)
    if cache.is_file() and hashlib.sha256(cache.read_bytes()).hexdigest()==digest:return cache.read_bytes()
    data=fetch(identity['url'],256*1024**2)
    if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Publisher proxy checksum mismatch')
    write(cache,data);return data

def seed_config(root,game,data):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        if game=='velocity':
            path=confined(root,'velocity.toml')
            if not path.exists():write(path,package.read('default-velocity.toml'))
            secret=confined(root,'forwarding.secret')
            if not secret.exists():write(secret,secrets.token_urlsafe(32).encode());secret.chmod(0o600)
        elif game=='viaaas':
            path=confined(root,'config/viaaas.yml')
            if not path.exists():write(path,package.read('viaaas.yml'));path.chmod(0o600)
        else:
            path=confined(root,'config.yml')
            if path.exists():return
            if game=='waterdog':
                config={'listener':{'host':'0.0.0.0:19132','transport':'both','motd':'Voltra WaterdogPE','sub_motd':'WaterdogPE Proxy','priorities':[],'max_players':20},'servers':{},'nethernet':{'webrtc_port':19133,'signaling':{'mode':'builtin','stun_discovery':False}},'default_idle_threads':2}
            else:
                config={'listeners':[{'host':'0.0.0.0:25565','motd':'Voltra '+game,'max_players':20,'query_enabled':False,'query_port':25565,'priorities':['lobby'],'tab_list':'GLOBAL_PING','force_default_server':False,'bind_local_address':True,'ping_passthrough':False}], 'servers':{'lobby':{'address':'127.0.0.1:25566','motd':'Operator backend','restricted':False}},'online_mode':True,'ip_forward':False,'player_limit':-1,'connection_throttle':4000,'permissions':{},'groups':{}}
            write(path,(json.dumps(config,indent=2)+'\n').encode())

def install(root,game,env):
    root=Path(root).resolve();jar=env.get('SERVER_JARFILE','server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\.jar',jar):raise ValueError('Use a confined jar filename ending .jar')
    release=select_release(game,env,jar);target=confined(root,jar);receipt=confined(root,'.voltra/proxy-family/release.json')
    data=verified(root,release);main,major=jar_info(data)
    write(target,data);seed_config(root,game,data)
    if game in ['waterfall','travertine']:
        for key,asset in release.get('modules',{}).items():
            if not key.startswith('module:'):continue
            name=key[7:]
            if not re.fullmatch('[a-z0-9_]+',name):raise ValueError('Unsafe publisher module name')
            path=confined(root,'modules/'+name+'.jar')
            if not path.exists():write(path,verified(root,{'url':asset['url'],'sha256':asset['checksums']['sha256']}))
    value={**release,'url':urllib.parse.urlsplit(release['url'])._replace(query='').geturl(),'main_class':main,'class_major':major}
    write(receipt,(json.dumps(value,indent=2)+'\n').encode())
    print('Verified '+game+' proxy jar installed; native configurations/plugins/secrets retained.')

if __name__=='__main__':install(Path.cwd(),sys.argv[1],os.environ)
