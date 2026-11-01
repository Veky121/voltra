#!/usr/bin/env python3
"""SpongeVanilla acquisition using existing Java download and preservation helpers."""
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.parse
import hybrid_java_install as shared


def select(env):
    version = env.get('SV_VERSION', 'recommended').strip() or 'recommended'
    pin = shared.PINNED['spongevanilla']
    if version == pin['release']:
        return dict(pin, project='spongevanilla')
    suffix = ('/latest?recommended=' + str(version == 'recommended').lower()
              if version in ('latest', 'recommended') else
              '/versions/' + urllib.parse.quote(shared.identifier(version, 'Sponge version'), safe=''))
    row = shared.metadata(shared.SPONGE + suffix)
    release = row['coordinates']['version']
    if version not in ('latest', 'recommended') and release != version:
        raise ValueError('Publisher returned a different Sponge version')
    assets = [a for a in row['assets'] if a.get('extension') == 'jar'
              and a.get('classifier') == 'universal']
    if not assets:
        assets = [a for a in row['assets'] if a.get('extension') == 'jar'
                  and not a.get('classifier')]
    if len(assets) != 1 or not re.fullmatch('[0-9a-f]{40}', assets[0].get('sha1', '')):
        raise ValueError('Publisher must provide one executable JAR with a SHA1 checksum')
    return dict(project='spongevanilla', version=row['tags']['minecraft'], release=release,
                url=shared.public_url(assets[0]['downloadUrl']), algorithm='sha1', hash=assets[0]['sha1'])


def install(root, env):
    root = Path(root).resolve()
    jar = env.get('SERVER_JARFILE', 'server.jar')
    # Extensionless JARs remain supported. Never replace native documents or saves.
    if (not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}', jar)
            or jar.lower() in {'eula.txt', 'server.properties', 'ops.json', 'whitelist.json',
                               'banned-ips.json', 'banned-players.json', 'usercache.json'}
            or jar.lower().endswith(('.txt', '.properties', '.json', '.conf', '.toml', '.yml', '.yaml'))):
        raise ValueError('Choose a JAR filename that does not replace a configuration file')
    root.mkdir(parents=True, exist_ok=True)
    target = shared.minecraft.safe_target(root, jar)
    paths = [root / '.voltra' / 'spongevanilla' / n for n in ('download.jar', 'release.json')]
    for path in [target, *paths]:
        if path.exists() and not path.is_file():
            raise ValueError('Managed JAR path is not a file')
        current = path
        while current != root:
            if current.is_symlink():
                raise ValueError('Managed JAR path contains a symlink')
            current = current.parent
    release = select(env)
    cache, receipt = paths
    expected = release.get('sha256')
    cached = bool(expected and cache.is_file() and hashlib.sha256(cache.read_bytes()).hexdigest() == expected)
    data = cache.read_bytes() if cached else shared.fetch(release['url'])
    if hashlib.new(release['algorithm'], data).hexdigest() != release['hash']:
        raise ValueError('Publisher JAR checksum mismatch')
    digest = hashlib.sha256(data).hexdigest()
    if expected and digest != expected:
        raise ValueError('Pinned JAR checksum mismatch')
    main, major = shared.inspect_jar(data)
    shared.write(cache, data)
    shared.write(target, data)
    release.update(sha256=digest, jar=jar, bootstrap_main_class=main, bootstrap_class_major=major)
    shared.write(receipt, (json.dumps(release, indent=2) + '\n').encode())
    # Native files, including absent EULA/properties, belong to the game/operator.
    print(json.dumps({'project': 'spongevanilla', 'release': release['release'], 'cache_hit': cached}))


if __name__ == '__main__':
    install(Path.cwd(), os.environ)
