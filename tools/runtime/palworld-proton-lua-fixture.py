"""Private acceptance-only read of real Unreal state; never production setup."""
from pathlib import Path
import hashlib,importlib.util,json

root=Path('/game')
helper=root/'.voltra/palworld-loader-tools/palworld-loader-install.py'
spec=importlib.util.spec_from_file_location('fixture_loader',helper)
loader=importlib.util.module_from_spec(spec);spec.loader.exec_module(loader)
loader.verify(root)
base='Pal/Binaries/Win64/ue4ss/Mods/'
name=base+'VoltraAcceptanceReadOnly/Scripts/main.lua'
if loader.read(root,name):raise ValueError('Fresh owned Lua fixture required')
lua=b'''print("[VOLTRA_NATIVE_LUA] MODULE_LOADED\\n")
RegisterInitGameStatePostHook(function(Context)
    local world = FindFirstOf("World")
    if world and world:IsValid() then
        print("[VOLTRA_NATIVE_LUA] REAL_WORLD " .. world:GetFullName() .. "\\n")
    end
end)
'''
text=loader.read(root,base+'mods.txt')[0].decode('utf-8')
orders=json.loads(loader.read(root,base+'mods.json')[0])
if 'VoltraAcceptanceReadOnly' in text or any(x['mod_name']=='VoltraAcceptanceReadOnly' for x in orders):raise ValueError('Existing fixture order requires review')
text=text.replace('Keybinds : 1','VoltraAcceptanceReadOnly : 1\nKeybinds : 1')
index=next((i for i,x in enumerate(orders) if x['mod_name']=='Keybinds'),len(orders))
orders.insert(index,{'mod_name':'VoltraAcceptanceReadOnly','mod_enabled':True})
for path,data in [(name,lua),(base+'VoltraAcceptanceReadOnly/enabled.txt',b''),(base+'mods.txt',text.encode()),(base+'mods.json',(json.dumps(orders,indent=4)+'\n').encode())]:
    loader.publish(root,path,data,0o644)
loader.verify(root)
print(json.dumps({'fixture':name,'source_sha256':hashlib.sha256(lua).hexdigest(),'read_only_game_hook':True,'native_object_read_proven':False,'blueprint_loader_enabled':next(x['mod_enabled'] for x in orders if x['mod_name']=='BPModLoaderMod')}))
