"""Source candidate: seed once, compile native commands, reuse Steam/console helpers."""
import importlib.util
import os
from pathlib import Path
import re
import sys

def helper(name):
    path = Path(__file__).with_name(name + '.py')
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

shared = helper('steam-native-next')
NAME = 'hurtworld-startup.cfg'

def commands(data):
    if len(data) > 65536: raise ValueError('Command document too large')
    text = data.decode('utf-8')
    if any(ord(c) < 32 and c not in '\t\r\n' or ord(c) == 127 or c in '\u0085\u2028\u2029' for c in text): raise ValueError('Invalid command encoding')
    if '\r' in text.replace('\r\n', ''): raise ValueError('Invalid line ending')
    result = []; seen = set()
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'): continue
        match = re.fullmatch(r'\s*([A-Za-z_][A-Za-z0-9_]*)[ \t]+("[^"\\]*"|[^ \t"\\;]+)[ \t]*(?:#.*)?', line)
        if not match: raise ValueError('Unsupported native command syntax')
        key, value = match.groups(); value = value.strip('"')
        if key.lower() in ('host','queryport','exec','alias','bind'): raise ValueError('Conflicting native command')
        if any(c in value for c in ';"\\'): raise ValueError('Unsafe command value')
        if key.lower() in ('servername','maxplayers','creativemode'):
            if key != key.lower() or key in seen: raise ValueError('Duplicate or ambiguous setting')
            seen.add(key)
            if key == 'servername' and (not value or len(value.encode('utf-8')) > 50 or value.strip() != value): raise ValueError('Invalid server name')
            if key == 'maxplayers' and (not re.fullmatch('[1-9][0-9]*',value) or not 1 <= int(value) <= 2147483647): raise ValueError('Invalid player limit')
            if key == 'creativemode' and value not in ('0','1'): raise ValueError('Invalid creative mode')
        result.append(key + ' ' + value)
    if seen != {'servername','maxplayers','creativemode'}: raise ValueError('Missing native setting')
    return result

def prepare(root, env):
    root = Path(root).resolve()
    if env.get('SRCDS_APPID','405100') != '405100': raise ValueError('Wrong native Steam application')
    ports = shared.roles(env, ['QUERY_PORT'])
    target = shared.confined(root, root / NAME)
    # The publisher's implicit autoexec precedence is unproved. A concrete
    # conflicting command there requires operator reconciliation, not migration.
    auto = shared.confined(root, root / 'autoexec.cfg')
    if auto.exists():
        content = auto.read_text(encoding='utf-8')
        if re.search(r'(?im)^\s*(?:servername|maxplayers|creativemode|host|queryport|exec|alias)\b', content): raise ValueError('Conflicting autoexec commands')
    if target.exists(): data = target.read_bytes()
    else:
        _, _ = shared.configure(root, 'hurtworld', env)  # Validate original seed controls.
        name = shared.text(env,'HOSTNAME','A Hurtworld Server',50)
        data = ('servername "'+name+'"\nmaxplayers '+str(shared.integer(env,'MAX_PLAYERS',60,1,2147483647))+'\ncreativemode '+str(shared.integer(env,'CREATIVE_MODE',0,0,1))+'\n').encode()
        admin = shared.text(env,'ADMINS','',17)
        if admin: data += ('addadmin '+admin+'\n').encode()
    compiled = commands(data)
    if not target.exists():
        # Exclusive create: never overwrite an operator edit racing first seed.
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd,'wb') as out: out.write(data)
    argv = [str(root/'Hurtworld.x86_64'),'-batchmode','-nographics','-exec',';'.join(['host '+str(ports['primary']),'queryport '+str(ports['QUERY_PORT']),*compiled]),'-logfile','-']
    return argv

def run(root, env):
    auto = env.get('VOLTRA_STEAM_AUTO_UPDATE','0')
    if auto not in ('0','1'): raise ValueError('Invalid auto update')
    argv = prepare(root, env)  # Refuse invalid config before an update download.
    if auto == '1': shared.install(root,'hurtworld',env)
    argv = prepare(root,env)
    environment = dict(os.environ, HOME=str(root))
    for key in ('PYTHONHOME','PYTHONPATH','LD_PRELOAD','LD_LIBRARY_PATH'): environment.pop(key,None)
    # Redact all values, including unknown plugin credentials, without logging config.
    secrets = [part.partition(' ')[2] for part in commands((Path(root)/NAME).read_bytes())]
    code = shared.helper('native-console').run(root,argv,environment,'\x03',secrets,terminal_input=True)
    return code if code >= 0 else 128-code

if __name__ == '__main__':
    try:
        if sys.argv[1:] != ['run']: raise ValueError('Unsupported action')
        sys.exit(run(Path.cwd(),dict(os.environ)))
    except (ValueError,OSError,UnicodeError):
        print('Hurtworld startup refused; review native command document, conflicting autoexec and allocations.',file=sys.stderr)
        sys.exit(1)
