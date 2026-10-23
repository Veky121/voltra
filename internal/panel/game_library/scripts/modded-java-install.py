"""Original catalog controls adapted to the shared verified Minecraft installer."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import urllib.request
import xml.etree.ElementTree as XML
import minecraft_install as minecraft
from limbo_install import public_url, Redirects, confined, write

PINS=json.loads(Path(__file__).with_name('modded-java-releases.json').read_text())
ID=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._+\-]{0,127}$')


def identifier(value):
    if not ID.fullmatch(value):raise ValueError('Choose an exact publisher version, or a supported latest/snapshot alias')
    return value


def fetch(url,maximum=8*1024**2):
    request=urllib.request.Request(public_url(url),headers={'User-Agent':minecraft.AGENT})
    with urllib.request.build_opener(Redirects()).open(request,timeout=120) as response:data=response.read(maximum+1)
    if len(data)>maximum:raise ValueError('Publisher metadata exceeds its size limit')
    return data


def metadata(url):return json.loads(fetch(url))


def checked_maven(url):
    digest=fetch(url+'.sha1',4096).decode('ascii').strip().split()[0].lower()
    if not re.fullmatch('[0-9a-f]{40}',digest):raise ValueError('Publisher installer checksum is missing')
    return {'url':url,'hash':digest,'algorithm':'sha1','path':'.voltra-installer.jar'}


def game_release(version):
    manifest=metadata('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    if version in ('latest','snapshot'):version=manifest['latest']['release' if version=='latest' else 'snapshot']
    identifier(version)
    found=next((row for row in manifest['versions'] if row['id']==version),None)
    if not found:raise ValueError('Minecraft version is not in the official manifest')
    raw=fetch(found['url'])
    if hashlib.sha1(raw).hexdigest()!=found['sha1']:raise ValueError('Minecraft metadata checksum mismatch')
    release=json.loads(raw)
    if release['id']!=version:raise ValueError('Minecraft returned a different release')
    major=release.get('javaVersion',{}).get('majorVersion')
    if major is None:
        parts=tuple(int(x) for x in version.split('.')) if re.fullmatch(r'1\.[0-9]+(?:\.[0-9]+)?',version) else ()
        if not parts:raise ValueError('This release does not declare its Java requirement')
        major=21 if parts>=(1,20,5) else 17 if parts>=(1,18) else 16 if parts>=(1,17) else 8
    server=release['downloads']['server']
    return version,major,{'url':server['url'],'hash':server['sha1'],'algorithm':'sha1','path':'server.jar'}


def neo_game(selected):
    identifier(selected)
    if selected.startswith('1.20.1-'):return '1.20.1'
    base=selected.split('-',1)[0].split('.')
    if not all(x.isdigit() for x in base):raise ValueError('NeoForge version does not identify its Minecraft release')
    values=[int(x) for x in base]
    if len(values)==4 and values[0]>=26:return '.'.join(base[:2]+([] if values[2]==0 else [base[2]]))
    if len(values)==3 and 20<=values[0]<=25:return '1.'+base[0]+('' if values[1]==0 else '.'+base[1])
    raise ValueError('NeoForge version does not identify its Minecraft release')


def choose(rows,selected,version_key='version',stable=lambda x:x.get('stable',False)):
    if selected in ('latest','snapshot'):
        rows=[row for row in rows if stable(row)==(selected=='latest')]
        if not rows:raise ValueError('No publisher release matches this channel')
        return rows[0]
    identifier(selected)
    found=next((row for row in rows if row[version_key]==selected),None)
    if found is None:raise ValueError('The exact requested publisher version is unavailable')
    return found


def resolve(loader,env):
    if loader not in ('fabric','quilt','forge','neoforge'):raise ValueError('Unknown modded loader')
    pinned=copy.deepcopy(PINS[loader]);requested=(env.get('MC_VERSION') or pinned['version']).strip()
    selected=(env.get('LOADER_VERSION') or 'latest').strip()
    installer_version=((env.get('FABRIC_VERSION') if loader=='fabric' else env.get('QUILT_INSTALLER_VERSION')) or 'latest').strip()
    explicit=(env.get('FORGE_VERSION') if loader=='forge' else env.get('NEOFORGE_VERSION') if loader=='neoforge' else '') or ''
    explicit=explicit.strip()
    if loader=='forge' and env.get('BUILD_TYPE','recommended') not in ('recommended','latest'):raise ValueError('Forge Build Type must be recommended or latest')
    if loader=='forge' and explicit:
        identifier(explicit)
        if '-' not in explicit:raise ValueError('Forge Version must include the Minecraft prefix, for example 1.20.1-47.4.0')
        requested,selected=explicit.split('-',1)
    elif loader=='neoforge' and explicit:requested,selected=neo_game(explicit),explicit
    if requested=='latest':requested=pinned['version']
    pinned_selected=selected in ('latest',pinned['loader_version'])
    if loader=='forge':pinned_selected=not explicit or explicit==pinned['version']+'-'+pinned['loader_version']
    if loader=='neoforge':pinned_selected=not explicit or explicit==pinned['loader_version']
    if requested==pinned['version'] and pinned_selected and installer_version in ('latest',pinned['installer_version']):return pinned
    version,major,vanilla=game_release(requested)
    plan={'loader':loader,'version':version,'java':major,'files':[vanilla]}
    if loader in ('fabric','quilt'):
        base='https://meta.fabricmc.net/v2' if loader=='fabric' else 'https://meta.quiltmc.org/v3'
        loaders=[row['loader'] for row in metadata(base+'/versions/loader/'+identifier(version))]
        release=choose(loaders,selected,stable=lambda x:x.get('stable',not re.search('alpha|beta|rc',x['version'])))
        installers=metadata(base+'/versions/installer')
        installer=choose(installers,installer_version,stable=lambda x:x.get('stable',True))
        plan.update(loader_version=release['version'],installer_version=installer['version'],installer=checked_maven(installer['url']),launch='-jar '+loader+'-server-launch.jar')
        if loader=='quilt':plan['java']=max(17,major)
    else:
        if loader=='forge':
            if not explicit:
                build=env.get('BUILD_TYPE','recommended')
                if build not in ('recommended','latest'):raise ValueError('Forge Build Type must be recommended or latest')
                promos=metadata('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')['promos']
                selected=promos.get(version+'-'+build) or (promos.get(version+'-latest') if build=='recommended' else None)
                if not selected:raise ValueError('No Forge promotion exists for the requested Minecraft release')
            full=version+'-'+identifier(selected)
            if version in ('1.7.10','1.8.9') and not full.endswith('-'+version):full+='-'+version
            namespace='net/minecraftforge/forge';artifact='forge'
        else:
            namespace='net/neoforged/'+('forge' if version=='1.20.1' else 'neoforge');artifact=namespace.rsplit('/',1)[1]
            if not explicit:
                raw=fetch('https://maven.neoforged.net/releases/'+namespace+'/maven-metadata.xml')
                if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ValueError('Unsupported Maven XML declarations')
                candidates=[node.text for node in XML.fromstring(raw).findall('./versioning/versions/version')]
                matches=[]
                for candidate in reversed(candidates):
                    try:
                        if neo_game(candidate)==version:matches.append(candidate)
                    except ValueError:pass
                if not matches:raise ValueError('No NeoForge build exists for the requested Minecraft release')
                selected=next((x for x in matches if not re.search('alpha|beta|rc',x)),matches[0])
            full=identifier(selected)
        base='https://maven.minecraftforge.net/' if loader=='forge' else 'https://maven.neoforged.net/releases/'
        plan.update(loader_version=selected,installer_version='',installer=checked_maven(base+namespace+'/'+full+'/'+artifact+'-'+full+'-installer.jar'),launch='@libraries/'+namespace+'/'+full+'/unix_args.txt')
        if loader=='forge' and major<=8:plan['launch']='-jar .voltra-forge-server.jar'
    return plan


def publish(staging,root,launch):
    """Prevalidate all writes and restore original program files after any failure."""
    staging=Path(staging);root=Path(root).resolve();prepared=[]
    protected={'eula.txt','server.properties','user_jvm_args.txt','run.sh','run.bat'}
    for source in staging.rglob('*'):
        if source.is_symlink():raise ValueError('Installer generated a symlink')
        if not source.is_file():continue
        relative=source.relative_to(staging).as_posix()
        if relative in protected or relative.split('/')[0] in minecraft.CONTENT or relative.split('/')[0].startswith('world'):continue
        target=confined(root,relative) if relative.startswith('.voltra/') else minecraft.safe_target(root,relative)
        if target.exists() and not target.is_file():raise ValueError('Program target is not a regular file')
        prepared.append((source,target))
    prepared.sort(key=lambda pair:pair[1].relative_to(root).as_posix()==launch)
    backup_parent=confined(root,'.voltra/modded-java/rollback');backup_parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='program-',dir=backup_parent) as directory:
        changed=[]
        try:
            for index,(source,target) in enumerate(prepared):
                backup=Path(directory)/str(index)
                if target.exists():shutil.copy2(target,backup);old=target.stat();os.chown(backup,old.st_uid,old.st_gid)
                else:backup=None
                changed.append((target,backup))
                write(target,source.read_bytes())
        except BaseException:
            for target,backup in reversed(changed):
                if backup is None:target.unlink(missing_ok=True)
                else:os.replace(backup,target)
            raise
    return len(prepared)


def install(loader,root,env):
    plan=resolve(loader,env);root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True)
    jar=env.get('SERVER_JARFILE','server.jar');minecraft.safe_name(jar)
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\.jar',jar):raise ValueError('Choose a safe server JAR filename')
    fingerprint=hashlib.sha256((json.dumps(plan,sort_keys=True)+jar).encode()).hexdigest()
    existing=confined(root,'.voltra/modded-java/release.json')
    if existing.is_file():
        previous=json.loads(existing.read_text())
        if previous.get('plan_fingerprint')==fingerprint:
            valid=True
            for name,digest in previous.get('files',{}).items():
                path=minecraft.safe_target(root,name)
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:valid=False;break
            if valid and previous.get('files'):
                print(json.dumps({'loader':loader,'minecraft':plan['version'],'loader_version':plan['loader_version'],'verified_program_cache_hit':True,'eula':'operator choice preserved'}));return
    work_root=confined(root,'.voltra/modded-java/work');work_root.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='voltra-modded-program-',dir=work_root) as directory:
        staging=Path(directory)
        # Use the shared provider-verified Java/loader/archive implementation.
        os.environ.setdefault('MAX_PLAYERS','20');os.environ.setdefault('GAME_MODE','survival');os.environ.setdefault('DIFFICULTY','normal')
        minecraft.install(plan,staging,work_directory=work_root)
        if loader in ('fabric','quilt'):
            (staging/'server.jar').rename(staging/'minecraft-server.jar')
            (staging/(loader+'-server-launch.jar')).rename(staging/jar)
            (staging/(loader+'-server-launcher.properties')).write_text('serverJar=minecraft-server.jar\n',encoding='utf8')
            launch=jar
        elif plan['launch'].startswith('-jar '):
            (staging/plan['launch'][5:]).rename(staging/jar);launch=jar
        else:
            shutil.copyfile(staging/plan['launch'][1:],staging/'unix_args.txt');launch='unix_args.txt'
        release={key:value for key,value in plan.items() if key not in ('files',)}
        release['program_launch']=launch
        release['plan_fingerprint']=fingerprint
        release['files']={p.relative_to(staging).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in staging.rglob('*') if p.is_file() and p.name not in ('eula.txt','server.properties','user_jvm_args.txt','run.sh','run.bat') and p.relative_to(staging).parts[0] not in minecraft.CONTENT}
        receipt=staging/'.voltra/modded-java/release.json';receipt.parent.mkdir(parents=True);receipt.write_text(json.dumps(release,sort_keys=True)+'\n')
        count=publish(staging,root,launch)
        properties=minecraft.safe_target(root,'server.properties')
        if not properties.exists():write(properties,b'server-ip=0.0.0.0\nserver-port=25565\nonline-mode=true\nmax-players=20\nmotd=A Minecraft server\n')
    print(json.dumps({'loader':loader,'minecraft':plan['version'],'loader_version':plan['loader_version'],'java':plan['java'],'program_files':count,'eula':'operator choice preserved'}))


if __name__=='__main__':
    import sys
    install(sys.argv[1],'/mnt/server',os.environ)
