"""Build Spigot locally with official BuildTools; never redistribute a server jar."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.parse
import minecraft_install as minecraft
from limbo_install import confined, write
from modded_java_install import PINS, fetch, identifier, metadata, publish


def download_url(template,version):
    for token in ('{{DL_VERSION}}','${DL_VERSION}'):template=template.replace(token,urllib.parse.quote(version,safe=''))
    if '{{' in template or '${' in template:raise ValueError('Only the DL_VERSION download placeholder is supported')
    return template


def install(root,env):
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True)
    pinned=PINS['spigot'];version=(env.get('DL_VERSION') or pinned['version']).strip()
    if version=='latest':version=pinned['version']
    identifier(version)
    jar=env.get('SERVER_JARFILE','server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\.jar',jar):raise ValueError('Choose a safe server JAR filename')
    target=minecraft.safe_target(root,jar);custom=(env.get('DL_PATH') or '').strip()
    source=None
    if custom:
        url=download_url(custom,version);expected=(env.get('DOWNLOAD_SHA256') or '').strip().lower()
        if expected and not re.fullmatch('[0-9a-f]{64}',expected):raise ValueError('Custom SHA256 must contain 64 hex digits')
        raw=fetch(url,512*1024**2)
        if expected and hashlib.sha256(raw).hexdigest()!=expected:raise ValueError('Custom server JAR checksum mismatch')
        origin='administrator custom download'
    else:
        address='https://hub.spigotmc.org/versions/'+version+'.json';source=metadata(address)
        if version==pinned['version'] and source!=pinned['source']:raise ValueError('Reviewed Spigot source identity changed; select a reviewed release')
        previous_path=confined(root,'.voltra/spigot/release.json')
        if previous_path.is_file() and target.is_file():
            previous=json.loads(previous_path.read_text())
            if previous.get('source')==source and previous.get('buildtools')==pinned['buildtools'] and previous.get('jar')==jar and previous.get('sha256')==hashlib.sha256(target.read_bytes()).hexdigest():
                print(json.dumps({'minecraft':version,'origin':'verified existing official source build cache','sha256':previous['sha256'],'eula':'operator choice preserved'}));return
        majors=source.get('javaVersions',[])
        if len(majors)!=2 or not all(isinstance(x,int) for x in majors):raise ValueError('Spigot did not declare its build Java requirements')
        major=majors[0]-44
        if major not in (8,11,16,17,21,25):raise ValueError('This Spigot release requires an unavailable build Java version')
        build_root=confined(root,'.voltra/spigot-build');build_root.mkdir(parents=True,exist_ok=True)
        tool=confined(root,'.voltra/spigot-build/BuildTools.jar');tool_raw=fetch(pinned['buildtools']['url'],32*1024**2)
        if hashlib.sha256(tool_raw).hexdigest()!=pinned['buildtools']['hash']:raise ValueError('Official BuildTools checksum mismatch')
        write(tool,tool_raw)
        work_root=confined(root,'.voltra/spigot-build/work');work_root.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='voltra-spigot-java-',dir=work_root) as directory:
            java=minecraft.bootstrap_java(major,Path(directory))
            output=Path(directory)/'output';output.mkdir()
            memory=int(env.get('SERVER_MEMORY','4096'))
            subprocess.run([java,'-Xmx'+str(max(1024,min(memory,4096)))+'M','-jar',str(tool),'--rev',version,'--compile','SPIGOT','--output-dir',str(output),'--final-name','server.jar','--nogui'],cwd=build_root,check=True,timeout=3600)
            candidate=output/'server.jar'
            if not candidate.is_file() or candidate.is_symlink():raise ValueError('Official BuildTools did not produce the requested server JAR')
            if candidate.stat().st_size>512*1024**2:raise ValueError('Built server exceeds its size limit')
            raw=candidate.read_bytes()
        if metadata(address)!=source:raise ValueError('Publisher source identity changed during the build; previous server retained')
        origin='official BuildTools local source build'
    # A download/build must finish and pass archive validation before replacing
    # any existing operator program. The final write preserves mode and owner.
    import io,zipfile
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        manifest=archive.getinfo('META-INF/MANIFEST.MF')
        if manifest.file_size>64*1024:raise ValueError('Server JAR manifest is oversized')
        if b'Main-Class:' not in archive.read(manifest):raise ValueError('Server JAR has no executable main class')
    receipt={'project':'spigot','minecraft':version,'origin':origin,'jar':jar,'sha256':hashlib.sha256(raw).hexdigest(),'source':source,'buildtools':None if custom else pinned['buildtools']}
    with tempfile.TemporaryDirectory(prefix='voltra-spigot-publish-') as directory:
        staging=Path(directory);(staging/jar).write_bytes(raw)
        record=staging/'.voltra/spigot/release.json';record.parent.mkdir(parents=True);record.write_text(json.dumps(receipt,sort_keys=True)+'\n')
        publish(staging,root,jar)
    properties=minecraft.safe_target(root,'server.properties')
    if not properties.exists():write(properties,b'server-ip=0.0.0.0\nserver-port=25565\nonline-mode=true\nmax-players=20\nmotd=A Minecraft server\n')
    print(json.dumps({'minecraft':version,'origin':origin,'sha256':receipt['sha256'],'eula':'operator choice preserved'}))


if __name__=='__main__':install('/mnt/server',os.environ)
