#!/usr/bin/env python3
"""Offline exact-source checks plus executable Lua contract regression cases."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
manifest = json.loads((ROOT / 'artifacts/star-password-bootstrap-candidate-source.json').read_text())
assert manifest['commit'] == '8333063595fa3c49ad307f3b0f732accbb760d25'
sources = {}
for row in manifest['files']:
    body = (ROOT / row['archive']).read_bytes()
    assert hashlib.sha256(body).hexdigest() == row['sha256'], row['path']
    sources[row['path']] = body.decode()
cpp = sources['UE4SS/src/LuaType/LuaUObject.cpp']
header = sources['UE4SS/include/LuaType/LuaUObject.hpp']
assert 'if (!is_first_userdata_function && lua_object2.derives_from_function())' in cpp
assert 'calling_context = lua_object.get_remote_cpp_object();' in cpp
assert 'LuaMadeSimple::Type::special_invalid_ptr()' in cpp
assert 'table.add_pair("CallFunction"' in header
assert 'return call_ufunction_from_lua(lua);' in header
lua = ROOT / '.local/star-password-bootstrap-tests/lua.exe'
with tempfile.TemporaryDirectory(prefix='star-binding-offline-') as tmp:
    for mode in ('good', 'truthy_missing', 'second_invalid', 'second_resolve_error', 'invoke_error', 'component_invalidated'):
        (Path(tmp) / mode / 'Scripts').mkdir(parents=True)
    result = subprocess.run([str(lua), str(HERE / 'test-binding-contract.lua'),
                             str(HERE / 'diagnostic-main.lua'), Path(tmp).as_posix()],
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    print(result.stdout.strip())
print(f"PASS {len(sources)} exact-source hashes; CallFunction receiver/function form is supported")
