import json,pathlib,tempfile,sys,importlib.util,socket,subprocess,urllib.request,unittest,io,re
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/game-parity-20261029/wave35-helper-integration'
sys.dont_write_bytecode=True
profiles=json.loads((OUT/'profiles.pending.json').read_text());inventory=json.loads((OUT/'inventory.json').read_text());selected={x['name'] for x in json.loads((OUT/'integration.json').read_text())['modules']}
results=[]
pattern=re.compile(r'''cat\s+>\s*(?:"([^"\r\n]+\.py)"|'([^'\r\n]+\.py)'|([^\s]+\.py))\s+<<'([^']+)'\r?\n([\s\S]*?)\r?\n\4(?:\r?\n|$)''')
with patch.object(socket,'socket',side_effect=AssertionError('network forbidden')),patch.object(subprocess,'Popen',side_effect=AssertionError('native launch forbidden')),patch.object(urllib.request,'urlopen',side_effect=AssertionError('download forbidden')):
 for recipe,p in profiles.items():
  baseline=set(sys.modules)
  with tempfile.TemporaryDirectory(prefix='wave35-emitted-') as tmp:
   stage=pathlib.Path(tmp)
   for m in pattern.finditer(p['egg']['scripts']['installation']['script']):
    name=pathlib.PurePosixPath(next(x for x in m.group(1,2,3) if x)).name
    compile(m[5].encode('utf-8'),name,'exec');(stage/name).write_text(m[5]+'\n')
   for match in re.finditer(r"cat\s+>\s*(\S+\.json)\s+<<'([^']+)'\n(.*?)\n\2(?:\n|$)",p['egg']['scripts']['installation']['script'],re.S):
    (stage/pathlib.PurePosixPath(match[1].strip('"')).name).write_text(match[3]+'\n')
   sys.path.insert(0,tmp);loaded=[]
   try:
    for file in stage.glob('*.py'):
     name=file.stem.replace('-','_')
     if name not in selected:continue
     spec=importlib.util.spec_from_file_location(name,file);module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);loaded.append(name)
    if 'session_servers_install' in loaded:
     code=(ROOT/'tools/runtime/test-session-servers.py').read_text()
     code=re.sub(r'^SCRIPTS=.*$',lambda _:'SCRIPTS=Path('+repr(tmp)+')',code,flags=re.M).replace("name.replace('_','-')+'.py'","name+'.py'").replace('SCRIPTS.parents[3]','Path('+repr(str(ROOT))+')')
     ns={'__file__':str(ROOT/'tools/runtime/test-session-servers.py'),'__name__':'fixtures'};exec(compile(code,'emitted-session-suite','exec'),ns)
     # KF2 assertions apply to generic installer; EXILED specialization intentionally
     # differs in the unused KF2 branch. Exercise all SCP/EXILED guards there.
     suite=unittest.defaultTestLoader.loadTestsFromTestCase(ns['SessionServers'])
     if '/exiled/' in recipe:suite=unittest.TestSuite(t for t in suite if 'kf_' not in t.id())
     stream=io.StringIO();r=unittest.TextTestRunner(stream=stream,verbosity=2).run(suite)
     (OUT/(('exiled' if '/exiled/' in recipe else 'kf2' if 'killing_floor' in recipe else 'scp')+'-emitted.log')).write_text(stream.getvalue())
     assert r.wasSuccessful(),stream.getvalue()
     results.append({'recipe':recipe,'tests':r.testsRun,'failures':0})
    results.append({'recipe':recipe,'imported':loaded,'startup':p['egg']['startup'],'compile':'pass'})
   finally:
    sys.path.remove(tmp)
    for name in set(sys.modules)-baseline:
     module=sys.modules.get(name)
     if str(getattr(module,'__file__','')).startswith(tmp):sys.modules.pop(name,None)
(OUT/'emitted-results.json').write_text(json.dumps(results,indent=2)+'\n')
print('PASS',len(profiles),'actual emitted recipe imports; mocked session caller suites',[(r['recipe'],r['tests']) for r in results if 'tests' in r])

