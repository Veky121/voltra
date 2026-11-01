"""Scoped legacy Magma adapter; shared acquisition and publication remain authoritative."""
import os
from pathlib import Path
import re


def _install(root, env):
    # No network, directory creation, or publication before input validation.
    if env.get('EULA_ACCEPTED') != 'true':
        raise ValueError('Accept the Minecraft EULA explicitly before installing Magma')
    game = env.get('MC_VERSION', '1.20.1') or '1.20.1'
    if game not in ('1.12.2', '1.18.2', '1.19.3', '1.20.1'):
        raise ValueError('Unsupported legacy Magma Minecraft version; no cross-loader substitution')
    jar = env.get('SERVER_JARFILE', 'server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}\.jar', jar):
        raise ValueError('Choose a safe server JAR filename')
    if env.get('USE_EXISTING_JAR', 'false') not in ('true', 'false'):
        raise ValueError('USE_EXISTING_JAR must be true or false')
    tag = env.get('TAG_VERSION', 'latest') or 'latest'
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]{0,127}', tag):
        raise ValueError('Choose a literal publisher tag')
    import java_fork_install as fork
    from minecraft_pack_install import target
    root = Path(root)
    # Refuse path hazards before metadata/acquisition. Existing bytes always win.
    for name in (jar, 'server.properties', 'eula.txt', '.voltra/java-forks/work'):
        target(root, name)
    original = fork.publish

    def publish(staging, destination, identity, launch):
        # Defaults participate in the shared rollback/preservation transaction.
        properties = Path(staging) / 'server.properties'
        if not properties.exists():
            properties.write_text('server-ip=0.0.0.0\nserver-port=25565\nonline-mode=true\n'
                                  'enable-query=false\nenable-rcon=false\n', encoding='utf-8')
        return original(staging, destination, identity, launch)

    fork.publish = publish
    try:
        return fork.install('magma', root, env)
    finally:
        fork.publish = original



def consent_existing(root, env):
    from pathlib import Path
    path = Path(root) / 'eula.txt'
    if path.is_symlink():
        raise ValueError('Refusing symlink EULA file')
    value = env.get('EULA_ACCEPTED')
    if value == 'true':
        return
    if value is not None:
        raise ValueError('Minecraft EULA consent is revoked or invalid')
    if path.is_file():
        lines = path.read_text(encoding='utf-8-sig').splitlines()
        choices = [line.split('=', 1)[1].strip().lower() for line in lines
                   if line.strip() and not line.lstrip().startswith(('#', '!'))
                   and line.split('=', 1)[0].strip() == 'eula' and '=' in line]
        if choices and choices[-1] == 'true':
            return
    raise ValueError('Explicit Minecraft EULA consent required')


def install(root, env):
    from pathlib import Path
    consent_existing(root, env)
    result = _install(root, {**env, 'EULA_ACCEPTED': 'true'})
    path = Path(root) / 'eula.txt'
    # Exclusive creation preserves operator bytes, including explicit false.
    if not path.exists():
        with path.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write('eula=true\n')
    return result

if __name__ == '__main__':
    import json
    print(json.dumps(install('/mnt/server', os.environ)))
