"""HogWarp operator-payload adapter; no acquisition or native acceptance claim."""
import json
import os
import platform
from pathlib import Path
import shutil
import signal
from native_console import run
from publisher_install import confined
from publisher_runtime import read_json, child_environment, write_config


def plan(root, env, *, runtime=True):
    root = Path(root).resolve()
    if platform.machine().lower() not in ('amd64', 'x86_64'):
        raise ValueError('Requires x86-64 Wine host; ARM64 emulation is not accepted here')
    if env.get('WINEARCH', 'win64') != 'win64' or env.get('WINETRICKS_RUN', 'dotnet7') != 'dotnet7':
        raise ValueError('Retain win64/dotnet7 prerequisites')
    wine = shutil.which('wine')
    if runtime and (not wine or not os.environ.get('DISPLAY')):
        raise ValueError('Wine and headless display prerequisites required')
    candidates = [confined(root, n) for n in ('HogWarpServer.exe', 'Server.Loader.exe') if confined(root, n).is_file()]
    if len(candidates) != 1:
        raise ValueError('Provide exactly one original or current publisher executable')
    # Inspect PE machine rather than assuming a Windows executable is ARM compatible.
    with candidates[0].open('rb') as f:
        header = f.read(64)
        if len(header) != 64 or header[:2] != b'MZ':
            raise ValueError('Expected publisher PE payload')
        f.seek(int.from_bytes(header[60:64], 'little'))
        if f.read(6) != b'PE\0\0\x64\x86':
            raise ValueError('Expected x86-64 PE payload')
    target = confined(root, 'config.json')
    if not target.is_file():
        raise ValueError('Supply publisher-generated config.json while stopped; no bootstrap execution')
    data = read_json(root, 'config.json')
    before = target.read_bytes()
    known = ('ApiKey', 'Name', 'Port', 'Description', 'MaxPlayer', 'IconUrl')
    if any(k not in known and k.casefold() in {x.casefold() for x in known} for k in data):
        raise ValueError('Ambiguous native key casing')
    defaults = dict(zip(known, (env.get('API_KEY', 'CHANGEME'), env.get('SERV_NAME', 'Ptero Hogwarp Server'), int(env.get('SERVER_PORT', '11778')), env.get('SERV_DESC', ''), int(env.get('MAX_PLAYERS', '4')), env.get('SERV_ICON', ''))))
    effective = defaults | data
    for k in ('ApiKey', 'Name', 'Description', 'IconUrl'):
        if not isinstance(effective[k], str) or any(ord(c) < 32 for c in effective[k]):
            raise ValueError('Invalid native text field: ' + k)
    if not effective['ApiKey'] or effective['ApiKey'].casefold() in ('changeme', 'change-me'):
        raise ValueError('Configure private real API key; no credential is generated')
    for k, minimum, maximum in (('Port', 1, 65535), ('MaxPlayer', 1, 2147483647)):
        if type(effective[k]) is not int or not minimum <= effective[k] <= maximum:
            raise ValueError('Invalid native numeric field: ' + k)
    if effective['Port'] != int(env.get('SERVER_PORT', '11778')) or effective['Port'] not in {int(p) for p in env.get('VOLTRA_ALLOCATED_PORTS', '').split(',') if p}:
        raise ValueError('Native port must match primary allocation; reconcile while stopped')
    debug = env.get('WINEDEBUG', '-all')
    import re
    if not re.fullmatch(r'[A-Za-z0-9_+,-]*', debug):
        raise ValueError('Invalid Wine debug channels')
    for n in ('plugins', '.wine'):
        confined(root, n)
    # Insert only missing keys: keep BOM, unknown numeric lexemes, arrays and whitespace.
    missing = {k: defaults[k] for k in known if k not in data}
    body = before.decode('utf-8-sig')
    end = body.rfind('}')
    added = ((',' if data else '') + json.dumps(missing, ensure_ascii=False)[1:-1]) if missing else ''
    after = (b'\xef\xbb\xbf' if before.startswith(b'\xef\xbb\xbf') else b'') + (body[:end] + added + body[end:]).encode()
    child = child_environment(root, env)
    child.update(WINEARCH='win64', WINEDEBUG=debug, WINEDLLOVERRIDES='mscoree=n,b;mshtml=n,b', WINEPREFIX=str(root / '.wine'))
    return before, after, [wine, str(candidates[0])], child, effective['ApiKey']


def main(root, env):
    before, after, argv, child, key = plan(root, env)
    if confined(root, 'config.json').read_bytes() != before:
        raise ValueError('Native config changed during preflight')
    write_config(root, 'config.json', after)
    return run(root, argv, child, '\x03', credentials=[key], ready_marker=b'Server started on port ', terminal_input=True, stop_signal=signal.SIGINT)


def install(root, env, modules):
    """Validate supplied payload first, then publish only managed helper modules.

    Handled publication failures restore earlier helper bytes. This is not a
    crash-atomic transaction. Payload/config/worlds/plugins are never installed.
    """
    if env.get('ACQUISITION_MODE', 'publisher') != 'operator':
        raise ValueError('Select existing operator acquisition control and supply lawful files; publisher download is disabled')
    if env.get('OPERATOR_ARCHIVE'):
        raise ValueError('Extract and inspect the lawful payload yourself; archive acquisition is disabled')
    plan(root, env, runtime=False)
    from steam_template import _publish
    root = Path(root).resolve()
    names = sorted(modules)
    if any(not n.endswith('.py') or '/' in n or '\\' in n or n.startswith('.') for n in names):
        raise ValueError('Invalid managed module name')
    previous = {}
    for name in names:
        target = confined(root, '.voltra/' + name)
        if target.exists() and not target.is_file():
            raise ValueError('Managed module destination is not a regular file')
        previous[name] = target.read_bytes() if target.exists() else None
    changed = []
    try:
        for name in names:
            if previous[name] == modules[name]:
                continue
            changed.append(name)
            _publish(root, '.voltra/' + name, lambda f, data=modules[name]: f.write(data))
    except BaseException:
        for name in reversed(changed):
            if previous[name] is None:
                confined(root, '.voltra/' + name).unlink(missing_ok=True)
            else:
                _publish(root, '.voltra/' + name, lambda f, data=previous[name]: f.write(data))
        raise


if __name__ == '__main__':
    import sys
    if len(sys.argv) == 3 and sys.argv[1] == '--install':
        source = Path(__file__).parent
        install(Path(sys.argv[2]), dict(os.environ), {p.name: p.read_bytes() for p in source.glob('*.py')})
    elif len(sys.argv) == 1:
        raise SystemExit(main(Path.cwd(), dict(os.environ)))
    else:
        raise SystemExit('Unsupported Hogwarp invocation')
