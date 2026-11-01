"""SpongeForge-only staging; reuse shared acquisition and preservation primitives."""
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import java_fork_install as fork
from minecraft_pack_install import target, publish


def compatibility(version):
    match = re.fullmatch(r'(1\.\d+(?:\.\d+)?)-([0-9]+(?:\.[0-9]+)*)-([0-9]+(?:\.[0-9]+)+(?:-[A-Za-z0-9.]+)?)', version)
    if not match:
        raise ValueError('SpongeForge version must name Minecraft, Forge build and Sponge release')
    game, forge, sponge = match.groups()
    # Legacy Sponge filenames abbreviate Forge to its build number. Never
    # substitute a hard-coded build for the one selected by the operator.
    prefixes = {'1.12.2':'14.23.5', '1.12.1':'14.22.1', '1.11.2':'13.20.1',
                '1.10.2':'12.18.3', '1.9.4':'12.17.0', '1.8.9':'11.15.1'}
    if '.' not in forge:
        if game not in prefixes:
            raise ValueError('Unknown abbreviated Forge version; exact compatibility is required')
        forge = prefixes[game] + '.' + forge
        if game == '1.8.9':
            forge += '-1.8.9'
    return game, game + '-' + forge


def _install(root, env):
    import minecraft_install as minecraft
    import modded_java_install as modded
    # Fail before metadata/acquisition/writes. Consent remains operator supplied.
    if env.get('EULA_ACCEPTED') != 'true':
        raise ValueError('Accept the Minecraft EULA before installing')
    jar = env.get('SERVER_JARFILE', 'server.jar')
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}\.jar', jar):
        raise ValueError('Choose a safe server JAR filename')
    if env.get('USE_EXISTING_JAR', 'false') not in ('true', 'false'):
        raise ValueError('USE_EXISTING_JAR must be true or false')
    root = Path(root).resolve()
    if env.get('USE_EXISTING_JAR') == 'true':
        return fork.install('spongeforge', root, env)
    selected = env.get('SF_MC_VERSION', '1.20.6')
    if '-' in selected:
        compatibility(selected)
    elif not re.fullmatch(r'1\.\d+(?:\.\d+)?', selected):
        raise ValueError('Choose a Minecraft version or exact SpongeForge release')
    release = fork.resolve('spongeforge', env)
    game, forge = compatibility(release['version'])
    expected = 'spongeforge-' + release['version'] + '.jar'
    mods = target(root, 'mods')
    if mods.exists() and any(p.name.lower().startswith('spongeforge-') and p.name != expected for p in mods.glob('*.jar')):
        raise ValueError('Back up and remove the previous SpongeForge component explicitly; mods are never deleted')
    # Resolve all loader/runtime metadata before acquiring the Sponge artifact.
    plan = modded.resolve('forge', {'MC_VERSION':game, 'FORGE_VERSION':forge})
    state = target(root, '.voltra/spongeforge/work')
    state.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='install-', dir=state) as directory:
        work = Path(directory)
        ready = work / 'server'
        ready.mkdir()
        download = work / 'sponge.jar'
        checksum = fork.acquire(release, download, root)
        fork.jar_check(download, runnable=False)
        os.environ.setdefault('MAX_PLAYERS', '20')
        os.environ.setdefault('GAME_MODE', 'survival')
        os.environ.setdefault('DIFFICULTY', 'normal')
        minecraft.install(plan, ready, work_directory=state)
        # Shared installer may seed EULA in staging only; never publish consent.
        (ready / 'mods').mkdir(exist_ok=True)
        shutil.copy2(download, ready / 'mods' / expected)
        launch = 'unix_args.txt' if plan['launch'].startswith('@') else jar
        source = plan['launch'][1:] if launch == 'unix_args.txt' else plan['launch'].removeprefix('-jar ')
        shutil.copy2(target(ready, source), ready / launch)
        return publish(ready, root, {'provider':'spongeforge', 'version':release['version'],
                       'forge':forge, 'java':plan['java'], 'sha256':checksum}, launch)



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
    print(json.dumps(install('/mnt/server', os.environ)))

