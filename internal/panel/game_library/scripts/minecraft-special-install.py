#!/usr/bin/env python3
"""MIT integration. Publisher assets for four distinct Minecraft services."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile
from limbo_install import fetch, confined, write, public_url
from native_release import extract as extract_tar
from native_zip_release import extract as extract_zip

PINS = json.loads(Path(__file__).with_name('minecraft-special-releases.json').read_text())


def metadata(url):
    return json.loads(fetch(url, 8 * 1024**2))


def verified(root, release):
    digest = release['sha256']
    if not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('A reviewed SHA256 is required')
    cache = confined(root, '.voltra/minecraft-special/cache/' + digest)
    if cache.is_file() and hashlib.sha256(cache.read_bytes()).hexdigest() == digest:
        return cache.read_bytes()
    data = fetch(release['url'], 256 * 1024**2)
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Publisher asset SHA256 mismatch')
    write(cache, data)
    return data


def jar_name(value):
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\.jar', value):
        raise ValueError('Choose a confined server jar filename')
    return value


def seed(root, name, content, private=False):
    path = confined(root, name)
    if not path.exists():
        write(path, content.encode())
    if private:
        path.chmod(0o600)


def archive_install(root, game):
    release = PINS[game]
    state = confined(root, '.voltra/minecraft-special/staging')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=state) as temporary:
        stage = Path(temporary)
        archive = stage / 'archive'
        archive.write_bytes(verified(root, release))
        ready = stage / 'ready'
        ready.mkdir()
        if game == 'mcgalaxy':
            extract_zip(archive, ready, 'MCGalaxy')
        else:
            extract_tar(archive, ready, None)
        files = [(p, confined(root, p.relative_to(ready).as_posix())) for p in ready.rglob('*') if p.is_file()]
        executable = 'MCGalaxyCLI.exe' if game == 'mcgalaxy' else 'Cuberite'
        if not (ready / executable).is_file():
            raise ValueError('Publisher archive lacks its native executable')
        for source, target in files:
            # Plugins and bundled defaults become operator data after first install.
            replace = source.parent == ready and (source.suffix in ('.dll', '.exe') if game == 'mcgalaxy' else source.name == 'Cuberite')
            if replace or not target.exists():
                write(target, source.read_bytes())
                target.chmod(source.stat().st_mode & 0o777)
        if game == 'cuberite':
            confined(root, 'Cuberite').chmod(0o755)
            seed(root, 'settings.ini', '[Server]\nPorts=25565\nDescription=Voltra Cuberite\nMaxPlayers=20\n[Authentication]\nAuthenticate=1\n[Plugins]\nPlugin=Core\nPlugin=ChatLog\n')
            seed(root, 'webadmin.ini', '[WebAdmin]\nEnabled=1\nPorts=8080\n[User:admin]\nPassword=\n', True)
        else:
            seed(root, 'properties/server.properties', 'server-name = Voltra MCGalaxy\nmotd = Welcome\nport = 25565\npublic = false\nverify-names = true\n')
    write(confined(root, '.voltra/minecraft-special/licenses/' + game + '.txt'), verified(root, PINS[game + '_license']))
    return release


def purpur_release(env):
    pin = PINS['purpur']
    version, build = env.get('MINECRAFT_VERSION', pin['version']), env.get('BUILD_NUMBER', pin['build'])
    if version == 'latest':
        version = pin['version']
    if version == pin['version'] and build in ('latest', 'latest-stable', 'latest-successful', pin['build']):
        return dict(pin)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,30}', version):
        raise ValueError('Invalid exact Purpur version')
    if build in ('latest', 'latest-stable', 'latest-successful'):
        build = str(metadata('https://api.purpurmc.org/v2/purpur/' + version)['builds']['latest'])
    if not re.fullmatch('[0-9]{1,12}', build):
        raise ValueError('Invalid exact Purpur build')
    row = metadata(f'https://api.purpurmc.org/v2/purpur/{version}/{build}')
    if row.get('result') != 'SUCCESS' or str(row.get('build')) != build:
        raise ValueError('Purpur did not publish this exact successful build')
    # Historical releases require the operator's strong checksum; the API only supplies MD5.
    digest = env.get('DOWNLOAD_SHA256', '').lower()
    if not re.fullmatch('[0-9a-f]{64}', digest):
        raise ValueError('Historical Purpur build requires reviewed DOWNLOAD_SHA256')
    return {'version': version, 'build': build, 'url': f'https://api.purpurmc.org/v2/purpur/{version}/{build}/download', 'sha256': digest}


def crossplay(root, env):
    release = purpur_release(env)
    custom = env.get('DL_PATH', '').strip()
    if custom:
        for key, value in {'PROJECT': 'purpur', 'MINECRAFT_VERSION': release['version'], 'BUILD_NUMBER': release['build'], 'SERVER_JARFILE': jar_name(env.get('SERVER_JARFILE', 'server.jar'))}.items():
            custom = custom.replace('{{' + key + '}}', value).replace('${' + key + '}', value)
        if '{{' in custom or '${' in custom:
            raise ValueError('Unknown custom download placeholder')
        digest = env.get('DOWNLOAD_SHA256', '').lower()
        if not re.fullmatch('[0-9a-f]{64}', digest):
            raise ValueError('Custom jar requires reviewed DOWNLOAD_SHA256')
        release = {**release, 'url': public_url(custom), 'sha256': digest}
    assets = [(jar_name(env.get('SERVER_JARFILE', 'server.jar')), release), ('plugins/geyser-spigot.jar', PINS['geyser']), ('plugins/floodgate-spigot.jar', PINS['floodgate'])]
    prepared = [(confined(root, name), verified(root, asset)) for name, asset in assets]
    for target, data in prepared:
        if not zipfile.is_zipfile(io.BytesIO(data)):
            raise ValueError('Publisher did not provide a jar')
        write(target, data)
    seed(root, 'server.properties', 'server-ip=0.0.0.0\nserver-port=25565\nonline-mode=true\nmax-players=20\nmotd=Voltra Purpur Crossplay\n')
    seed(root, 'plugins/Geyser-Spigot/config.yml', 'bedrock:\n  address: 0.0.0.0\n  port: 19132\n  transport: both\n  webrtc-port: 19133\n  signaling:\n    mode: builtin\n    stun-discovery: false\njava:\n  auth-type: floodgate\n', True)
    for name in ('purpur', 'geyser', 'floodgate'):
        write(confined(root, '.voltra/minecraft-special/licenses/' + name + '.txt'), verified(root, PINS[name + '_license']))
    return {**release, 'plugins': {key: PINS[key] for key in ('geyser', 'floodgate')}}


def run(command, directory):
    options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    subprocess.run(command, cwd=directory, check=True, **options)


def build_patcher(root):
    state = confined(root, '.voltra/minecraft-special/build')
    patcher = confined(root, '.voltra/minecraft-special/VanillaCord.jar')
    receipt = confined(root, '.voltra/minecraft-special/patcher-build.json')
    sources = {key: PINS[key] for key in ('bridge', 'vanillacord')}
    if patcher.is_file() and receipt.is_file():
        previous = json.loads(receipt.read_text())
        if previous.get('sources') == sources and previous.get('sha256') == hashlib.sha256(patcher.read_bytes()).hexdigest():
            return patcher
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=state) as temporary:
        work = Path(temporary)
        for key, source in sources.items():
            archive = work / (key + '.zip')
            archive.write_bytes(verified(root, source))
            destination = work / key
            destination.mkdir()
            extract_zip(archive, destination, ('Bridge' if key == 'bridge' else 'VanillaCord') + '-' + source['commit'])
            for pom in destination.rglob('pom.xml'):
                text = pom.read_text().replace('-PLACEHOLDER', '24w25a')
                # The public source completely replaces the unavailable Maven host.
                text = re.sub(r'<(?:pluginRepositories|repositories)>.*?</(?:pluginRepositories|repositories)>', '', text, flags=re.S)
                pom.write_text(text)
        # Mojang authlib is a provided compilation dependency, not redistributed.
        pom = work / 'vanillacord/pom.xml'
        text = pom.read_text().replace('<dependencies>', '<repositories><repository><id>minecraft</id><url>https://libraries.minecraft.net/</url></repository></repositories><dependencies>', 1)
        pom.write_text(text)
        maven_archive = work / 'maven.zip'
        maven_archive.write_bytes(verified(root, PINS['maven']))
        maven_home = work / 'maven'
        maven_home.mkdir()
        extract_zip(maven_archive, maven_home, 'apache-maven-3.9.11')
        (maven_home / 'bin/mvn').chmod(0o755)
        maven = [str(maven_home / ('bin/mvn.cmd' if os.name == 'nt' else 'bin/mvn')), '-B', '-ntp', '-Dmaven.test.skip=true', '-Dmaven.javadoc.skip=true', '-Dmaven.repo.local=' + str(state / 'm2')]
        for module in ('bridge-asm', 'bridge-plugin', 'bridge'):
            run(maven + ['install'], work / 'bridge' / module)
        run(maven + ['package'], work / 'vanillacord')
        data = (work / 'vanillacord/artifacts/VanillaCord.jar').read_bytes()
        write(patcher, data)
        write(receipt, (json.dumps({'sources': sources, 'sha256': hashlib.sha256(data).hexdigest(), 'licenses': 'VanillaCord and Bridge MPL-2.0; complete source archives retained in verified cache'}, indent=2) + '\n').encode())
        for key in sources:
            write(confined(root, '.voltra/minecraft-special/licenses/' + key + '.txt'), (work / key / 'LICENSE').read_bytes())
    return patcher


def vanillacord(root, env):
    version = env.get('VANILLA_VERSION', '1.21.4')
    manifest = metadata('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')
    if version == 'latest':
        version = manifest['latest']['release']
    selected = next((x for x in manifest['versions'] if x['id'] == version), None)
    if selected is None:
        raise ValueError('Exact Mojang version is not published')
    data = fetch(selected['url'], 8 * 1024**2)
    if hashlib.sha1(data).hexdigest() != selected['sha1']:
        raise ValueError('Mojang version metadata checksum mismatch')
    release = json.loads(data)['downloads']['server']
    if not re.fullmatch('[0-9a-f]{40}', release.get('sha1', '')):
        raise ValueError('Mojang server publisher checksum missing')
    cached_server = confined(root, '.voltra/minecraft-special/mojang/' + release['sha1'] + '.jar')
    server = cached_server.read_bytes() if cached_server.is_file() else fetch(release['url'], 256 * 1024**2)
    if hashlib.sha1(server).hexdigest() != release['sha1']:
        raise ValueError('Mojang server checksum mismatch')
    write(cached_server, server)
    patcher = build_patcher(root)
    state = confined(root, '.voltra/minecraft-special/patching')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=state) as temporary:
        work = Path(temporary)
        (work / 'input.jar').write_bytes(server)
        run(['java', '-cp', str(patcher), 'vanillacord.Patcher', 'input.jar', 'output.jar'], work)
        output = (work / 'output.jar').read_bytes()
        write(confined(root, jar_name(env.get('SERVER_JARFILE', 'server.jar'))), output)
    seed(root, 'server.properties', 'server-ip=0.0.0.0\nserver-port=25565\nonline-mode=true\nmax-players=20\nmotd=Voltra VanillaCord\n')
    return {'version': version, 'mojang_sha1': release['sha1'], 'patched_sha256': hashlib.sha256(output).hexdigest(), 'source': PINS['vanillacord'], 'java': json.loads(data).get('javaVersion', {})}


def install(root, game, env):
    root = Path(root).resolve()
    receipt = confined(root, '.voltra/minecraft-special/release.json')
    if game in ('mcgalaxy', 'cuberite'):
        release = archive_install(root, game)
    elif game == 'crossplay':
        release = crossplay(root, env)
    elif game == 'vanillacord':
        release = vanillacord(root, env)
    else:
        raise ValueError('Unknown exact Minecraft service')
    write(receipt, (json.dumps({'game': game, **release}, indent=2) + '\n').encode())
    print('Verified ' + game + ' installed; operator configurations, worlds, plugins and private identities retained.')


if __name__ == '__main__':
    import sys
    install(Path.cwd(), sys.argv[1], os.environ)
