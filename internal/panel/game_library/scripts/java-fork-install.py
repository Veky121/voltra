"""Official Java fork acquisition; shared Minecraft staging and pack preservation."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as XML
import zipfile
from minecraft_pack_install import target, publish, digest
from limbo_install import public_url, Redirects

PINS = json.loads(Path(__file__).with_name('java-fork-releases.json').read_text())
ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$')


def identifier(value):
    if not ID.fullmatch(value):
        raise ValueError('Choose a literal publisher version or build identifier')
    return value


def fetch(url, maximum=8*1024**2, auth=None):
    headers = {'User-Agent': 'Voltra-GameLibrary/1.0', 'Accept': 'application/json'}
    if auth:
        if urllib.parse.urlsplit(url).hostname != 'api.github.com':
            raise ValueError('GitHub credentials are restricted to the official API')
        headers['Authorization'] = auth
    class MetadataRedirects(Redirects):
        def redirect_request(self, req, fp, code, msg, response_headers, newurl):
            if auth and urllib.parse.urlsplit(newurl).hostname != 'api.github.com':
                raise ValueError('Credential-bearing metadata cannot redirect off the GitHub API')
            return super().redirect_request(req,fp,code,msg,response_headers,newurl)
    request = urllib.request.Request(public_url(url), headers=headers)
    with urllib.request.build_opener(MetadataRedirects()).open(request, timeout=90) as response:
        result = response.read(maximum+1)
    if len(result)>maximum:
        raise ValueError('Publisher metadata exceeds its size limit')
    return result


def metadata(url, auth=None):
    return json.loads(fetch(url,auth=auth))


def github_release(package, selected, match, auth=None):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',package):
        raise ValueError('Choose a GitHub owner/repository')
    suffix = 'latest' if not selected or selected=='latest' else 'tags/'+urllib.parse.quote(identifier(selected),safe='')
    release = metadata('https://api.github.com/repos/'+package+'/releases/'+suffix,auth)
    if not 1<=len(match)<=128:raise ValueError('GitHub MATCH must contain1..128characters')
    try: pattern=re.compile(match,re.I)
    except re.error as error:raise ValueError('Invalid GitHub asset MATCH pattern') from error
    assets = [row for row in release.get('assets',[])[:100] if len(row['name'])<=256 and pattern.search(row['name']) and row['name'].endswith('.jar')]
    if len(assets)!=1:
        raise ValueError('Publisher release must contain one matching server JAR')
    asset = assets[0]
    result={'version':release['tag_name'],'url':asset['browser_download_url'],'bytes':asset['size']}
    checksum=asset.get('digest') or ''
    if checksum.startswith('sha256:'):result['sha256']=checksum[7:]
    return result


def custom_url(template,env):
    def replace(match):
        name=match[1] or match[2]
        if name not in env:
            raise ValueError('Unknown custom download URL placeholder: '+name)
        return urllib.parse.quote(str(env[name]),safe='._-+')
    return public_url(re.sub(r'\{\{([A-Z0-9_]+)\}\}|\$\{([A-Z0-9_]+)\}',replace,template))


def mohist_release(project,game,selected):
    """Keep legacy numeric builds distinct from renumbered current API IDs."""
    rows=metadata('https://api.mohistmc.com/project/'+project+'/'+game+'/builds')
    if not isinstance(rows,list) or not rows:raise ValueError('No public publisher builds for this project/version')
    chosen=None
    if not selected:
        chosen=max(rows,key=lambda row:row['build_date'])
    elif selected.startswith('api:'):
        identifier(selected[4:])
        chosen=next((row for row in rows if str(row['id'])==selected[4:]),None)
    elif re.fullmatch('[0-9a-fA-F]{7,40}',selected) and not selected.isdigit():
        matches=[row for row in rows if row['commit']['hash'].startswith(selected.lower())]
        if len(matches)==1:chosen=matches[0]
    else:
        identifier(selected)
        legacy=metadata('https://mohistmc.com/api/v2/projects/'+project+'/'+game+'/builds').get('builds',[])
        old=next((row for row in legacy if str(row.get('number') or row.get('id'))==selected),None)
        if old:
            chosen=next((row for row in rows if row['commit']['hash']==old.get('gitSha')),None)
            if chosen is None:
                # Exact historic artifact remains exact; integrity errors never
                # trigger a newer build or unrelated implementation substitution.
                return {'version':selected,'url':old['url'],'sha256':old['fileSha256'],'java':8 if game=='1.12.2' else 17,'legacy_numeric_selector':selected}
    if chosen is None:raise ValueError('Requested exact build is unavailable. Legacy numbers are not reinterpreted as new API IDs; use api:ID or an exact commit')
    checksum=chosen.get('file_sha256','')
    if not re.fullmatch('[0-9a-f]{64}',checksum):raise ValueError('Publisher build needs a strong SHA256')
    return {'version':chosen['commit']['hash'],'url':'https://api.mohistmc.com/project/'+project+'/'+game+'/builds/'+str(chosen['id'])+'/download','sha256':checksum,'java':8 if game=='1.12.2' else 17,'api_id':chosen['id']}


def resolve(kind,env):
    if kind not in ('glowstone','krypton','magma','mohist','spongeforge'):
        raise ValueError('Unknown imported Java fork')
    if kind=='mohist' and env.get('DL_PATH','').strip():
        return {'version':'operator-custom','url':custom_url(env['DL_PATH'],env),'java':17,
                **({'sha256':env['DOWNLOAD_SHA256'].lower()} if env.get('DOWNLOAD_SHA256') else {})}
    if kind=='glowstone':
        selected=env.get('VERSION','latest') or 'latest'
        package=env.get('GITHUB_PACKAGE','GlowstoneMC/Glowstone')
        match=env.get('MATCH','glowstone.jar')
        user,token=env.get('GITHUB_USER',''),env.get('GITHUB_OAUTH_TOKEN','')
        if bool(user)!=bool(token):raise ValueError('Set both original GitHub user and OAuth token, or neither')
        auth='Basic '+base64.b64encode((user+':'+token).encode()).decode() if user else None
        if selected.endswith('SNAPSHOT'):
            identifier(selected)
            query=urllib.parse.urlencode({'group':'net.glowstone','name':'glowstone','sort':'version','repository':'snapshots','maven.baseVersion':selected,'direction':'desc','maven.classifier':''})
            return {'version':selected,'url':'https://repo.glowstone.net/service/rest/v1/search/assets/download?'+query,'java':8}
        if selected in ('latest',PINS[kind]['version']) and package=='GlowstoneMC/Glowstone' and match=='glowstone.jar':return dict(PINS[kind])
        return dict(github_release(package,selected,match,auth),java=8)
    if kind=='magma':
        game=identifier(env.get('MC_VERSION','1.20.1') or '1.20.1')
        selected=env.get('TAG_VERSION','latest') or 'latest'
        if game=='1.20.1' and selected in ('latest',PINS[kind]['version']):return dict(PINS[kind])
        return dict(github_release('magmamaintained/Magma-'+game,selected,'server.jar'),java=8 if game=='1.12.2' else 17)
    if kind=='mohist':
        project=env.get('PROJECT','mohist')
        if project not in ('mohist','banner'):raise ValueError('Choose original Mohist or Banner project')
        game=identifier(env.get('MC_VERSION','1.20.1'))
        selected=env.get('BUILD_NUMBER','').strip()
        if game=='1.20.1' and selected in ('',PINS[project]['version']):return dict(PINS[project])
        return mohist_release(project,game,selected)
    if kind=='krypton':
        selected=env.get('KRYPTON_VERSION','latest') or 'latest'
        distribution=env.get('KRYPTON_DISTRIBUTION','repaired_source')
        if distribution=='repaired_source':
            repair=PINS[kind]['repaired_source']
            if selected not in ('latest',repair['version'],repair['commit']):
                raise ValueError('Repaired source supports the pinned Minecraft1.19.3 revision only; choose publisher distribution for an original numeric CI build')
            return {'version':repair['version'],'java':17,'source_build':True,'variant':'repaired-source-v1'}
        if distribution!='publisher':raise ValueError('Choose explicit publisher or repaired_source Krypton distribution')
        if selected=='latest':raise ValueError(PINS[kind]['prerequisite'])
        if not selected.isascii() or not selected.isdigit():raise ValueError('Choose original numeric Krypton CI build or latest')
        base='https://ci.kryptonmc.org/job/Krypton/'+selected
        build=metadata(base+'/api/json?tree=artifacts%5BrelativePath%5D')
        artifacts=build.get('artifacts',[])
        if len(artifacts)!=1:raise ValueError('Krypton build needs one publisher server artifact')
        relative=artifacts[0]['relativePath']
        target(Path('/publisher'),relative)
        return {'version':selected,'url':base+'/artifact/'+urllib.parse.quote(relative,safe='/'),'java':17}
    selected=env.get('SF_MC_VERSION','1.20.6')
    if selected in ('1.20.6',PINS[kind]['version']):return dict(PINS[kind])
    identifier(selected)
    if '-' not in selected:
        raw=fetch('https://repo.spongepowered.org/repository/maven-releases/org/spongepowered/spongeforge/maven-metadata.xml')
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():raise ValueError('Unsupported Maven XML declarations')
        versions=[n.text for n in XML.fromstring(raw).findall('./versioning/versions/version') if n.text.startswith(selected+'-')]
        if not versions:raise ValueError('No SpongeForge release matches the requested Minecraft version')
        selected=next((v for v in reversed(versions) if not re.search(r'RC|BETA|SNAPSHOT',v)),versions[-1])
    game=selected.split('-',1)[0]
    legacy=tuple(int(x) for x in game.split('.'))<=(1,12,2)
    base='https://repo.spongepowered.org/repository/'+('legacy-transfer' if legacy else 'maven-releases')
    universal=tuple(int(x) for x in game.split('.'))>=(1,16,5)
    url=base+'/org/spongepowered/spongeforge/'+selected+'/spongeforge-'+selected+('-universal' if universal else '')+'.jar'
    return {'version':selected,'url':url,'java':21 if game=='1.20.6' else 17 if tuple(int(x) for x in game.split('.'))>=(1,18) else 8}


def jar_check(path, runnable=True):
    with zipfile.ZipFile(path) as archive:
        member=archive.getinfo('META-INF/MANIFEST.MF')
        if member.file_size>1024**2:raise ValueError('Server JAR manifest exceeds1MiB')
        manifest=archive.read(member).decode('utf-8')
        if runnable and not re.search(r'^Main-Class:\s*\S+',manifest,re.M):
            raise ValueError('Publisher artifact is not a runnable server JAR')


def acquire(release,path,root):
    checksum=release.get('sha256','')
    if checksum and not re.fullmatch('[0-9a-f]{64}',checksum):raise ValueError('Download SHA256 must contain64hex digits')
    cached=target(root,'.voltra/public-cache/'+checksum) if checksum else None
    if cached and cached.is_file():
        if digest(cached)!=checksum:raise ValueError('Public Java fork cache failed checksum validation')
        shutil.copyfile(cached,path)
    else:
        request=urllib.request.Request(public_url(release['url']),headers={'User-Agent':'Voltra-GameLibrary/1.0'})
        size=0
        with urllib.request.build_opener(Redirects()).open(request,timeout=120) as response,path.open('xb') as output:
            while block:=response.read(1024*1024):
                size+=len(block)
                if size>512*1024**2:raise ValueError('Fork download exceeds512MiB')
                output.write(block)
    if release.get('bytes') and path.stat().st_size!=release['bytes'] or checksum and digest(path)!=checksum:
        raise ValueError('Official Java fork download failed publisher checksum/size validation')
    return digest(path)


def install(kind,root,env):
    import minecraft_install as minecraft
    import modded_java_install as modded
    root=Path(root).resolve()
    jar=env.get('SERVER_JAR' if kind=='krypton' else 'SERVER_JARFILE','server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}\.jar',jar):raise ValueError('Choose a safe server JAR filename')
    existing=env.get('USE_EXISTING_JAR','false')
    if existing not in ('false','true'):raise ValueError('USE_EXISTING_JAR must be true or false')
    if existing=='true':
        if kind=='spongeforge' and target(root,'unix_args.txt').is_file():
            args=target(root,'unix_args.txt')
            if not 0<args.stat().st_size<=1024**2:raise ValueError('Existing Forge arguments must be nonempty and at most1MiB')
            return {'provider':kind,'source':'operator-owned existing Forge arguments; not a publisher acceptance claim','sha256':digest(args)}
        selected=target(root,jar)
        jar_check(selected)
        if kind=='krypton' and not target(root,'config.conf').exists():
            with zipfile.ZipFile(selected) as archive:
                member=archive.getinfo('config.conf')
                if member.file_size>1024**2:raise ValueError('Krypton config resource is oversized')
                target(root,'config.conf').write_bytes(archive.read(member))
        if kind=='glowstone' and not target(root,'config/glowstone.yml').is_file():
            raise ValueError('Upload matching config/glowstone.yml with an existing Glowstone JAR, or use official staged config generation')
        return {'provider':kind,'source':'operator-owned existing JAR; not a publisher acceptance claim','sha256':digest(selected)}
    release=resolve(kind,env)
    if release.get('available') is False:raise ValueError(release['prerequisite'])
    if kind=='spongeforge':
        mods=target(root,'mods')
        expected='spongeforge-'+release['version']+'.jar'
        if mods.exists() and any(p.name.lower().startswith('spongeforge-') and p.name!=expected for p in mods.glob('*.jar')):
            raise ValueError('Back up and remove the previous SpongeForge component before changing its version; operator mods are never deleted automatically')
    state=target(root,'.voltra/java-forks/work');state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=kind+'-',dir=state) as directory:
        work=Path(directory);ready=work/'server';ready.mkdir();download=work/'download.jar'
        source_provenance=None
        if release.get('source_build'):
            import krypton_source_build
            built,source_provenance=krypton_source_build.build(work/'source-build',root,ready,acquire)
            shutil.copy2(built,download);checksum=digest(download)
        else:
            checksum=acquire(release,download,root)
        jar_check(download,runnable=kind!='spongeforge')
        if kind=='spongeforge':
            version=release['version'];game,forge,*_=version.split('-')
            legacy={'1.12.2':'14.23.5.2838','1.12.1':'14.22.1.2480','1.11.2':'13.20.1.2476','1.10.2':'12.18.3.2477','1.9.4':'12.17.0.1968','1.8.9':'11.15.1.1890-1.8.9'}
            forge=legacy.get(game,forge)
            plan=modded.resolve('forge',{'MC_VERSION':game,'FORGE_VERSION':game+'-'+forge})
            release['java']=plan['java']
            os.environ.setdefault('MAX_PLAYERS','20');os.environ.setdefault('GAME_MODE','survival');os.environ.setdefault('DIFFICULTY','normal')
            minecraft.install(plan,ready,work_directory=state)
            (ready/'mods').mkdir(exist_ok=True);shutil.copy2(download,ready/'mods'/('spongeforge-'+version+'.jar'))
            if plan['launch'].startswith('@'):
                launch='unix_args.txt';shutil.copy2(target(ready,plan['launch'][1:]),ready/launch)
            else:
                launch=jar;shutil.copy2(target(ready,plan['launch'].removeprefix('-jar ')),ready/jar)
        else:
            shutil.copy2(download,ready/jar);launch=jar
            if kind=='magma' and checksum==PINS['magma']['sha256']:
                license=json.loads(Path(__file__).with_name('java-fork-licenses.json').read_text())['magma']
                if hashlib.sha256(license['text'].encode()).hexdigest()!=license['sha256']:
                    raise ValueError('Pinned publisher license text failed checksum validation')
                (ready/'licenses').mkdir()
                (ready/'licenses/Magma-LICENSE.txt').write_text(license['text'],encoding='utf-8')
            if kind=='glowstone':
                java_root=work/'java';java_root.mkdir();java=minecraft.bootstrap_java(release['java'],java_root)
                subprocess.run([java,'-jar',jar,'--generate-config'],cwd=ready,check=True,timeout=180)
                if not (ready/'config/glowstone.yml').is_file():raise ValueError('Glowstone did not generate its native configuration')
            if kind=='krypton':
                with zipfile.ZipFile(download) as archive:
                    config=archive.getinfo('config.conf')
                    if config.file_size>1024**2:raise ValueError('Krypton config resource is oversized')
                    (ready/'config.conf').write_bytes(archive.read(config))
        identity={'provider':kind,'version':release['version'],'sha256':checksum,'java':release['java']}
        if source_provenance:identity['source_build']=source_provenance
        return publish(ready,root,identity,launch)


if __name__=='__main__':
    import sys
    print(json.dumps(install(sys.argv[1],'/mnt/server',os.environ)))
