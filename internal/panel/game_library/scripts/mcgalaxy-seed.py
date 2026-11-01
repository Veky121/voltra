"""MCGalaxy-only native settings seed. Later boots retain operator authority."""
import os
from pathlib import Path
from native_config import private_write


def configure(root, env):
    target = root / 'properties/server.properties'
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('MCGalaxy properties must stay inside the server volume')
    if target.exists():
        return
    values = {'server-name': env.get('HOSTNAME', 'Voltra MCGalaxy'),
              'motd': env.get('MOTD', 'Welcome'),
              'public': env.get('PUBLIC_SERVER', 'false'), 'verify-names': 'true'}
    if values['public'] not in ('true', 'false'):
        raise ValueError('PUBLIC_SERVER must be true or false')
    if any(any(ord(c) < 32 or ord(c) == 127 for c in v) for v in values.values()):
        raise ValueError('MCGalaxy settings must be single-line text')
    private_write(target, ''.join(k + ' = ' + v + '\n' for k, v in values.items()))


if __name__ == '__main__':
    configure(Path.cwd(), os.environ)
