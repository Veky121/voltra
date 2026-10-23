#!/usr/bin/env python3
"""MIT. Paper/Folia/Purpur recipes using the existing Minecraft and asset helpers."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request
import zipfile
import minecraft_install as minecraft
from limbo_install import public_url, Redirects, confined, write

PINNED=json.loads(Path(__file__).with_name('paper-family-releases.json').read_text())


def fetch(url,maximum=512*1024**2):
    request=urllib.request.Request(public_url(url),headers={'User-Agent':minecraft.AGENT})
    with urllib.request.build_opener(Redirects()).open(request,timeout=120) as response:data=response.read(maximum+1)
    if len(data)>maximum:raise ValueError('Publisher download exceeds its size limit')
    return data


def metadata(url):return json.loads(fetch(url,8*1024**2))


def custom_url(template,project,version,build,jar):
    values={'PROJECT':project,'MINECRAFT_VERSION':version,'BUILD_NUMBER':build,'SERVER_JARFILE':jar}
    for key,value in values.items():
        for placeholder in ('{{'+key+'}}','${'+key+'}'):
            template=template.replace(placeholder,urllib.parse.quote(value,safe=''))
    if '{{' in template or '${' in template:raise ValueError('Unknown download URL placeholder; only project/version/build/jar settings are supported')
    return template


def select_release(project,env,jar):
    if project not in PINNED:raise ValueError('Unknown Paper family project')
    pinned=PINNED[project]
    version=env.get('MINECRAFT_VERSION','latest').strip() or 'latest'
    build=env.get('BUILD_NUMBER','latest').strip() or 'latest'
    custom=env.get('DL_PATH','').strip()
    if custom:
        expected=env.get('DOWNLOAD_SHA256','').strip().lower()
        if expected and not re.fullmatch('[0-9a-f]{64}',expected):raise ValueError('Custom SHA256 must contain 64 hex digits')
        return {'project':project,'version':version,'build':build,'url':custom_url(custom,project,version,build,jar),'algorithm':'sha256','hash':expected,'sha256':expected,'channel':'OPERATOR_CUSTOM'}
    if version=='latest':version=pinned['version']
    if version==pinned['version'] and build in ('latest',pinned['build']):return dict(pinned)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}',version) or (build!='latest' and not re.fullmatch('[0-9]{1,12}',build)):
        raise ValueError('Choose an exact Minecraft version and build number, or latest')
    base=('https://api.purpurmc.org/v2/purpur/' if project=='purpur' else 'https://fill.papermc.io/v3/projects/'+project+'/versions/')+version
    if project=='purpur':
        row=metadata(base+'/'+build)
        if row.get('result')!='SUCCESS':raise ValueError('The requested Purpur build is not successful')
        actual=str(row['build']);digest=row.get('md5','')
        if row.get('version')!=version or (build!='latest' and actual!=build):raise ValueError('Purpur returned a different version or build')
        if not re.fullmatch('[0-9a-f]{32}',digest):raise ValueError('Purpur did not provide its publisher checksum')
        return {'project':project,'version':version,'build':actual,'url':base+'/'+actual+'/download','algorithm':'md5','hash':digest,'sha256':'','channel':'SUCCESS'}
    if build=='latest':
        rows=metadata(base+'/builds')
        candidates=[row for row in rows if row.get('channel')=='STABLE'] or rows
        if not candidates:raise ValueError('No builds exist for this Minecraft version')
        row=max(candidates,key=lambda entry:int(entry['id']))
    else:row=metadata(base+'/builds/'+build)
    if build!='latest' and str(row['id'])!=build:raise ValueError('PaperMC returned a different build')
    download=row.get('downloads',{}).get('server:default',{})
    digest=download.get('checksums',{}).get('sha256','')
    if not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('PaperMC did not provide its publisher SHA256')
    if urllib.parse.urlsplit(download.get('url','')).hostname!='fill-data.papermc.io':raise ValueError('Unexpected PaperMC download host')
    return {'project':project,'version':version,'build':str(row['id']),'url':download['url'],'algorithm':'sha256','hash':digest,'sha256':digest,'channel':row.get('channel','UNKNOWN')}


def inspect_jar(data):
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        manifest=package.getinfo('META-INF/MANIFEST.MF')
        if manifest.file_size>65536:raise ValueError('Executable jar manifest is too large')
        text=re.sub(r'\r?\n ','',package.read(manifest).decode('utf-8'))
        match=re.search(r'^Main-Class: ([^\r\n]+)',text,re.M)
        if not match:raise ValueError('Download has no executable main class')
        main=match[1].strip()
        with package.open(main.replace('.','/')+'.class') as source:header=source.read(8)
        if len(header)!=8 or header[:4]!=bytes.fromhex('cafebabe'):raise ValueError('Executable main class is invalid')
        major=int.from_bytes(header[6:8],'big')
        if major>69:raise ValueError('This jar requires a Java runtime newer than Java25')
        return main,major


def install(root,project,env):
    root=Path(root).resolve()
    jar=env.get('SERVER_JARFILE','server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\.jar',jar):raise ValueError('Choose a jar filename within this volume')
    target=minecraft.safe_target(root,jar)
    release=select_release(project,env,jar)
    cache=confined(root,'.voltra/paper-family/download.jar')
    expected=release.get('sha256','')
    if expected and cache.is_file() and hashlib.sha256(cache.read_bytes()).hexdigest()==expected:data=cache.read_bytes()
    elif release['algorithm']=='sha256' and release['hash'] and minecraft.allowed_url(release['url']):
        data=minecraft.verified({'url':release['url'],'algorithm':'sha256','hash':release['hash']})
    else:data=fetch(release['url'])
    if release['hash'] and hashlib.new(release['algorithm'],data).hexdigest()!=release['hash']:raise ValueError('Publisher server jar checksum mismatch')
    digest=hashlib.sha256(data).hexdigest()
    if expected and digest!=expected:raise ValueError('Pinned server jar SHA256 mismatch')
    main,major=inspect_jar(data)
    # Preflight every managed path before publishing program files. Native data,
    # plugins, EULA and operator JVM args are intentionally never rewritten here.
    properties=minecraft.safe_target(root,'server.properties')
    receipt=confined(root,'.voltra/paper-family/release.json')
    write(cache,data);write(target,data)
    if not properties.exists():write(properties,b'server-ip=0.0.0.0\nserver-port=25565\nquery.port=25565\nonline-mode=true\nenable-query=false\nmax-players=20\nmotd=A Minecraft server\n')
    source=urllib.parse.urlsplit(release['url'])._replace(query='').geturl()
    value={**release,'url':source,'sha256':digest,'publisher_checksum_available':bool(release['hash']),'bootstrap_main_class':main,'bootstrap_class_major':major}
    write(receipt,(json.dumps(value,sort_keys=True,indent=2)+'\n').encode())
    print('Verified '+project+' server installed; native worlds/configuration/plugins/EULA retained.')


if __name__=='__main__':
    import sys
    install(Path.cwd(),sys.argv[1],os.environ)
