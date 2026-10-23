#!/usr/bin/env python3
"""MIT. Original Arclight/Canvas/SpongeVanilla controls on shared safe Java assets."""
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.parse
from paper_family_install import fetch, metadata, inspect_jar
from limbo_install import confined, write, public_url
import minecraft_install as minecraft

PINNED = json.loads(Path(__file__).with_name('hybrid-java-releases.json').read_text())
ARCLIGHT = 'https://files.hypoglycemia.icu/v1/files/arclight/minecraft'
SPONGE = 'https://dl-api.spongepowered.org/v2/groups/org.spongepowered/artifacts/spongevanilla'
CANVAS = 'https://canvasmc.io/api/v2/builds/latest?project=canvas'


def identifier(value, label):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.+-]{0,119}', value):
        raise ValueError('Choose a valid ' + label)
    return value


def key_version(value):
    return tuple(int(x) if x.isdigit() else x for x in re.findall(r'\d+|[A-Za-z]+', value))


def arclight(env):
    pin = PINNED['arclight']
    version = env.get('MINECRAFT_VERSION', 'auto').strip() or 'auto'
    loader = env.get('ARCLIGHT_LOADER', 'forge').strip()
    channel = env.get('ARCLIGHT_CHANNEL', 'auto').strip() or 'auto'
    if loader not in ('forge', 'neoforge', 'fabric'):
        raise ValueError('Choose Forge, NeoForge or Fabric for Arclight')
    custom = env.get('DOWNLOAD_URL', '').strip()
    if custom:
        return {'project': 'arclight', 'version': version, 'loader': loader,
                'channel': channel, 'url': public_url(custom), 'custom': True}
    if version in ('auto', pin['version']) and loader == pin['loader'] and channel in ('auto', 'stable'):
        return dict(pin, project='arclight')
    beta = PINNED.get('arclight_beta', {})
    if beta and version in ('auto', beta['version']) and loader == beta['loader'] and channel == 'beta':
        return dict(beta, project='arclight')
    if version == 'auto':
        versions = sorted((x['name'] for x in metadata(ARCLIGHT)['files']), key=key_version, reverse=True)
        version = next((v for v in versions if any(x['name'] == loader for x in metadata(ARCLIGHT + '/' + identifier(v, 'Minecraft version') + '/loaders')['files'])), '')
        if not version:
            raise ValueError('No published Arclight version supports the selected loader')
    version = identifier(version, 'Minecraft version')
    base = ARCLIGHT + '/' + version + '/loaders/' + loader
    rows = metadata(base)['files']
    names = {x['name']: x for x in rows}
    choices = {'auto': ['latest-stable', 'versions-stable', 'latest-snapshot', 'versions-snapshot'],
               'stable': ['latest-stable', 'versions-stable'],
               'beta': ['latest-snapshot', 'versions-snapshot']}.get(channel, [identifier(channel, 'Arclight channel')])
    selected = next((names[name] for name in choices if name in names), None)
    if selected is None:
        raise ValueError('Selected Arclight channel is not published for this version and loader')
    url = base + '/' + selected['name']
    if selected['type'] == 'directory':
        builds = metadata(url)['files']
        if not builds:
            raise ValueError('Selected Arclight channel has no builds')
        selected = sorted(builds, key=lambda x: x.get('last-modified', ''), reverse=True)[0]
        url += '/' + identifier(selected['name'], 'Arclight build')
    return {'project': 'arclight', 'version': version, 'loader': loader, 'channel': channel, 'url': public_url(url)}


def canvas(env):
    pin = PINNED['canvas']
    version = env.get('MC_VERSION', 'latest').strip() or 'latest'
    build = env.get('CANVAS_BUILD', 'latest').strip() or 'latest'
    if version in ('latest', pin['version']) and build in ('latest', pin['build']):
        return dict(pin, project='canvas')
    if version == 'latest' or build == 'latest':
        row = metadata(CANVAS + ('' if version == 'latest' else '&channel=' + urllib.parse.quote(identifier(version, 'Minecraft version'), safe='')))
        if row.get('result') != 'SUCCESS':
            raise ValueError('Canvas publisher did not resolve this version')
        version = identifier(str(row['channelVersion']), 'Minecraft version')
        if build == 'latest':
            build = str(row['buildNumber'])
            return {'project': 'canvas', 'version': version, 'build': build, 'url': public_url(row['downloadUrl'])}
    identifier(version, 'Minecraft version')
    if not re.fullmatch(r'[1-9][0-9]{0,9}', build):
        raise ValueError('Canvas build must be latest or an exact positive build number')
    return {'project': 'canvas', 'version': version, 'build': build,
            'url': f'https://jenkins.canvasmc.io/job/Canvas/{build}/artifact/canvas-server/build/libs/canvas-build.{build}.jar',
            'version_identity': 'operator requested; verify running server version for historical exact Jenkins builds'}


def sponge(env):
    pin = PINNED['spongevanilla']
    version = env.get('SV_VERSION', 'recommended').strip() or 'recommended'
    if version in ('recommended', pin['release']):
        return dict(pin, project='spongevanilla')
    url = SPONGE + ('/latest?recommended=false' if version == 'latest' else '/versions/' + urllib.parse.quote(identifier(version, 'Sponge version'), safe=''))
    row = metadata(url)
    assets = [x for x in row['assets'] if x.get('extension') == 'jar' and x.get('classifier') == 'universal']
    if not assets:
        assets = [x for x in row['assets'] if x.get('extension') == 'jar' and not x.get('classifier')]
    if len(assets) != 1:
        raise ValueError('Sponge did not publish an unambiguous executable server asset')
    asset = assets[0]
    digest = asset.get('sha1', '')
    if not re.fullmatch('[0-9a-f]{40}', digest):
        raise ValueError('Sponge did not provide its publisher checksum')
    return {'project': 'spongevanilla', 'version': row['tags']['minecraft'], 'release': row['coordinates']['version'],
            'url': public_url(asset['downloadUrl']), 'algorithm': 'sha1', 'hash': digest}


def select(project, env):
    return {'arclight': arclight, 'canvas': canvas, 'spongevanilla': sponge}[project](env)


def install(root, project, env):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    jar = 'server.jar' if project == 'canvas' else env.get('SERVER_JARFILE', 'server.jar')
    # Java accepts executable ZIP/JAR files without a filename extension too.
    # Retain the exact original Sponge filename so startup matches publication.
    pattern = r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}' if project == 'spongevanilla' else r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,74}\.jar'
    if not re.fullmatch(pattern, jar):
        raise ValueError('Choose a server JAR filename confined to this volume')
    release = select(project, env)
    target = minecraft.safe_target(root, jar)
    cache = confined(root, '.voltra/hybrid-java/download.jar')
    receipt = confined(root, '.voltra/hybrid-java/release.json')
    properties = minecraft.safe_target(root, 'server.properties')
    expected = release.get('sha256', '')
    cached = bool(expected and cache.is_file() and hashlib.sha256(cache.read_bytes()).hexdigest() == expected)
    data = cache.read_bytes() if cached else fetch(release['url'])
    if release.get('hash') and hashlib.new(release['algorithm'], data).hexdigest() != release['hash']:
        raise ValueError('Publisher server JAR checksum mismatch')
    digest = hashlib.sha256(data).hexdigest()
    if expected and digest != expected:
        raise ValueError('Pinned server JAR SHA256 mismatch')
    main, major = inspect_jar(data)
    # Validate every managed path before touching the running program or receipt.
    # Native libraries, configs, worlds, mods/plugins and EULA remain owned data.
    write(cache, data)
    write(target, data)
    if not properties.exists():
        write(properties, b'server-ip=0.0.0.0\nserver-port=25565\nonline-mode=true\nmax-players=20\nmotd=A Minecraft server\n')
    source = urllib.parse.urlsplit(release['url'])._replace(query='').geturl()
    release.update(url=source, jar=jar, sha256=digest, bootstrap_main_class=main, bootstrap_class_major=major)
    write(receipt, (json.dumps(release, sort_keys=True, indent=2) + '\n').encode())
    print(json.dumps({'project': project, 'version': release['version'], 'sha256': digest, 'verified_download_cache_hit': cached, 'eula': 'operator choice preserved'}))


if __name__ == '__main__':
    import sys
    install(Path.cwd(), sys.argv[1], os.environ)
