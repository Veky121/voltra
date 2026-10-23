"""Pack publication boundary; provider adapters stage into an empty directory.

Existing operator content wins over publisher defaults, including unchanged mods.
Only tracked, unmodified program files may be upgraded. No archive scripts run.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tempfile

CONTENT = {'mods', 'plugins', 'config', 'defaultconfigs', 'kubejs', 'scripts',
           'datapacks', 'resources', 'global_packs', 'resourcepacks', 'saves',
           'backups', 'logs', 'crash-reports', 'journeymap', 'coremods', 'Flan',
           'customnpcs', 'schematics', 'hats'}
OPERATOR = {'eula.txt', 'server.properties', 'user_jvm_args.txt', 'banned-ips.json',
            'banned-players.json', 'ops.json', 'whitelist.json', 'permissions.yml',
            'bukkit.yml', 'spigot.yml', 'paper.yml'}


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def target(root, relative):
    """Reject symlinks even when they resolve within the owned volume."""
    parts = PurePosixPath(relative).parts
    if not parts or relative.startswith('/') or '\\' in relative or ':' in relative or '..' in parts:
        raise ValueError('Unsafe pack path')
    result = root
    for part in parts:
        result = result / part
        if result.is_symlink():
            raise ValueError('Pack destination contains a symlink')
    if not result.resolve().is_relative_to(root.resolve()):
        raise ValueError('Pack destination escapes its volume')
    return result


def operator_path(relative, world_names=()):
    first = relative.split('/')[0]
    return (relative in OPERATOR or first in CONTENT or first.startswith('world')
            or first in world_names or relative.endswith(('.properties', '.cfg', '.toml', '.yml', '.yaml')))


def configured_worlds(root):
    properties = root / 'server.properties'
    if properties.is_symlink():
        raise ValueError('Server properties is a symlink')
    worlds = set()
    if properties.is_file():
        for line in properties.read_text(encoding='utf-8').splitlines():
            if line.strip().startswith('level-name='):
                name = line.strip().split('=', 1)[1]
                target(root, name)
                worlds.update((name.split('/')[0], name + '_nether', name + '_the_end'))
    return worlds


def publish(staging, root, identity, launch):
    """Install absent defaults; preserve operator state; roll back failed writes.

    The receipt records only this adapter's program files. Existing untracked
    files are never adopted as publisher-owned or overwritten. Removed pack
    files remain available for explicit operator migration rather than deletion.
    """
    staging, root = Path(staging).resolve(), Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    receipt = target(root, '.voltra/minecraft-pack/release.json')
    previous = json.loads(receipt.read_text()) if receipt.is_file() else {}
    prior_files = previous.get('program_files', {})
    if not isinstance(prior_files, dict):
        raise ValueError('Invalid pack receipt')
    launch_path = target(staging, launch)
    if not launch_path.is_file():
        raise ValueError('Pack has no launch target')
    world_names = configured_worlds(root)
    writes, program_files, retained = [], {}, []
    for source in sorted(staging.rglob('*')):
        if source.is_symlink() or not (source.is_file() or source.is_dir()):
            raise ValueError('Pack contains links or special files')
        if source.is_dir():
            continue
        relative = source.relative_to(staging).as_posix()
        if relative == 'eula.txt':
            # Publisher archives cannot accept an agreement for the operator.
            continue
        first = relative.split('/')[0]
        if (first.startswith('world') or first in world_names) and target(root, first).exists():
            retained.append(relative)
            continue
        if relative.startswith('.voltra/'):
            raise ValueError('Pack cannot replace adapter state')
        destination = target(root, relative)
        if destination.exists() and not destination.is_file():
            raise ValueError('Pack file conflicts with existing directory')
        protected = operator_path(relative, world_names)
        if destination.exists() and (protected or relative not in prior_files or digest(destination) != prior_files[relative]):
            retained.append(relative)
            continue
        source_hash = digest(source)
        if not protected:
            program_files[relative] = source_hash
        if destination.exists() and digest(destination) == source_hash:
            # A root installer must not replace an unchanged game-owned inode.
            continue
        writes.append((source, destination))
    # A conflicting launch jar is operator-owned, but must remain usable.
    if not any(destination == target(root, launch) for _, destination in writes) and not target(root, launch).is_file():
        raise ValueError('No usable pack launch file')
    state = target(root, '.voltra/minecraft-pack')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='rollback-', dir=state) as directory:
        changed = []
        try:
            for index, (source, destination) in enumerate(writes):
                previous = destination.stat() if destination.exists() else None
                backup = Path(directory) / str(index) if destination.exists() else None
                if backup:
                    shutil.copy2(destination, backup)
                    if hasattr(os, 'chown'):
                        os.chown(backup, previous.st_uid, previous.st_gid)
                changed.append((destination, backup))
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as output:
                    temporary = Path(output.name)
                    try:
                        with source.open('rb') as stream:
                            shutil.copyfileobj(stream, output)
                        output.flush()
                        os.fsync(output.fileno())
                    except BaseException:
                        temporary.unlink(missing_ok=True)
                        raise
                try:
                    temporary.chmod((previous.st_mode if previous else source.stat().st_mode) & 0o777)
                    if previous and hasattr(os, 'chown'):
                        os.chown(temporary, previous.st_uid, previous.st_gid)
                    os.replace(temporary, destination)
                finally:
                    temporary.unlink(missing_ok=True)
            document = {'identity': identity, 'launch': launch, 'program_files': program_files,
                        'retained_existing': retained, 'eula': 'operator choice preserved'}
            pending = Path(directory) / 'receipt.json'
            pending.write_text(json.dumps(document, sort_keys=True) + '\n')
            pending.chmod(0o600)
            os.replace(pending, receipt)
        except BaseException:
            for destination, backup in reversed(changed):
                if backup:
                    os.replace(backup, destination)
                else:
                    destination.unlink(missing_ok=True)
            raise
    return document


def technic_release(recipe, env, metadata=None):
    pins = json.loads(Path(__file__).with_name('minecraft-pack-releases.json').read_text())['technic']
    if recipe not in pins:
        raise ValueError('Unknown original Technic recipe')
    pinned = pins[recipe]
    version = env.get('MODPACK_VERSION', '').strip()
    if not version:
        if '/tekkit-smp/' in recipe:
            build = env.get('BUILD_TYPE', 'recommended')
            if build not in ('recommended', 'latest'):
                raise ValueError('Choose recommended or latest Tekkit SMP build')
            if metadata is None:
                import modded_java_install
                metadata = modded_java_install.metadata
            version = 'v' + metadata('https://solder.technicpack.net/api/modpack/tekkit-smp')[build]
        else:
            version = pinned['version']
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,63}', version):
        raise ValueError('Choose a literal Technic version')
    if version == pinned['version']:
        return dict(pinned)
    url = pinned['url_template'].replace('${MODPACK_VERSION}', version).replace('$MODPACK_VERSION', version)
    return {'path': recipe, 'version': version, 'url': url, 'java': 8, 'startup': pinned['startup']}


def acquire(release, destination, cache_root):
    """Strong-pinned defaults share immutable cache; custom versions stay private."""
    if release.get('sha256'):
        from native_release import download
        download(release, destination, cache_root)
        return release['sha256']
    import urllib.request
    from limbo_install import public_url, Redirects
    request = urllib.request.Request(public_url(release['url']), headers={'User-Agent': 'Voltra-GameLibrary/1.0'})
    count = 0
    with urllib.request.build_opener(Redirects()).open(request, timeout=120) as source, destination.open('xb') as output:
        while block := source.read(1024 * 1024):
            count += len(block)
            if count > 2 * 1024**3:
                raise ValueError('Pack download exceeds 2 GiB')
            output.write(block)
    return digest(destination)


def select_launch(staging, startup):
    match = re.search(r'-jar\s+([^\s]+)', startup)
    if not match:
        raise ValueError('Unsupported pack launch format')
    pattern = match[1]
    if '/' in pattern or '\\' in pattern or '..' in pattern:
        raise ValueError('Pack launch JAR must be in the server root')
    # Tekkit2/SMP original installers normalize the publisher Forge filename.
    if pattern == 'forge.jar' and not (staging / pattern).exists():
        candidates = list(staging.glob('forge-*.jar'))
    else:
        candidates = list(staging.glob(pattern))
    candidates = [p for p in candidates if p.is_file() and not p.is_symlink() and 'installer' not in p.name]
    if len(candidates) != 1:
        raise ValueError('Pack must contain exactly one matching native server JAR')
    shutil.copy2(candidates[0], staging / 'start-server.jar')
    return 'start-server.jar'


def install_technic(recipe, root, env):
    from native_zip_release import extract
    root = Path(root).resolve()
    state = target(root, '.voltra/minecraft-pack/work')
    state.mkdir(parents=True, exist_ok=True)
    release = technic_release(recipe, env)
    with tempfile.TemporaryDirectory(prefix='technic-', dir=state) as directory:
        stage = Path(directory)
        archive, ready = stage / 'archive.zip', stage / 'ready'
        ready.mkdir()
        checksum = acquire(release, archive, target(root, '.voltra/public-cache'))
        extract(archive, ready, None)
        # Publisher archives may wrap the complete server in one directory.
        children = list(ready.iterdir())
        if len(children) == 1 and children[0].is_dir():
            ready = children[0]
        launch = select_launch(ready, release['startup'])
        identity = {'provider': 'technic', 'recipe': recipe, 'version': release['version'], 'sha256': checksum, 'java': 8}
        return publish(ready, root, identity, launch)


def parse_modrinth(index):
    """The dedicated-server side of the official mrpack v1 specification."""
    if index.get('formatVersion') != 1 or index.get('game') != 'minecraft':
        raise ValueError('Unsupported Modrinth pack format')
    dependencies = index.get('dependencies', {})
    version = dependencies.get('minecraft', '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,127}', version):
        raise ValueError('Pack has no Minecraft version')
    loaders = [(key, value) for key, value in dependencies.items() if key != 'minecraft']
    names = {'fabric-loader': 'fabric', 'quilt-loader': 'quilt', 'forge': 'forge', 'neoforge': 'neoforge'}
    if len(loaders) > 1 or loaders and loaders[0][0] not in names:
        raise ValueError('Pack has conflicting or unsupported loader dependencies')
    loader, loader_version = (names[loaders[0][0]], loaders[0][1]) if loaders else ('vanilla', '')
    files, seen = [], set()
    for row in index.get('files', []):
        name = row.get('path', '')
        target(Path('/voltra-pack-staging'), name)
        if name in seen or name.startswith('.voltra/'):
            raise ValueError('Duplicate or reserved pack file')
        seen.add(name)
        server = row.get('env', {}).get('server', 'required')
        if server not in ('required', 'optional', 'unsupported'):
            raise ValueError('Unknown pack server environment')
        if server == 'unsupported':
            continue
        hashes = row.get('hashes', {})
        checksum = hashes.get('sha512', '')
        if not re.fullmatch('[0-9a-fA-F]{128}', checksum):
            raise ValueError('Modrinth server file needs its publisher SHA512')
        urls = row.get('downloads', [])
        if not isinstance(urls, list) or not urls or not isinstance(urls[0], str):
            raise ValueError('Pack file has no HTTPS download')
        size = row.get('fileSize')
        if not isinstance(size, int) or isinstance(size, bool) or not 0 <= size <= 512 * 1024**2:
            raise ValueError('Invalid pack file size')
        files.append({'path': name, 'url': urls[0], 'algorithm': 'sha512', 'hash': checksum.lower(), 'bytes': size})
    return version, loader, loader_version, files


def loader_plan(version, loader, loader_version):
    import modded_java_install as modded
    if loader == 'vanilla':
        game, major, server = modded.game_release(version)
        return {'loader': 'vanilla', 'version': game, 'java': major, 'files': [server], 'launch': '-jar server.jar'}
    env = {'MC_VERSION': version, 'LOADER_VERSION': loader_version}
    if loader == 'forge':
        env['FORGE_VERSION'] = version + '-' + loader_version
    if loader == 'neoforge':
        env['NEOFORGE_VERSION'] = loader_version
    return modded.resolve(loader, env)


def unpack_overrides(archive, staging):
    from native_zip_release import extract
    raw = staging / 'archive-content'
    raw.mkdir()
    extract(archive, raw, None)
    for prefix in ('overrides', 'server-overrides'):
        directory = raw / prefix
        if directory.exists():
            for source in directory.rglob('*'):
                if source.is_file():
                    relative = source.relative_to(directory).as_posix()
                    destination = target(staging / 'server', relative)
                    if relative.startswith('.voltra/'):
                        raise ValueError('Pack overrides cannot replace adapter state')
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)
    return raw


def install_modrinth(root, env):
    import modded_java_install as modded
    import minecraft_install as minecraft
    from urllib.parse import quote
    root = Path(root).resolve()
    project, selected = env.get('PROJECT_ID', '').strip(), env.get('VERSION_ID', 'latest').strip() or 'latest'
    if not project:
        raise ValueError('Select a Modrinth project or upload server.zip with PROJECT_ID=zip')
    state = target(root, '.voltra/minecraft-pack/work')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='modrinth-', dir=state) as directory:
        work = Path(directory)
        archive = work / 'pack.mrpack'
        if project == 'zip':
            uploaded = target(root, 'server.zip')
            if not uploaded.is_file():
                raise ValueError('Upload server.zip before selecting PROJECT_ID=zip')
            shutil.copyfile(uploaded, archive)
            identity = {'provider': 'modrinth', 'project': 'operator-upload', 'sha256': digest(archive)}
        else:
            if selected == 'latest':
                versions = modded.metadata('https://api.modrinth.com/v2/project/' + quote(project, safe='') + '/version')
                metadata = next((row for row in versions if any(str(f.get('filename', '')).endswith('.mrpack') for f in row.get('files', []))), None)
            else:
                metadata = modded.metadata('https://api.modrinth.com/v2/project/' + quote(project, safe='') + '/version/' + quote(selected, safe=''))
            if not metadata:
                raise ValueError('No matching Modrinth pack version')
            candidates = [f for f in metadata.get('files', []) if f.get('filename', '').endswith('.mrpack')]
            pack = next((f for f in candidates if f.get('primary')), candidates[0] if candidates else None)
            if not pack or not re.fullmatch('[0-9a-fA-F]{128}', pack.get('hashes', {}).get('sha512', '')):
                raise ValueError('Publisher pack archive needs SHA512')
            archive.write_bytes(minecraft.verified({'url': pack['url'], 'algorithm': 'sha512', 'hash': pack['hashes']['sha512']}))
            identity = {'provider': 'modrinth', 'project': metadata.get('project_id'), 'version': metadata.get('id'), 'sha256': digest(archive)}
        raw = unpack_overrides(archive, work)
        manifest = target(raw, 'modrinth.index.json')
        if not manifest.is_file() or manifest.stat().st_size > 8 * 1024**2:
            raise ValueError('Archive has no bounded Modrinth index')
        version, loader, loader_version, files = parse_modrinth(json.loads(manifest.read_text()))
        plan = loader_plan(version, loader, loader_version)
        plan['files'] += files
        os.environ.setdefault('MAX_PLAYERS', '20')
        os.environ.setdefault('GAME_MODE', 'survival')
        os.environ.setdefault('DIFFICULTY', 'normal')
        ready = work / 'server'
        # Shared installer validates publisher hashes and invokes the official loader.
        # Overrides are already staged; reapply server overrides after loader defaults.
        minecraft.install(plan, ready, work_directory=state)
        for prefix in ('overrides', 'server-overrides'):
            directory = raw / prefix
            if directory.exists():
                shutil.copytree(directory, ready, dirs_exist_ok=True)
        if plan['launch'].startswith('@'):
            launch = 'unix_args.txt'
            shutil.copy2(target(ready, plan['launch'][1:]), ready / launch)
        else:
            source = target(ready, plan['launch'].removeprefix('-jar '))
            shutil.copy2(source, ready / 'start-server.jar')
            launch = 'start-server.jar'
        identity.update(minecraft=version, loader=loader, loader_version=loader_version, java=plan['java'])
        return publish(ready, root, identity, launch)


def curse_json(path, key):
    import urllib.request
    if not key:
        raise ValueError('A valid CurseForge API_KEY is required; configure the original secret field')
    if not re.fullmatch(r'(?:[0-9]+/?|files/[0-9]+/?)+', path):
        raise ValueError('Invalid CurseForge API path')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError('Credential-bearing CurseForge metadata redirects are unsupported')
    request=urllib.request.Request('https://api.curseforge.com/v1/mods/'+path,
                                   headers={'Accept':'application/json','x-api-key':key,'User-Agent':'Voltra-GameLibrary/1.0'})
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=60) as response:
        data=response.read(8*1024**2+1)
    if len(data)>8*1024**2:
        raise ValueError('CurseForge metadata exceeds its size limit')
    return json.loads(data)['data']


def curse_file(metadata):
    checksum=next((h['value'] for h in metadata.get('hashes',[]) if h.get('algo')==1), '')
    if not re.fullmatch('[0-9a-fA-F]{40}',checksum) or not metadata.get('downloadUrl'):
        raise ValueError('Publisher download permission and SHA1 are required for this CurseForge file')
    return {'url':metadata['downloadUrl'],'algorithm':'sha1','hash':checksum.lower()}


def curse_loader(manifest):
    minecraft=manifest.get('minecraft',{})
    version=minecraft.get('version','')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,127}',version):
        raise ValueError('CurseForge manifest has no Minecraft version')
    loaders=[row.get('id','') for row in minecraft.get('modLoaders',[]) if row.get('primary')]
    if not loaders:
        if minecraft.get('modLoaders'):
            raise ValueError('CurseForge manifest has no primary loader')
        return version,'vanilla',''
    if len(loaders)!=1 or '-' not in loaders[0]:
        raise ValueError('CurseForge manifest has conflicting loaders')
    loader,selected=loaders[0].split('-',1)
    if loader not in ('forge','fabric','quilt','neoforge'):
        raise ValueError('Unsupported CurseForge loader')
    return version,loader,selected


def install_curseforge(root, env):
    root=Path(root).resolve()
    project,selected=env.get('PROJECT_ID','').strip(),env.get('VERSION_ID','latest').strip() or 'latest'
    key=env.get('API_KEY','')
    if project=='zip':
        return install_curseforge_upload(root,env)
    # No network, file changes or credentials in receipts before this prerequisite.
    if not key:
        raise ValueError('Configure a valid CurseForge API_KEY before installing this pack')
    import minecraft_install as minecraft
    from native_zip_release import extract
    import zipfile
    if not project.isascii() or not project.isdigit():
        raise ValueError('Choose the original numeric CurseForge PROJECT_ID')
    if selected=='latest':
        selected=str(curse_json(project,key)['mainFileId'])
    if not selected.isascii() or not selected.isdigit():
        raise ValueError('Choose a numeric VERSION_ID or latest')
    metadata=curse_json(project+'/files/'+selected,key)
    server_metadata=None
    if metadata.get('isServerPack'):
        server_metadata=metadata
        parent=metadata.get('parentProjectFileId')
        if not parent:
            raise ValueError('Server pack needs its publisher parent manifest')
        metadata=curse_json(project+'/files/'+str(parent),key)
    elif metadata.get('serverPackFileId'):
        server_metadata=curse_json(project+'/files/'+str(metadata['serverPackFileId']),key)
    if server_metadata is None and env.get('ALLOW_UNVERIFIED_CF_MODS')!='true':
        raise ValueError('This file has no dedicated server pack. Explicitly opt into unverified client-manifest server compatibility, or select a server pack')
    client_file=curse_file(metadata)
    state=target(root,'.voltra/minecraft-pack/work')
    state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='curseforge-',dir=state) as directory:
        work=Path(directory)
        archive=work/'client.zip'
        archive.write_bytes(minecraft.verified(client_file))
        with zipfile.ZipFile(archive) as reader:
            member=reader.getinfo('manifest.json')
            if member.file_size>8*1024**2:
                raise ValueError('CurseForge manifest exceeds its size limit')
            manifest=json.loads(reader.read(member))
        version,loader,loader_version=curse_loader(manifest)
        plan=loader_plan(version,loader,loader_version)
        if server_metadata is None:
            for row in manifest.get('files',[]):
                if row.get('required',True):
                    file=curse_json(str(row['projectID'])+'/files/'+str(row['fileID']),key)
                    download=curse_file(file)
                    filename=file.get('fileName','')
                    if not re.fullmatch(r'[A-Za-z0-9_+(). -]+\.jar',filename):
                        raise ValueError('CurseForge mod needs a safe JAR filename')
                    download['path']='mods/'+filename
                    plan['files'].append(download)
        ready=work/'server'
        os.environ.setdefault('MAX_PLAYERS','20')
        os.environ.setdefault('GAME_MODE','survival')
        os.environ.setdefault('DIFFICULTY','normal')
        minecraft.install(plan,ready,work_directory=state)
        if server_metadata is not None:
            server=work/'server.zip'
            server.write_bytes(minecraft.verified(curse_file(server_metadata)))
            unwrapped=work/'server-pack';unwrapped.mkdir()
            extract(server,unwrapped,None)
            children=list(unwrapped.iterdir())
            if len(children)==1 and children[0].is_dir():unwrapped=children[0]
            shutil.copytree(unwrapped,ready,dirs_exist_ok=True)
            pack_hash=digest(server)
        else:
            unpack_overrides(archive,work)
            pack_hash=digest(archive)
        if plan['launch'].startswith('@'):
            launch='unix_args.txt';shutil.copy2(target(ready,plan['launch'][1:]),ready/launch)
        else:
            launch='start-server.jar';shutil.copy2(target(ready,plan['launch'].removeprefix('-jar ')),ready/launch)
        identity={'provider':'curseforge','project':project,'version':str(metadata['id']),
                  'server_file':str(server_metadata['id']) if server_metadata else None,'sha256':pack_hash,
                  'minecraft':version,'loader':loader,'loader_version':loader_version,'java':plan['java']}
        return publish(ready,root,identity,launch)


def install_curseforge_upload(root,env):
    """Repair the original PROJECT_ID=zip mode without pretending API access."""
    import minecraft_install as minecraft
    from native_zip_release import extract
    root=Path(root).resolve()
    uploaded=target(root,'server.zip')
    if not uploaded.is_file():
        raise ValueError('Upload server.zip before selecting PROJECT_ID=zip')
    state=target(root,'.voltra/minecraft-pack/work');state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='curse-upload-',dir=state) as directory:
        work=Path(directory);raw=work/'archive';raw.mkdir()
        extract(uploaded,raw,None)
        children=list(raw.iterdir())
        if len(children)==1 and children[0].is_dir():raw=children[0]
        manifest=raw/'manifest.json'
        if not manifest.is_file():manifest=target(root,'client.manifest.json')
        if not manifest.is_file() or manifest.stat().st_size>8*1024**2:
            raise ValueError('Upload matching client.manifest.json when the server archive has no manifest.json')
        data=json.loads(manifest.read_text())
        version,loader,loader_version=curse_loader(data)
        plan=loader_plan(version,loader,loader_version)
        for row in data.get('files',[]):
            if row.get('required',True):
                key=env.get('API_KEY','')
                if not key:
                    raise ValueError('Client-manifest mod downloads require API_KEY; use a complete dedicated server archive')
                file=curse_json(str(row['projectID'])+'/files/'+str(row['fileID']),key)
                download=curse_file(file);filename=file.get('fileName','')
                if not re.fullmatch(r'[A-Za-z0-9_+(). -]+\.jar',filename):raise ValueError('Unsafe CurseForge mod filename')
                if not (raw/'mods'/filename).is_file():
                    download['path']='mods/'+filename;plan['files'].append(download)
        ready=work/'server'
        os.environ.setdefault('MAX_PLAYERS','20');os.environ.setdefault('GAME_MODE','survival');os.environ.setdefault('DIFFICULTY','normal')
        minecraft.install(plan,ready,work_directory=state)
        prefix=data.get('overrides','overrides')
        override=target(raw,prefix)
        if override.is_dir():shutil.copytree(override,ready,dirs_exist_ok=True)
        # Complete dedicated server archives contain top-level programs/configs.
        for source in raw.iterdir():
            if source.name in (prefix,'manifest.json','client-overrides','overrides','server-overrides'):continue
            destination=target(ready,source.name)
            if source.is_dir():shutil.copytree(source,destination,dirs_exist_ok=True)
            else:shutil.copy2(source,destination)
        if plan['launch'].startswith('@'):
            launch='unix_args.txt';shutil.copy2(target(ready,plan['launch'][1:]),ready/launch)
        else:
            launch='start-server.jar';shutil.copy2(target(ready,plan['launch'].removeprefix('-jar ')),ready/launch)
        return publish(ready,root,{'provider':'curseforge','project':'operator-upload','sha256':digest(uploaded),
                                 'minecraft':version,'loader':loader,'loader_version':loader_version,'java':plan['java']},launch)


def ftb_selection(env, metadata=None):
    from urllib.parse import quote
    if metadata is None:
        from modded_java_install import metadata
    base='https://api.feed-the-beast.com/v1/modpacks/public/modpack/'
    project=env.get('FTB_MODPACK_ID','').strip()
    if not project:
        term=env.get('FTB_SEARCH_TERM','').strip()
        if len(term)<4 or len(term)>200:
            raise ValueError('Choose FTB_MODPACK_ID or a unique FTB_SEARCH_TERM of4..200characters')
        found=metadata(base+'search/8?term='+quote(term,safe='')).get('packs',[])
        if len(found)!=1:
            raise ValueError('FTB search must identify exactly one public pack; select FTB_MODPACK_ID explicitly')
        project=str(found[0])
    if not project.isascii() or not project.isdigit():
        raise ValueError('FTB_MODPACK_ID must be numeric')
    pack=metadata(base+project)
    selected=env.get('FTB_MODPACK_VERSION_ID','').strip()
    versions=[row for row in pack.get('versions',[]) if not row.get('private')]
    if not selected:
        name=env.get('FTB_VERSION_STRING','').strip()
        if name:
            versions=[row for row in versions if row.get('name')==name]
            if len(versions)!=1:
                raise ValueError('FTB_VERSION_STRING must match exactly one public pack release')
            selected=str(versions[0]['id'])
        elif versions:
            selected=str(max(versions,key=lambda row:(row.get('released',0),row.get('updated',0),row['id']))['id'])
        else:
            raise ValueError('FTB pack has no public version')
    if not selected.isascii() or not selected.isdigit() or not any(str(row['id'])==selected for row in versions):
        raise ValueError('FTB_MODPACK_VERSION_ID must belong to the selected public pack')
    release=metadata(base+project+'/'+selected)
    if release.get('private') or str(release.get('id'))!=selected:
        raise ValueError('FTB returned a different or private version')
    targets=[row for row in release.get('targets',[]) if row.get('name')=='java']
    if len(targets)!=1 or not re.fullmatch(r'[0-9]+(?:[.0-9+_a-zA-Z-]*)',str(targets[0].get('version',''))):
        raise ValueError('FTB version needs an explicit supported Java target')
    java=int(targets[0]['version'].split('.')[0])
    if java not in (8,11,16,17,21,25):
        raise ValueError('Choose a supported Java runtime for this FTB pack')
    return project,selected,java,release


def install_ftb(root, env):
    import platform
    import subprocess
    import minecraft_install as minecraft
    root=Path(root).resolve()
    project,selected,java,release=ftb_selection(env)
    machine=platform.machine().lower()
    arch='linux' if machine in ('x86_64','amd64') else 'arm/linux' if machine in ('aarch64','arm64') else None
    if arch is None:
        raise ValueError('FTB installer supports Linuxx64/arm64 only')
    installer_pin=json.loads(Path(__file__).with_name('minecraft-pack-releases.json').read_text())['ftb_installers'][arch]
    state=target(root,'.voltra/minecraft-pack/work');state.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ftb-',dir=state) as directory:
        work=Path(directory);ready=work/'server';ready.mkdir()
        installer=work/('serverinstaller_'+project+'_'+selected)
        acquire(installer_pin,installer,target(root,'.voltra/public-cache'));installer.chmod(0o755)
        java_root=work/'java';java_root.mkdir()
        executable=minecraft.bootstrap_java(java,java_root)
        child_env=dict(os.environ,JAVA_HOME=str(Path(executable).parent.parent),PATH=str(Path(executable).parent)+os.pathsep+os.environ.get('PATH',''))
        subprocess.run([str(installer),'-pack',project,'-version',selected,'-no-colours','-no-java','-auto','-force'],
                       cwd=ready,env=child_env,check=True,timeout=1800)
        argfiles=[]
        for namespace in ('minecraftforge/forge','neoforged/forge','neoforged/neoforge'):
            argfiles+=list(ready.glob('libraries/net/'+namespace+'/*/unix_args.txt'))
        if argfiles:
            if len(argfiles)!=1:
                raise ValueError('FTB generated ambiguous modern loader arguments')
            launch='unix_args.txt';shutil.copy2(argfiles[0],ready/launch)
        else:
            candidates=[p for pattern in ('forge-*.jar','fabric-*.jar','quilt-*.jar') for p in ready.glob(pattern) if 'installer' not in p.name]
            if (ready/'start-server.jar').is_file():candidates=[ready/'start-server.jar']
            if len(candidates)!=1:
                raise ValueError('FTB generated no unambiguous supported launch target')
            launch='start-server.jar'
            if candidates[0]!=ready/launch:shutil.copy2(candidates[0],ready/launch)
        agents=list(ready.glob('log4jfix/Log4jPatcher-*.jar'))
        if len(agents)>1:
            raise ValueError('FTB generated ambiguous Log4j agents')
        if agents:shutil.copy2(agents[0],ready/'log4jfix/Log4jPatcher.jar')
        identity={'provider':'ftb','project':project,'version':selected,'java':java,
                  'installer_sha256':installer_pin['sha256'],
                  'manifest_sha256':hashlib.sha256(json.dumps(release,sort_keys=True).encode()).hexdigest()}
        return publish(ready,root,identity,launch)


if __name__ == '__main__':
    import sys
    if len(sys.argv) != 2:
        raise ValueError('Pass the exact imported pack recipe')
    recipe = sys.argv[1]
    if recipe == 'minecraft/java/modrinth/egg-modrinth-generic.json':
        result = install_modrinth('/mnt/server', os.environ)
    elif recipe == 'minecraft/java/curseforge/egg-curse-forge-generic.json':
        result = install_curseforge('/mnt/server', os.environ)
    elif recipe == 'minecraft/java/ftb/egg-ftb-installer.json':
        result = install_ftb('/mnt/server', os.environ)
    else:
        result = install_technic(recipe, '/mnt/server', os.environ)
    print(json.dumps(result))
