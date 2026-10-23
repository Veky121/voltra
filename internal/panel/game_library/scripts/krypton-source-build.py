"""Explicit repaired Krypton source acquisition, never a publisher binary fallback."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import subprocess
import tarfile
import zipfile
from minecraft_pack_install import digest, target

RECIPE = json.loads(Path(__file__).with_name('krypton-source-releases.json').read_text())


def name(value):
    path = PurePosixPath(value)
    if not value or value.startswith('/') or '\\' in value or ':' in value or any(p in ('','.','..') for p in value.rstrip('/').split('/')) or not path.parts:
        raise ValueError('Unsafe source archive path')
    return path


def unpack_zip(archive, destination, maximum=512*1024**2):
    """Validate every entry before writing, including entries outside the root."""
    destination = Path(destination)
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries)>100000 or sum(row.file_size for row in entries)>maximum:
            raise ValueError('Source archive exceeds supported extraction limits')
        seen=set(); roots=set()
        for row in entries:
            path=name(row.orig_filename);roots.add(path.parts[0])
            mode=(row.external_attr>>16)&0o170000
            if mode not in (0,0o100000,0o040000):raise ValueError('Source archive contains a link or special file')
            if str(path) in seen:raise ValueError('Source archive contains duplicate paths')
            seen.add(str(path))
        if len(roots)!=1:raise ValueError('Source archive requires one publisher root')
        for row in entries:
            parts=name(row.filename).parts[1:]
            if not parts:continue
            out=target(destination,'/'.join(parts))
            if row.is_dir():out.mkdir(parents=True,exist_ok=True)
            else:
                out.parent.mkdir(parents=True,exist_ok=True)
                with source.open(row) as incoming,out.open('xb') as outgoing:shutil.copyfileobj(incoming,outgoing)
                out.chmod(0o755 if row.external_attr>>16&0o111 else 0o644)


def unpack_jdk(archive,destination):
    """JDK internal links are allowed only after all targets are validated."""
    destination=Path(destination);destination.mkdir()
    with tarfile.open(archive,'r:gz') as source:
        entries=source.getmembers()
        if len(entries)>100000 or sum(row.size for row in entries)>1024**3:raise ValueError('Build JDK archive exceeds limits')
        seen=set();links=set()
        for row in entries:
            path=name(row.name)
            if str(path) in seen:raise ValueError('Duplicate build JDK path')
            seen.add(str(path));out=destination.joinpath(*path.parts)
            if row.issym() or row.islnk():
                links.add(out)
                if row.linkname.startswith('/') or '\\' in row.linkname:raise ValueError('Unsafe build JDK link')
                linked=out.parent/row.linkname if row.issym() else destination/row.linkname
                if not linked.resolve().is_relative_to(destination.resolve()):raise ValueError('Build JDK link escapes archive')
            elif not row.isfile() and not row.isdir():raise ValueError('Build JDK contains a special file')
        for row in entries:
            out=destination.joinpath(*name(row.name).parts)
            if any(parent in links for parent in out.parents):raise ValueError('Build JDK writes through a link')
        for row in entries:
            if row.isdir():destination.joinpath(*name(row.name).parts).mkdir(parents=True,exist_ok=True)
            elif row.isfile():
                out=destination.joinpath(*name(row.name).parts);out.parent.mkdir(parents=True,exist_ok=True)
                with source.extractfile(row) as incoming,out.open('xb') as outgoing:shutil.copyfileobj(incoming,outgoing)
                out.chmod(0o755 if row.mode&0o111 else 0o644)
        # Links are published only after regular files, never archive.extract().
        for row in entries:
            out=destination.joinpath(*name(row.name).parts)
            if row.issym():out.symlink_to(row.linkname)
            elif row.islnk():os.link(destination/row.linkname,out)
    candidates=list(destination.glob('*/bin/javac'))
    if len(candidates)!=1:raise ValueError('Pinned build JDK needs one Java compiler')
    return candidates[0].parent.parent


def package_data(source,output):
    files=sorted(p for p in source.rglob('*') if p.is_file() and (p.name.endswith('.json') or p.name in ('LICENSE','CONTENT_DOCUMENTATION.md','TOC.md')))
    if not any(p.name=='1_19_3_blocks.json' for p in files):raise ValueError('Pinned Minecraft1.19.3 data is missing')
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for path in files:
            relative=path.relative_to(source).as_posix()
            if relative=='LICENSE':relative='META-INF/LICENSE-ArticData'
            entry=zipfile.ZipInfo(relative,(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=0o100644<<16
            archive.writestr(entry,path.read_bytes())


def prepare(work,root,acquire):
    work=Path(work);sources=work/'sources';sources.mkdir()
    archives={}
    for key,pin in RECIPE['sources'].items():
        archive=work/(key+'.zip');acquire(pin,archive,root);archives[key]=archive
        folder=sources/pin['folder'];folder.mkdir();unpack_zip(archive,folder)
    for relative,patch in RECIPE['build_files'].items():
        file=target(sources,relative)
        if digest(file)!=patch['original_sha256']:raise ValueError('Pinned source build patch does not match original file: '+relative)
        file.write_text(patch['text'],encoding='utf-8')
    verification=Path(__file__).with_name('krypton-gradle-verification.xml').read_bytes()
    if hashlib.sha256(verification).hexdigest()!=RECIPE['verification_sha256']:raise ValueError('Gradle dependency allowlist checksum mismatch')
    for folder in [sources/'krypton',*[p for p in sources.rglob('build-logic') if p.is_dir()]]:
        (folder/'gradle').mkdir(exist_ok=True)
        (folder/'gradle/verification-metadata.xml').write_bytes(verification)
    package_data(sources/'articdata-src',sources/'articdata-data.jar')
    return sources,archives


def run_phase(arguments,cwd,env,timeout=1800):
    child=subprocess.Popen(arguments,cwd=cwd,env=env,start_new_session=True)
    try:
        code=child.wait(timeout=timeout)
        if code:raise subprocess.CalledProcessError(code,arguments)
    except BaseException:
        if child.poll() is None:
            os.killpg(child.pid,signal.SIGTERM)
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=10)
        raise


def build(work,root,ready,acquire):
    if platform.system()!='Linux' or platform.machine() not in ('x86_64','amd64'):
        raise ValueError('Repaired Krypton source acquisition currently supports Linuxamd64 only')
    work,root,ready=Path(work),Path(root),Path(ready)
    work.mkdir(parents=True)
    sources,archives=prepare(work,root,acquire)
    java_archive=work/'build-jdk.tar.gz';acquire(RECIPE['jdk'],java_archive,root)
    java=unpack_jdk(java_archive,work/'build-jdk')
    gradle_archive=work/'gradle.zip';acquire(RECIPE['gradle'],gradle_archive,root)
    gradle=work/'gradle';gradle.mkdir();unpack_zip(gradle_archive,gradle,1024**3)
    home=work/'home';home.mkdir(mode=0o700)
    # No credentials, operator JVM options, init scripts or shell arguments enter the compiler.
    env={'JAVA_HOME':str(java),'PATH':str(java/'bin')+':/usr/bin:/bin','HOME':str(home),'LANG':'C.UTF-8',
         'GRADLE_USER_HOME':str(work/'gradle-home'),'GRADLE_OPTS':'-Xms32m -Xmx64m'}
    common=[str(gradle/'bin/gradle'),'--no-daemon','--max-workers=1','--no-watch-fs','--dependency-verification=strict',
            '-Dorg.gradle.jvmargs=-Xms64m -Xmx896m -XX:MaxMetaspaceSize=512m','-Pkotlin.compiler.execution.strategy=in-process',
            '-Dorg.gradle.parallel=false','-Dorg.gradle.internal.http.connectionTimeout=10000','-Dorg.gradle.internal.http.socketTimeout=15000']
    for phase in (':server:jar',':jar:shadowJar'):
        print('Building explicit repaired Krypton source variant: '+phase,flush=True)
        run_phase([*common,phase],sources/'krypton',env)
    jar=sources/'krypton/jar/build/libs/Krypton.jar'
    with zipfile.ZipFile(jar) as archive:
        if archive.testzip() is not None:raise ValueError('Built Krypton JAR failed ZIP integrity')
        manifest=archive.read('META-INF/MANIFEST.MF').decode()
        if 'Main-Class: org.kryptonmc.krypton.KryptonKt' not in manifest or RECIPE['version'] not in manifest:
            raise ValueError('Built Krypton JAR has unexpected entrypoint/version')
    licenses=ready/'licenses/krypton-repaired-source';licenses.mkdir(parents=True)
    for key,archive in archives.items():
        shutil.copyfile(archive,licenses/(key+'-source.zip'))
        folder=sources/RECIPE['sources'][key]['folder']
        for license in folder.glob('*'):
            if license.is_file() and license.name.upper().startswith(('LICENSE','NOTICE','COPYING')):
                shutil.copyfile(license,licenses/(key+'-'+license.name))
    shutil.copyfile(Path(__file__).with_name('krypton-source-releases.json'),licenses/'source-recipe.json')
    shutil.copyfile(Path(__file__).with_name('krypton-gradle-verification.xml'),licenses/'gradle-verification.xml')
    provenance={'variant':RECIPE['variant'],'version':RECIPE['version'],'minecraft':RECIPE['minecraft'],'java':17,
                'build_jdk':RECIPE['jdk'],'source_commits':{k:p['commit'] for k,p in RECIPE['sources'].items()},
                'sha256':digest(jar),'bytes':jar.stat().st_size,'engine_code_changed':False,'native_verified':False,
                'original_articdata_unavailable':RECIPE['articdata_original_unavailable'],'restored_articdata':RECIPE['articdata_restored']}
    (licenses/'build-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    return jar,provenance
