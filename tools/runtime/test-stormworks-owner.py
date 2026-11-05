"""Exercise the exact emitted installer layout in isolated Python subprocesses."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

BASE = Path(__file__).resolve().parents[2]
REPORT = BASE / 'artifacts/game-parity-20261029/stormworks-owner'
profile = next(iter(json.loads((REPORT / 'profile-fragment.json').read_text()).values()))
script = profile['egg']['scripts']['installation']['script']
checks = []
with tempfile.TemporaryDirectory(prefix='stormworks-packaged-') as folder:
    root = Path(folder)
    for filename, marker, body in re.findall(r"cat > (\.voltra/[^ ]+) <<'([^']+)'\n(.*?)\n\2\n", script, re.S):
        path = root / filename
        path.parent.mkdir(exist_ok=True)
        path.write_text(body, encoding='utf-8')
    assert (root / '.voltra/steam_template.py').exists()
    environment = {k: v for k, v in os.environ.items() if k not in ('PYTHONPATH','PYTHONHOME')}
    environment.update(INSTALL_MODE='operator_files', SERVER_PORT='25564', VOLTRA_ALLOCATED_PORTS='25564,25565', AUTO_UPDATE='0')
    def call(args, changes=None):
        return subprocess.run([sys.executable, '-B', *args], cwd=root, env={**environment, **(changes or {})}, capture_output=True, text=True)
    def snapshot():
        return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}
    cli=['.voltra/stormworks-owner.py','install']
    for changes in ({'MAX_PLAYERS':'33'}, {'SERVER_PASSWORD':'x'*31}, {'STEAM64_ID':'bad'}, {'AUTO_UPDATE':'yes'}, {'VOLTRA_ALLOCATED_PORTS':'25564'}, {'SRCDS_APPID':'1'}, {'INSTALL_MODE':'bad'}, {'INSTALL_MODE':'steam','STEAM_USER':'example','STEAM_PASS':'not-a-real-secret'}):
        before=snapshot(); result=call(cli,changes)
        assert result.returncode != 0 and before == snapshot(), (changes,result.stderr)
        assert 'ModuleNotFoundError' not in result.stderr, result.stderr
    checks.append('eight invalid/prerequisite installer cases refuse without writes using emitted filenames')
    # This guarded run_path only defines the reviewed adapter. Its CLI does not run.
    harness="import runpy,os; from pathlib import Path; m=runpy.run_path('.voltra/stormworks-owner.py',run_name='fixture'); m['configure'](Path.cwd(),dict(os.environ))"
    result=call(['-c',harness],{'SERVER_NAME':'日本 & <server>','SERVER_PASSWORD':'secret&value'})
    assert result.returncode == 0,result.stderr
    config=root/'server_data/server_config.xml'
    import xml.etree.ElementTree as ET
    assert ET.fromstring(config.read_bytes()).get('name')=='日本 & <server>'
    body=config.read_bytes().replace(b'</server_data>',b'<!--operator--><unknown value="keep"/></server_data>')
    config.write_bytes(body)
    result=call(['-c',harness],{'SERVER_NAME':'changed','SERVER_PASSWORD':'different','MAX_PLAYERS':'5'})
    assert result.returncode == 0 and config.read_bytes()==body,result.stderr
    checks.append('seed escapes XML; subsequent starts preserve every byte, unknown element and comment')
    before=snapshot(); result=call(cli,{'SERVER_PORT':'25565','VOLTRA_ALLOCATED_PORTS':'25565,25566'})
    assert result.returncode != 0 and before==snapshot()
    checks.append('inactive allocation binding refuses before acquisition or writes')
    config.write_bytes(b'<!DOCTYPE server_data><server_data/>')
    before=snapshot(); result=call(cli)
    assert result.returncode != 0 and before==snapshot()
    checks.append('XML declarations refuse without changing malformed operator bytes')
json.dump({'scope':'focused offline emitted packaging only','checks':checks,'passed':len(checks)},open(REPORT/'offline-tests.json','w'),indent=2)
print(json.dumps(checks))
