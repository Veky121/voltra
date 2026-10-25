"""Explicit repaired Krypton source acquisition, never a publisher binary fallback."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import signal
import selectors
import stat
import subprocess
import sys
import time
import tarfile
import zipfile
from minecraft_pack_install import digest, target

RECIPE = json.loads(Path(__file__).with_name('krypton-source-releases.json').read_text())


def name(value):
    path = PurePosixPath(value)
    if not value or value.startswith('/') or '\\' in value or ':' in value or any(ord(c)<32 or ord(c)==127 for c in value) or any(p in ('','.','..') for p in value.rstrip('/').split('/')) or not path.parts:
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
    return sources,archives


def memory_snapshot():
    result={}
    for name in ('memory.events','memory.peak'):
        try:result[name]=Path('/sys/fs/cgroup',name).read_text()[:4096]
        except OSError:result[name]=None
    return result


def diagnostic_directory(path):
    path=Path(path).absolute()
    if path.name!='krypton-build-diagnostics' or path.parent.name!='.voltra' or '..' in path.parts:
        raise ValueError('Unexpected compiler diagnostic directory')
    directory=os.open(path.anchor,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in path.parts[1:-1]:
            next_directory=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
            os.close(directory);directory=next_directory
        try:os.mkdir(path.name,mode=0o700,dir_fd=directory)
        except FileExistsError:pass
        final=os.open(path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=directory)
        info=os.fstat(final)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid() or info.st_mode&0o077:
            os.close(final);raise ValueError('Diagnostic directory ownership/privacy mismatch')
        return final
    except OSError as exc:
        raise ValueError('Unsafe diagnostic directory path') from exc
    finally:os.close(directory)


def retained_phase(arguments,cwd,env,timeout,diagnostic_path,phase):
    import fcntl
    if phase not in (':server:jar',':jar:shadowJar'):raise ValueError('Unknown diagnostic compiler phase')
    directory=diagnostic_directory(diagnostic_path)
    stem=phase.strip(':').replace(':','-')
    def private_file(name,maximum):
        fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=directory)
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or info.st_mode&0o077 or info.st_nlink!=1 or info.st_size>maximum:
            os.close(fd);raise ValueError('Unsafe existing compiler diagnostic file')
        return fd
    try:log=private_file(stem+'.log',1024**2)
    except BaseException:
        os.close(directory);raise
    try:
        fcntl.flock(log,fcntl.LOCK_EX|fcntl.LOCK_NB)
        metadata=private_file(stem+'.json',16384)
    except BaseException:
        os.close(log);os.close(directory);raise
    report={'phase':phase,'before':memory_snapshot(),'exit_code':None,'timed_out':False,'tail_limit_bytes':1024**2,'output_bytes':0}
    child=None;tail=bytearray();error=None;selector=selectors.DefaultSelector()
    try:
        os.ftruncate(log,0);os.ftruncate(metadata,0)
        os.write(metadata,(json.dumps(report,indent=2)+'\n').encode());os.fsync(metadata)
        child=subprocess.Popen(arguments,cwd=cwd,env=env,start_new_session=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        os.set_blocking(child.stdout.fileno(),False);selector.register(child.stdout,selectors.EVENT_READ)
        deadline=time.monotonic()+timeout
        while selector.get_map():
            if time.monotonic()>=deadline:raise subprocess.TimeoutExpired(arguments,timeout)
            for key,_ in selector.select(min(.1,max(0,deadline-time.monotonic()))):
                data=os.read(key.fd,65536)
                if not data:selector.unregister(key.fileobj);continue
                sys.stdout.buffer.write(data);sys.stdout.buffer.flush()
                report['output_bytes']+=len(data);tail.extend(data)
                if len(tail)>1024**2:del tail[:-1024**2]
                os.lseek(log,0,os.SEEK_SET);os.ftruncate(log,0)
                view=memoryview(tail)
                while view:
                    written=os.write(log,view);view=view[written:]
                del view
        code=child.wait(timeout=max(.001,deadline-time.monotonic()))
        if code:raise subprocess.CalledProcessError(code,arguments)
    except BaseException as exc:
        error=exc;report['timed_out']=isinstance(exc,subprocess.TimeoutExpired)
        raise
    finally:
        if child is not None:
            # Kill the owned process group even when its leader exited but a child
            # retained the pipe. No unrelated compiler/server process is targeted.
            if error is not None:
                try:os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError:pass
                try:child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                child.wait(timeout=2)
            report['exit_code']=child.poll()
            child.stdout.close()
        report['after']=memory_snapshot();report['error_type']=type(error).__name__ if error else None
        # No argv, environment, JVM options or operator configuration is recorded.
        try:
            os.lseek(metadata,0,os.SEEK_SET);os.ftruncate(metadata,0)
            os.write(metadata,(json.dumps(report,indent=2)+'\n').encode());os.fsync(log);os.fsync(metadata)
        except OSError:
            if error is None:raise
            print('Compiler diagnostic finalization failed; retaining original phase failure.',file=sys.stderr)
        finally:
            selector.close();os.close(log);os.close(metadata);os.close(directory)


def run_phase(arguments,cwd,env,timeout=1800,diagnostic_path=None,phase=None):
    if diagnostic_path is not None:
        return retained_phase(arguments,cwd,env,timeout,diagnostic_path,phase)
    child=subprocess.Popen(arguments,cwd=cwd,env=env,start_new_session=True)
    try:
        code=child.wait(timeout=timeout)
        if code:raise subprocess.CalledProcessError(code,arguments)
    except BaseException:
        if child.poll() is None:
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                child.wait(timeout=10)
        raise


def require_build_memory(paths=None):
    for path in paths or (Path('/sys/fs/cgroup/memory.max'),Path('/sys/fs/cgroup/memory/memory.limit_in_bytes')):
        try:value=path.read_text().strip()
        except OSError:continue
        if value.isdigit():
            limit=int(value)
            if limit<4096*1024**2:raise ValueError('Repaired Krypton source compilation requires at least4GiB installer RAM; cached source output, publisher mode or an existing JAR do not require compilation')
            return limit
    return None


def validate_manifest(archive,expected_version):
    """Unfold main-section bytes before UTF-8; never accept named-section identity."""
    manifests=[entry for entry in archive.infolist() if entry.filename=='META-INF/MANIFEST.MF']
    if len(manifests)!=1:raise ValueError('Built Krypton JAR needs one manifest')
    info=manifests[0]
    if not 0<info.file_size<=64*1024:
        raise ValueError('Built Krypton manifest exceeds supported bounds')
    with archive.open(info) as incoming:raw=incoming.read(64*1024+1)
    if len(raw)!=info.file_size or len(raw)>64*1024 or b'\x00' in raw:
        raise ValueError('Built Krypton manifest is truncated or malformed')
    # JAR manifests may use CRLF, LF or CR line endings. A terminating blank
    # main-section line is required; truncated headers must not become identity.
    lines=raw.replace(b'\r\n',b'\n').replace(b'\r',b'\n').split(b'\n')
    unfolded=[]
    for line in lines:
        if line.startswith(b' '):
            if not unfolded or not unfolded[-1]:raise ValueError('Leading manifest continuation')
            unfolded[-1]+=line[1:]
        else:unfolded.append(line)
    b'\n'.join(unfolded).decode('utf-8',errors='strict')
    headers=[];ended=False
    for line in lines:
        if not line:
            ended=True;break
        if line.startswith(b' '):
            if not headers:raise ValueError('Leading manifest continuation')
            headers[-1]+=line[1:]
        else:headers.append(line)
    if not ended or not raw.endswith((b'\n',b'\r')) or not headers:
        raise ValueError('Built Krypton manifest main section is truncated')
    # split() creates a trailing empty item for ONE final newline, which is
    # header termination, not the required blank section delimiter.
    first_section=raw.replace(b'\r\n',b'\n').replace(b'\r',b'\n')
    if b'\n\n' not in first_section:
        raise ValueError('Built Krypton manifest lacks main section delimiter')
    attributes={}
    for header in headers:
        text=header.decode('utf-8',errors='strict')
        if ': ' not in text:raise ValueError('Malformed manifest attribute')
        key,value=text.split(': ',1)
        if not key or len(key)>70 or any(not ('A'<=c<='Z' or 'a'<=c<='z' or '0'<=c<='9' or c in '_-') for c in key):
            raise ValueError('Malformed manifest attribute name')
        key=key.lower()
        if key in attributes:raise ValueError('Duplicate manifest attribute')
        if any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Malformed manifest attribute value')
        attributes[key]=value
    if attributes.get('manifest-version')!='1.0' or attributes.get('main-class')!='org.kryptonmc.krypton.KryptonKt' or attributes.get('implementation-version')!=expected_version:
        raise ValueError('Built Krypton JAR has unexpected entrypoint/version')


def build(work,root,ready,acquire):
    if platform.system()!='Linux' or platform.machine() not in ('x86_64','amd64'):
        raise ValueError('Repaired Krypton source acquisition currently supports Linuxamd64 only')
    installer_limit=require_build_memory()
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
    import krypton_registry_data
    registry_proof=krypton_registry_data.supplement(sources,work/'registry-generation',java,acquire,env,RECIPE['registry_generation'])
    package_data(sources/'articdata-src',sources/'articdata-data.jar')
    common=[str(gradle/'bin/gradle'),'--no-daemon','--max-workers=1','--no-watch-fs','--dependency-verification=strict',
            '-Dorg.gradle.jvmargs=-Xms64m -Xmx1536m -XX:MaxMetaspaceSize=768m','-Pkotlin.compiler.execution.strategy=in-process',
            '-Dorg.gradle.parallel=false','-Dorg.gradle.internal.http.connectionTimeout=10000','-Dorg.gradle.internal.http.socketTimeout=15000']
    for phase in (':server:jar',':jar:shadowJar'):
        print('Building explicit repaired Krypton source variant: '+phase,flush=True)
        run_phase([*common,phase],sources/'krypton',env,diagnostic_path=root/'.voltra/krypton-build-diagnostics',phase=phase)
    jar=sources/'krypton/jar/build/libs/Krypton.jar'
    with zipfile.ZipFile(jar) as archive:
        if archive.testzip() is not None:raise ValueError('Built Krypton JAR failed ZIP integrity')
        validate_manifest(archive,RECIPE['version'])
    licenses=ready/'licenses/krypton-repaired-source';licenses.mkdir(parents=True)
    for key,archive in archives.items():
        shutil.copyfile(archive,licenses/(key+'-source.zip'))
        folder=sources/RECIPE['sources'][key]['folder']
        for license in folder.glob('*'):
            if license.is_file() and license.name.upper().startswith(('LICENSE','NOTICE','COPYING')):
                shutil.copyfile(license,licenses/(key+'-'+license.name))
    shutil.copyfile(Path(__file__).with_name('krypton-source-releases.json'),licenses/'source-recipe.json')
    shutil.copyfile(Path(__file__).with_name('krypton-gradle-verification.xml'),licenses/'gradle-verification.xml')
    for file in ('krypton-source-build.py','krypton-registry-data.py','KryptonRegistrySupplement.java','krypton-config.py'):
        shutil.copyfile(Path(__file__).with_name(file),licenses/file)
    (licenses/'registry-generation.json').write_text(json.dumps(registry_proof,indent=2)+'\n')
    import krypton_config
    config=krypton_config.generate(jar,java/'bin/java',work/'config-only')
    shutil.copyfile(config,ready/'config.conf')
    provenance={'variant':RECIPE['variant'],'version':RECIPE['version'],'minecraft':RECIPE['minecraft'],'java':17,
                'build_jdk':RECIPE['jdk'],'source_commits':{k:p['commit'] for k,p in RECIPE['sources'].items()},
                'sha256':digest(jar),'bytes':jar.stat().st_size,'engine_code_changed':RECIPE.get('engine_code_changed',False),'native_verified':False,'installer_memory_limit_bytes':installer_limit,
                'original_articdata_unavailable':RECIPE['articdata_original_unavailable'],'restored_articdata':RECIPE['articdata_restored'],
                'registry_generation':registry_proof,'config_only_exit_code':0,'config_sha256':digest(config),'game_server_started':False}
    (licenses/'build-provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
    return jar,provenance
