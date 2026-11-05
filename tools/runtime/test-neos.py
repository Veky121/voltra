"""Execute the staged shell installer and startup using offline payload stubs, Linux only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

out = Path('artifacts/game-parity-20261029/neos-installer-followup')
recipe = 'neosvr/egg-neos-v-r.json'
profile = json.loads((out/'profile.pending.json').read_text())[recipe]
canonical = json.loads(Path('internal/panel/game_library/overrides.json').read_text())[recipe]
assert profile['variables'] == canonical['variables'] if 'variables' in profile else profile['egg']['variables'] == canonical['egg']['variables']
assert profile['egg']['docker_images'] == canonical['egg']['docker_images']
emitted = json.loads((out/'emitted.pending.json').read_text())
count = 0
with tempfile.TemporaryDirectory(prefix='neos-installer-') as folder:
    root = Path(folder)
    bin = root/'bin'; bin.mkdir()
    mono = bin/'mono'
    mono.write_text('#!/bin/sh\nprintf "offline mono stub reached\\n"\nexit 17\n'); mono.chmod(0o755)
    env = {**os.environ, 'PATH': str(bin)+':'+os.environ['PATH'], 'AUTO_UPDATE':'0', 'SERVER_PORT':'28000', 'VOLTRA_ALLOCATED_PORTS':'28000', 'PYTHONDONTWRITEBYTECODE':'1'}
    for key in ('VOLTRA_STEAM_AUTO_UPDATE', 'SRCDS_APPID', 'SRCDS_BETAID', 'ENABLE_MODLOADER'):
        env.pop(key, None)
    server = root/'server'; server.mkdir()
    def snap():
        return {str(p.relative_to(server)):'symlink:'+os.readlink(p) if p.is_symlink() else hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else 'directory' for p in server.rglob('*')}
    # Only mount path relocated; execute the actual emitted shell and Python body.
    install = profile['egg']['scripts']['installation']['script'].replace('cd /mnt/server', 'cd '+str(server))
    def call(start=False, changes=None):
        return subprocess.run(['bash','-c',profile['egg']['startup'] if start else install],cwd=server,env={**env, **(changes or {})},capture_output=True,text=True,timeout=20)
    def refuses(changes=None):
        global count
        before = snap()
        for start in (False, True) if (server/'.voltra').exists() else (False,):
            result = call(start, changes)
            assert result.returncode != 0, result.stdout
            assert 'offline mono stub reached' not in result.stdout
            assert snap() == before
        count += 1
    refuses()  # Missing payload.
    (server/'Neos.exe').write_bytes(b'not a native payload')
    refuses()  # No authoritative config, never seed.
    config = server/'Config/Config.json'; config.parent.mkdir()
    good = b'\xef\xbb\xbf{\r\n"startWorlds":[{"forcePort":28000,"unknown":[1,2]}],"password":"private","unknown":true}\r\n'
    for data in (b'{bad', b'{"startWorlds":[],"startWorlds":[]}', b'{"startWorlds":[{}]}', b'{"startWorlds":[{"forcePort":true}]}'):
        config.write_bytes(data); refuses()
    config.write_bytes(good)
    for name in ('Saves/world.bin','nml_mods/custom.dll','NeosModLoaderHeadless.dll','nml_libs/0Harmony.dll'):
        p = server/name; p.parent.mkdir(exist_ok=True); p.write_bytes(b'operator\x00\xff')
    before = snap()
    result = call(); assert result.returncode == 0, result.stderr
    for name, content in emitted.items():
        assert (server/'.voltra'/name).read_bytes() == content.encode()
    assert all(snap()[k] == v for k,v in before.items())
    installed = snap()
    assert call().returncode == 0
    assert snap() == installed
    for changes in ({'AUTO_UPDATE':'1'}, {'SERVER_PORT':'1'}, {'SRCDS_BETAID':'other'}, {'AUTO_UPDATE':'maybe'}):
        refuses(changes)
    for changes in ({}, {'ENABLE_MODLOADER':'true'}):
        result = call(True, changes)
        assert result.returncode == 17, result.stderr
        assert 'offline mono stub reached' in result.stdout
        assert snap() == installed
        count += 1
    # Reject a symlinked emission destination without changing existing files.
    (server/'.voltra/neos_runtime.py').unlink()
    (server/'.voltra/neos_runtime.py').symlink_to(root/'outside.py')
    before = snap()
    result = call(); assert result.returncode != 0
    assert not (root/'outside.py').exists()
    assert snap() == before
    count += 1
result = {'passed_groups':count, 'native_executed':False, 'temporary_fixtures':'cleaned', 'shell_mount_path_relocated':True}
(out/'test-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
