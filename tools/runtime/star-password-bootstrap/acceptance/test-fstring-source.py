#!/usr/bin/env python3
"""MIT. Exact-source ownership/callback contracts; no native trial."""
import hashlib
import json
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[3]
sources={}
for name in ('star-password-bootstrap-candidate-source.json','star-binding-deep-source.json','star-fstring-deep-source.json'):
    manifest=json.loads((ROOT/'artifacts'/name).read_text())
    assert manifest['commit']=='8333063595fa3c49ad307f3b0f732accbb760d25'
    for row in manifest['files']:
        body=(ROOT/row['archive']).read_bytes();assert hashlib.sha256(body).hexdigest()==row['sha256'];sources[row['path']]=body.decode()
wrapper=sources['UE4SS/include/LuaType/LuaUnrealString.hpp']
assert 'class TLuaStringBase : public LocalObjectBase<UnrealStringType, StringNameType>' in wrapper
assert 'BaseClass(std::move(UnrealStringType(*object)))' in wrapper
assert 'lua.transfer_stack_object(std::move(lua_object)' in wrapper
local=sources['deps/first/LuaMadeSimple/include/LuaMadeSimple/LuaObject.hpp']
assert 'ObjectType m_local_storage;' in local and 'm_local_storage(object)' in local
lua=sources['deps/first/LuaMadeSimple/include/LuaMadeSimple/LuaMadeSimple.hpp']
assert 'new (userdata) ObjectType(std::move(object));' in lua
assert 'userdata->~ObjectType();' in lua
obj=sources['UE4SS/include/LuaType/LuaUObject.hpp']
assert 'is_object_in_global_unreal_object_map(lua_object.get_remote_cpp_object()) && !lua_object.get_remote_cpp_object()->IsUnreachable()' in obj
mod=sources['UE4SS/src/Mod/LuaMod.cpp']
start=mod.index('static auto process_simple_actions(');end=mod.index('// Process pending NotifyOnNewObject',start);actions=mod[start:end]
assert actions.index('to_run = std::move(actions);')<actions.index('lua_data.lua->call_function(0, 0);')
assert 'if (LuaMod::m_is_currently_executing_game_action)' in actions
assert actions.index('lua_data.lua->call_function(0, 0);')<actions.index('luaL_unref(')
assert 'return {mod->m_hook_lua, thread_ref};' in mod
subprocess.run([str(ROOT/'.local/star-password-bootstrap-tests/lua.exe'),str(HERE/'test-return-lifetime.lua')],check=True,timeout=30)
print('PASS exact string local ownership, GC, strong UObject validity and callback guards; no native attribution')
