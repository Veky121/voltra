#!/usr/bin/env python3
"""MIT. Typed Bedrock-family installation and native console launchers."""
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from additional_survival_install import private_bytes
from native_console import run


def load(name, filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


release=load('bedrock_release','native-release.py')
publisher=load('bedrock_publisher','small-native-install.py')
java=load('bedrock_java','java-games-install.py')
PINNED=json.loads(Path(__file__).with_name('bedrock-family-releases.json').read_text())
GAMES=('bds','bds_arm','nukkit','pnx','pocketmine','gomint')


def inside(root, relative):
    path=root/relative
    if path.is_symlink() or not path.resolve().is_relative_to(root):raise ValueError('Bedrock managed path escapes volume')
    return path


def write(path, content):
    old=path.stat() if path.exists() else None
    if path.exists() and path.read_bytes()==content:return
    private_bytes(path,content,old)
    if old is None:path.chmod(0o644)


def single(value, maximum=256):
    if len(value.encode())>maximum or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Bedrock values must fit a single line')
    return value


def number(value, minimum, maximum):
    if not re.fullmatch(r'[0-9]+',value) or not minimum<=int(value)<=maximum:raise ValueError('Invalid Bedrock numeric control')
    return int(value)


def properties(content, values):
    newline='\r\n' if '\r\n' in content else '\n';seen=set();out=[]
    for line in content.splitlines():
        match=re.match(r'^\s*([^#!\s=:]+)\s*[=:]',line)
        if match and match[1] in values:
            key=match[1]
            if key in seen or line.endswith('\\'):raise ValueError('Ambiguous managed Bedrock property')
            seen.add(key);line=key+'='+single(str(values[key]))
        out.append(line)
    out.extend(key+'='+single(str(value)) for key,value in values.items() if key not in seen)
    return newline.join(out)+newline


def get(url, maximum=4*1024**2):
    if not url.startswith('https://'):raise ValueError('Publisher requires HTTPS')
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 Voltra Bedrock installer'}),timeout=90) as response:
        if not response.url.startswith('https://'):raise ValueError('Publisher redirected outside HTTPS')
        data=response.read(maximum+1)
    if len(data)>maximum:raise ValueError('Publisher response exceeds bound')
    return data


def recorded(url, version, cache):
    import hashlib
    data=get(url,512*1024**2);digest=hashlib.sha256(data).hexdigest();cache.mkdir(parents=True,exist_ok=True)
    target=cache/digest
    if target.is_symlink():raise ValueError('Cache cannot be a symlink')
    if target.exists() and release.sha256(target)!=digest:raise ValueError('Publisher cache mismatch')
    if not target.exists():write(target,data)
    return dict(url=url,version=version,sha256=digest,bytes=len(data),identity='Recorded SHA256 from operator-selected official HTTPS')


def selected(game,env,cache):
    if game in ('bds','bds_arm'):
        version=env.get('BEDROCK_VERSION','latest')
        if version==PINNED['bds']['version']:return dict(PINNED['bds'])
        if version=='latest':
            metadata=json.loads(get('https://net-secondary.web.minecraft-services.net/api/v1.0/download/links'))
            url=next(x['downloadUrl'] for x in metadata['result']['links'] if x['downloadType']=='serverBedrockLinux')
            if url==PINNED['bds']['url']:return dict(PINNED['bds'])
            match=re.fullmatch(r'https://www\.minecraft\.net/bedrockdedicatedserver/bin-linux/bedrock-server-([0-9.]+)\.zip',url)
            if not match:raise ValueError('Unexpected official BDS download URL')
            version=match[1]
        elif not re.fullmatch(r'[0-9]+(?:\.[0-9]+){2,3}',version):raise ValueError('Invalid BDS version')
        else:url='https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-'+version+'.zip'
        return recorded(url,version,cache)
    if game=='nukkit':
        version=env.get('NUKKIT_VERSION','latest')
        if not version:return None
        if version=='latest':
            metadata=ET.fromstring(get('https://repo.opencollab.dev/maven-snapshots/cn/nukkit/nukkit/1.0-SNAPSHOT/maven-metadata.xml'))
            version=next(s.findtext('value') for s in metadata.findall('./versioning/snapshotVersions/snapshotVersion') if s.findtext('extension')=='jar' and s.find('classifier') is None)
        if version==PINNED['nukkit']['version']:return dict(PINNED['nukkit'])
        if not re.fullmatch(r'[A-Za-z0-9_.-]{1,50}',version):raise ValueError('Invalid Nukkit snapshot')
        return recorded('https://repo.opencollab.dev/maven-snapshots/cn/nukkit/nukkit/1.0-SNAPSHOT/nukkit-'+version+'.jar',version,cache)
    if game=='pocketmine':
        channel=env.get('VERSION','PM5')
        if channel not in ('PM4','PM5'):raise ValueError('PocketMine channel must be PM4 or PM5')
        if channel=='PM4':return dict(PINNED['pm4'])
        metadata=json.loads(get('https://api.github.com/repos/pmmp/PocketMine-MP/releases/latest'))
        if metadata['tag_name']==PINNED['pm5']['version']:return dict(PINNED['pm5'])
        if not re.fullmatch(r'5\.[0-9]+\.[0-9]+',metadata['tag_name']):raise ValueError('Publisher latest is outside original PocketMine PM5 channel')
        asset=next(a for a in metadata['assets'] if a['name']=='PocketMine-MP.phar')
        info=json.loads(get(next(a['browser_download_url'] for a in metadata['assets'] if a['name']=='build_info.json')))
        if info.get('php_version')!='8.2':raise ValueError('New PocketMine release requires a newly reviewed matching PHP runtime')
        digest=asset.get('digest','') or ''
        if re.fullmatch(r'sha256:[a-f0-9]{64}',digest):return dict(url=asset['browser_download_url'],version=metadata['tag_name'],sha256=digest[7:],bytes=asset['size'],identity='Publisher GitHub asset SHA256')
        return recorded(asset['browser_download_url'],metadata['tag_name'],cache)
    if game=='gomint':return dict(PINNED['gomint'])
    if game=='pnx':
        version=env.get('VERSION','latest')
        if version==PINNED['pnx']['version']:return dict(PINNED['pnx'])
        if version not in ('latest','dev'):raise ValueError('PowerNukkitX channel must be latest or dev')
        if version=='latest':candidate=json.loads(get('https://api.github.com/repos/PowerNukkitX/PowerNukkitX/releases/latest'))
        else:
            metadata=json.loads(get('https://api.github.com/repos/PowerNukkitX/PowerNukkitX/releases'))
            candidate=next((r for r in metadata if r.get('prerelease') and any(a['name']=='powernukkitx.jar' for a in r['assets'])),None)
        if not candidate:raise ValueError('Publisher has no current dev release asset; choose latest or provide a reviewed development build')
        if candidate['tag_name']==PINNED['pnx']['version']:return dict(PINNED['pnx'])
        asset=next(a for a in candidate['assets'] if a['name']=='powernukkitx.jar');digest=asset.get('digest','') or ''
        if not re.fullmatch(r'sha256:[a-f0-9]{64}',digest):return recorded(asset['browser_download_url'],candidate['tag_name'],cache)
        return dict(url=asset['browser_download_url'],version=candidate['tag_name'],sha256=digest[7:],bytes=asset['size'],identity='Publisher GitHub asset SHA256')
    raise ValueError('Unknown Bedrock engine')


def require_terms(game,env):
    if game in ('bds','bds_arm') and env.get('BEDROCK_TERMS_ACCEPTED')!='true':raise ValueError('Operator must accept Minecraft EULA and Usage Guidelines before installing or starting BDS: https://www.minecraft.net/eula')


def jar_name(env):
    value=env.get('SERVER_JARFILE','server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+\.jar',value):raise ValueError('Invalid server JAR filename')
    return value


def php_extract(archive,target):
    links=[]
    with tarfile.open(archive,'r:gz') as package:
        members=package.getmembers()
        if len(members)>20000 or sum(m.size for m in members)>1024**3:raise ValueError('PHP archive exceeds bounds')
        seen=set()
        for member in members:
            if member.name in seen:raise ValueError('Duplicate PHP archive member')
            seen.add(member.name);relative=java.member_path(member.name);destination=target/relative
            if not destination.resolve().is_relative_to(target):raise ValueError('PHP archive escapes staging')
            if member.isdir():destination.mkdir(parents=True,exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True,exist_ok=True)
                with package.extractfile(member) as source,destination.open('xb') as out:shutil.copyfileobj(source,out)
                destination.chmod(member.mode&0o777)
            elif member.issym():
                source=destination.parent/member.linkname
                if Path(member.linkname).is_absolute() or not source.resolve().is_relative_to(target):raise ValueError('PHP library link escapes staging')
                links.append((destination,source))
            else:raise ValueError('Unsupported PHP archive member')
        # Resolve only confined publisher file aliases; publish independent files.
        for _ in range(len(links)+1):
            pending=[]
            for destination,source in links:
                if source.is_file():destination.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,destination)
                else:pending.append((destination,source))
            links=pending
            if not links:break
        if links:raise ValueError('Unresolved PHP archive alias')


def java_identity(machine=None):
    machine=platform.machine() if machine is None else machine
    if machine in ('aarch64','arm64'):return PINNED['java21_arm']
    if machine in ('x86_64','amd64'):return java.JAVA21
    raise ValueError('Java Bedrock runtime requires x64 or ARM64')


def install(root,game,env):
    root=Path(root).resolve();require_terms(game,env)
    if game not in GAMES:raise ValueError('Unknown Bedrock engine')
    if game=='bds_arm' and platform.machine() not in ('aarch64','arm64'):raise ValueError('Original ARM64 recipe requires an ARM64 host and box64; x64 testing does not validate ARM emulation')
    cache=inside(root,'.voltra/public-cache');identity=selected(game,env,cache);state=inside(root,'.voltra/'+game);state.mkdir(parents=True,exist_ok=True)
    if game in ('nukkit','pnx','gomint'):
        # Reuse the reviewed Java21 installer unchanged. Its private download
        # directory receives an independent integrity-checked public-cache copy.
        selected_java=java_identity()
        cached=cache/selected_java['sha256'];destination=inside(root,'.voltra/java-game/downloads/'+selected_java['sha256'])
        if cached.is_file() and not destination.exists():
            if release.sha256(cached)!=selected_java['sha256']:raise ValueError('Java cache mismatch')
            destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(cached,destination)
        java.java_runtime(root,selected_java,'java21')
    if identity is None:
        if not inside(root,jar_name(env)).is_file():raise ValueError('Blank NUKKIT_VERSION requires an operator-uploaded JAR')
        write(state/'release.json',json.dumps({'game':game,'version':'operator-uploaded','sha256':release.sha256(root/jar_name(env))}).encode());return
    with tempfile.TemporaryDirectory(prefix='.install-',dir=state) as temporary:
        stage=Path(temporary);archive=stage/'publisher';release.download(identity,archive);ready=stage/'ready';ready.mkdir()
        if game in ('bds','bds_arm','gomint'):
            publisher.extract_zip(archive,ready)
            binary='bedrock_server' if game.startswith('bds') else 'modules/gomint.server.jar'
            if game=='gomint':
                if (ready/'modules/modules').is_dir():
                    source=ready/'modules/modules';flat=stage/'flat';shutil.move(source,flat);shutil.rmtree(ready);flat.rename(ready)
                elif (ready/'modules').is_dir():
                    source=ready/'modules';flat=stage/'flat';shutil.move(source,flat);shutil.rmtree(ready);flat.rename(ready)
                # Publisher module filename is discovered without changing its module contract.
                modules=inside(root,'modules');modules.mkdir(exist_ok=True)
                jars=list(ready.glob('*.jar'))
                if not jars:raise ValueError('GoMint distribution has no modules')
                publisher.publish(root,ready,modules,dict(identity,game=game),jars[0].name)
            else:
                if not (ready/binary).is_file():raise ValueError('BDS executable missing')
                (ready/binary).chmod(0o755)
                # BDS worlds/config/plugins are always retained, even on first adoption.
                for name in ('server.properties','permissions.json','allowlist.json','whitelist.json','worlds','config','plugins'):
                    path=ready/name
                    if (root/name).exists() and path.exists():
                        if path.is_dir():shutil.rmtree(path)
                        else:path.unlink()
                publisher.publish(root,ready,root,dict(identity,game=game),binary)
        elif game in ('nukkit','pnx'):
            name=jar_name(env) if game=='nukkit' else 'powernukkitx.jar';shutil.copyfile(archive,ready/name)
            publisher.publish(root,ready,root,dict(identity,game=game),name)
        else:
            channel=env.get('VERSION','PM5');arm=platform.machine() in ('aarch64','arm64')
            if arm:
                compiler=load('bedrock_php_arm','bedrock-php-arm.py')
                source=inside(root,'.voltra/pocketmine-arm-'+channel.lower());source.mkdir(exist_ok=True)
                php=compiler.build(source,channel,PINNED['pm4_compile' if channel=='PM4' else 'pm5_compile'],release.download)
                shutil.copytree(source/'bin',ready/'bin')
                shutil.copyfile(source/'arm-build-receipt.json',ready/'pocketmine-arm-build.json')
            else:
                if platform.machine() not in ('x86_64','amd64'):raise ValueError('PocketMine requires x64 or ARM64')
                php=PINNED['php4' if channel=='PM4' else 'php5'];php_archive=stage/'php.tar.gz';release.download(php,php_archive)
                php_extract(php_archive,ready)
            if not (ready/'bin/php7/bin/php').is_file():raise ValueError('PocketMine PHP runtime missing')
            (ready/'bin/php7/bin/php').chmod(0o755)
            shutil.copyfile(archive,ready/'PocketMine-MP.phar')
            publisher.publish(root,ready,root,dict(identity,game=game,php=php),'PocketMine-MP.phar')
    configure(root,game,env)


def configure(root,game,env):
    port=number(env.get('SERVER_PORT','19132'),1,65535)
    if game=='pnx':
        path=inside(root,'pnx.yml')
        # JSON is a YAML subset. Create only the absent initial native config;
        # subsequent edits use Wings' existing full YAML parser and retain all
        # publisher/operator settings instead of implementing a partial parser.
        if not path.exists():write(path,(json.dumps({'settings':{'ip':'0.0.0.0','port':port,'motd':single(env.get('SERVERNAME','PowerNukkitX Server'),100)},'network-settings':{'enableQuery':True}},indent=2)+'\n').encode())
        return port
    values={'server-port':str(port),'server-ip':'0.0.0.0'}
    if game in ('bds','bds_arm'):
        transport=env.get('BEDROCK_TRANSPORT','nethernet')
        if transport not in ('raknet','nethernet'):raise ValueError('Invalid BDS transport')
        allocated=[number(value.strip(),1,65535) for value in env.get('VOLTRA_ALLOCATED_PORTS',str(port)).split(',')]
        if port not in allocated:raise ValueError('BDS primary port is not allocated')
        ipv6=port
        if transport=='raknet':
            secondary=env.get('SERVER_PORT_V6','0')
            if secondary=='0':secondary=next((str(p) for p in allocated if p!=port),None)
            if secondary is None:raise ValueError('RakNet needs a second distinct allocated IPv6 port')
            ipv6=number(secondary,1,65535)
            if ipv6==port or ipv6 not in allocated:raise ValueError('BDS IPv6 port must be a distinct allocation')
        values.update({'server-name':single(env.get('SERVERNAME','Bedrock Dedicated Server'),100),'gamemode':env.get('GAMEMODE','survival'),'difficulty':env.get('DIFFICULTY','easy'),'allow-cheats':env.get('CHEATS','false'),'enable-lan-visibility':'false','server-portv6':str(ipv6),'emit-server-telemetry':'false','online-mode':env.get('ONLINE_MODE','true')})
        advertised=env.get('BEDROCK_ADVERTISED_ADDRESS','')
        if advertised:
            address=ipaddress.ip_address(advertised)
            advertised=('['+str(address)+']') if address.version==6 else str(address)
        values.update({'transport':transport,'server-udp-ports':(advertised+':' if advertised else '')+str(port)+':'+str(port)})
        if values['gamemode'] not in ('survival','creative','adventure') or values['difficulty'] not in ('peaceful','easy','normal','hard') or values['allow-cheats'] not in ('true','false') or values['online-mode'] not in ('true','false'):raise ValueError('Invalid BDS game control')
        if game=='bds_arm':values['max-threads']='2'
    else:values.update({'query.port':str(port),'enable-query':'on' if game in ('nukkit','pnx','pocketmine') else 'true','motd':single(env.get('SERVERNAME','Voltra Bedrock Server'),100)})
    if game=='pocketmine':
        ipv6=number(env.get('SERVER_PORT_V6','0'),0,65535)
        values['enable-ipv6']='on' if ipv6 else 'off'
        if ipv6:
            allocated=[number(value.strip(),1,65535) for value in env.get('VOLTRA_ALLOCATED_PORTS',str(port)).split(',')]
            if ipv6==port or ipv6 not in allocated:raise ValueError('PocketMine IPv6 port must be a distinct allocation')
            values['server-portv6']=str(ipv6)
    path=inside(root,'server.properties')
    if game!='gomint':
        previous=path.read_bytes().decode('utf-8') if path.exists() else ''
        write(path,properties(previous,values).encode())
    else:
        path=inside(root,'server.yml')
        # Retain the original Wings YAML parser/path mapping for GoMint rather
        # than replacing full YAML support with a handwritten text parser.
        if not path.exists():write(path,('listener:\n  ip: 0.0.0.0\n  port: '+str(port)+'\n').encode())
    return port


def launch(root,game,env):
    if game=='pnx' and env.get('PNX_LICENSE_ACCEPTED','false')!='true':raise ValueError('Read PowerNukkitX LGPLv3 https://www.gnu.org/licenses/lgpl-3.0.html and explicitly set PNX_LICENSE_ACCEPTED=true before startup')
    root=Path(root).resolve();require_terms(game,env);configure(root,game,env)
    child=dict(env);child['HOME']=str(root);child['LD_LIBRARY_PATH']=':'.join([str(root),str(root/'bin/php7/lib'),str(root/'.voltra/runtime-libs')]);child['TERM']='dumb'
    if game.startswith('bds'):
        args=[str(root/'bedrock_server')]
        if game=='bds_arm':
            if platform.machine() not in ('aarch64','arm64') or not shutil.which('box64'):raise ValueError('ARM64 recipe needs ARM64 box64 runtime')
            args=['box64',*args]
    elif game in ('nukkit','pnx','gomint'):
        memory=number(env.get('SERVER_MEMORY','2048'),256,1048576)
        args=[str(root/'.voltra/java21/bin/java'),'-Xms128M','-Xmx'+str(max(128,memory-256))+'M','-Djava.awt.headless=true']
        if game=='gomint':args+=['--add-opens','java.base/java.nio=io.netty.common','--add-exports','java.base/jdk.internal.misc=io.netty.common','-p','modules','-m','gomint.server/io.gomint.server.Bootstrap']
        else:args+=['-jar',jar_name(env) if game=='nukkit' else 'powernukkitx.jar','--language','eng']
        if game=='pnx':args+=['--accept-license','--skip-setup','--port',str(number(env.get('SERVER_PORT','19132'),1,65535)),'--server-name',single(env.get('SERVERNAME','PowerNukkitX Server'),100)]
        if game=='pnx' and env.get('AUTOREBOOT','') not in ('','-r'):raise ValueError('Invalid original AUTOREBOOT control')
    else:
        php=root/'bin/php7/bin/php';ini=root/'.voltra/pocketmine/php.ini';ini.parent.mkdir(parents=True,exist_ok=True)
        extensions=list((root/'bin/php7/lib/php/extensions').glob('*'))
        if len(extensions)!=1:raise ValueError('Unexpected PocketMine PHP extension layout')
        write(ini,('extension_dir="'+str(extensions[0])+'"\nzend_extension=opcache.so\n').encode())
        # PocketMine's console reader launches PHP_BINARY without the parent's
        # -c argument. Inherit the confined runtime ini in every native PHP child.
        child['PHPRC']=str(ini);child['PHP_INI_SCAN_DIR']=''
        args=[str(php),'-c',str(ini),str(root/'PocketMine-MP.phar'),'--no-wizard','--disable-ansi']
    if game=='pnx' and env.get('AUTOREBOOT','')=='-r':
        policy=load('bedrock_restart','native-restart-policy.py')
        return policy.run_restarting(dict(root=root,argv=args,environment=child,stop_command='stop',terminal_input=True,terminal_query_reply=True))
    code=run(root,args,child,'stop',terminal_input=True,terminal_query_reply=True)
    return code


if __name__=='__main__':
    action,game=sys.argv[1:3]
    if action=='install':install(Path.cwd(),game,os.environ)
    elif action=='run':sys.exit(launch(Path.cwd(),game,os.environ))
    else:raise ValueError('Unknown Bedrock operation')
