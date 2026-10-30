"""Run Lua bridge behavior tests with lupa; these mock GIANTS, not native acceptance.

py -3.12 -m pip install --target .local/fs25-save-test/python312 lupa
py -3.12 tools/runtime/fs25-save-lua-test.py
"""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / '.local/fs25-save-test/python312'))
from lupa import LuaRuntime

source = (root / 'internal/panel/game_library/fs25/save-mod/VoltraSave.lua').read_text()
for scenario in ['save', 'busy', 'malformed', 'duplicate', 'client', 'exception', 'stale', 'paused-base-hook', 'conflicting-mod']:
    lua = LuaRuntime()
    lua.execute('''
        calls=0; logs={}; exists=false
        g_server={}
        g_currentMission={isSaving=false,startSaveCurrentGame=function(self,dedicated)
            assert(dedicated==true); calls=calls+1
        end}
        function getUserProfileAppPath() return '/profile/' end
        function createFolder(p) end
        function fileExists(p) return exists end
        function deleteFile(p) exists=false end
        function addModEventListener(mod) end
        function loadXMLFile(name,p) return 1 end
        function getXMLString(xml,key) if key=='voltraSave#id' then return requestId else return 'save' end end
        function delete(xml) end
        function print(message) table.insert(logs,message) end
    ''')
    lua.execute(source)
    lua.globals().requestId = 'a' * 32
    if scenario == 'client':
        lua.execute('g_server=nil')
    if scenario == 'stale':
        lua.execute('exists=true')
    lua.execute('VoltraSave:loadMap()')
    if scenario == 'stale':
        assert not lua.globals().exists
    lua.execute('exists=true')
    if scenario == 'busy':
        lua.execute('g_currentMission.isSaving=true')
    if scenario == 'conflicting-mod':
        lua.execute('g_currentMission.dediSave_allowSave=false')
    if scenario == 'paused-base-hook':
        lua.execute('BaseMission={update=function() end}; Utils={appendedFunction=function(first,second) return function(...) first(...); second(...) end end}')
        lua.execute(source)
        lua.execute('VoltraSave:loadMap(); exists=true')
    if scenario == 'malformed':
        lua.globals().requestId = '../invalid'
    if scenario == 'exception':
        lua.execute("g_currentMission.startSaveCurrentGame=function() error('native failure') end")
    lua.execute('BaseMission.update()' if scenario == 'paused-base-hook' else 'VoltraSave:update(0)')
    if scenario == 'duplicate':
        lua.execute('exists=true; VoltraSave:update(0)')
    expected = 1 if scenario in ['save', 'duplicate', 'stale', 'paused-base-hook'] else 0
    assert lua.globals().calls == expected, scenario
    if scenario == 'exception':
        assert 'rejected' in lua.eval('logs[#logs]')
    print('PASS', scenario)
