#!/usr/bin/env python3
"""MIT. Compile exact extracted marker methods in a minimal C++ contract model.

No Unreal headers, offsets, binary hooks or engine are used. This proves the
source marker mismatch, not which error occurred in an earlier game process.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[3]
sources={}
for name in ('star-binding-deep-source.json','star-password-bootstrap-candidate-source.json'):
    manifest=json.loads((ROOT/'artifacts'/name).read_text())
    assert manifest['commit']=='8333063595fa3c49ad307f3b0f732accbb760d25'
    for row in manifest['files']:
        body=(ROOT/row['archive']).read_bytes()
        assert hashlib.sha256(body).hexdigest()==row['sha256']
        sources[row['path']]=body.decode()
header=sources['UE4SS/include/LuaType/LuaUObject.hpp']
function=sources['UE4SS/include/LuaType/LuaUFunction.hpp']
cpp=sources['UE4SS/src/LuaType/LuaUObject.cpp']
fcpp=sources['UE4SS/src/LuaType/LuaUFunction.cpp']
lua=sources['deps/first/LuaMadeSimple/include/LuaMadeSimple/LuaMadeSimple.hpp']
def exact_method(body,name,override=False):
    pattern=(r'auto '+name+r'\(\) -> bool override\s*\{\s*return true;\s*\}' if override else r'virtual auto '+name+r'\(\) -> bool\s*\{\s*return false;\s*\}')
    return re.search(pattern,body).group(0)
base_a=exact_method(header,'derives_from_function')
base_b=exact_method(header,'derives_from_ufunction')
override=exact_method(function,'derives_from_ufunction',True)
assert 'derives_from_function()' not in function
assert 'if (!is_first_userdata_function && lua_object2.derives_from_function())' in cpp
assert 'calling_context = lua_object.get_base();' in cpp
assert 'UFunction::UFunction(Unreal::UObject* base, Unreal::UFunction* function)' in fcpp and 'm_base(base)' in fcpp
assert 'UFunction::construct(params.lua, params.base, params.function);' in cpp
assert 'MetaMethod::Call' in fcpp and 'return call_ufunction_from_lua(lua);' in fcpp
assert 'bool preserve_stack = false' in lua and 'lua_remove(get_lua_state(), force_index);' in lua
# Extract get_base without inventing its implementation.
get_base=re.search(r'auto get_base\(\) -> Unreal::UObject\*\s*\{\s*return m_base;\s*\}',function).group(0)
program='''namespace Unreal {struct UObject {};}
struct Base {
'''+base_a+'\n'+base_b+'''
};
struct Function : Base {
    Unreal::UObject* m_base;
    explicit Function(Unreal::UObject* p):m_base(p){}
'''+override+'\n'+get_base+'''
};
int main() {
    Unreal::UObject owner;
    Function reflected(&owner);
    Base& lua_object2=reflected;
    bool is_first_userdata_function=false;
    bool selected=false;
    if (!is_first_userdata_function && lua_object2.derives_from_function()) selected=true;
    if (selected || !lua_object2.derives_from_ufunction()) return 1;
    // Bound callable selects the UFunction first and recovers the real owner.
    if (reflected.get_base()!=&owner) return 2;
    return 0;
}
'''
with tempfile.TemporaryDirectory(prefix='star-bound-source-') as tmp:
    temp=Path(tmp);source=temp/'marker.cpp';source.write_text(program)
    if os.name=='nt':
        msvc=Path('C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.44.35207')
        sdk=Path('C:/Program Files (x86)/Windows Kits/10/Lib/10.0.26100.0')
        compiler=msvc/'bin/Hostx64/x64/cl.exe'
        exe=temp/'marker.exe'
        command=[str(compiler),'/nologo','/EHsc','/MT',str(source),'/Fe:'+str(exe),'/Fo:'+str(temp/'marker.obj'),'/link','/LIBPATH:'+str(msvc/'lib/x64'),'/LIBPATH:'+str(sdk/'ucrt/x64'),'/LIBPATH:'+str(sdk/'um/x64')]
    else:
        exe=temp/'marker';command=['c++','-std=c++17',str(source),'-o',str(exe)]
    result=subprocess.run(command,capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stdout+result.stderr
    subprocess.run([str(exe)],check=True,capture_output=True,timeout=10)
print('PASS compiled exact C++ marker/context contract; source deduction only, no engine proof')
