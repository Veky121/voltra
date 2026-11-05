import json,re,tempfile,pathlib,unittest
root=pathlib.Path(__file__).resolve().parents[2]
p=json.loads((root/'internal/panel/game_library/overrides.json').read_text())['astro_colony/egg-astro-colony.json']
with tempfile.TemporaryDirectory(prefix='astro-emitted-') as folder:
 target=pathlib.Path(folder)
 script=p['egg']['scripts']['installation']['script']
 files={}
 for match in re.finditer(r"cat > (\S+) <<'([^']+)'\n(.*?)\n\2(?:\n|$)",script,re.S):
  name,marker,body=match.groups()
  if name.startswith('.voltra/'):
   (target/pathlib.Path(name).name).write_text(body+'\n',encoding='utf-8')
   files[pathlib.Path(name).name]=body
 assert 'astrocolony_runtime.py' in files and 'astrocolony_seed.py' in files
 assert '.voltra/astrocolony_runtime.py run' in p['egg']['startup']
 source=(root/'tools/runtime/astrocolony-parity-wave2-test.py').read_text()
 source=source.replace("Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts/astrocolony-seed.py'", "Path("+repr(str(target))+ ") / 'astrocolony_seed.py'")
 source=source.replace("Path(__file__).resolve().parents[2] / 'internal/panel/game_library/scripts'", "Path("+repr(str(target))+")")
 for name in ('steam-template','native-config','native-console','unreal-survival-next','astrocolony-runtime'):
  source=source.replace("'"+name+".py'", "'"+name.replace('-','_')+".py'")
 source=source.replace("(name + '.py')", "(name.replace('-', '_') + '.py')")
 scope={'__file__':str(root/'tools/runtime/astrocolony-parity-wave2-test.py'),'__name__':'emitted_fixture'}
 exec(compile(source,'emitted_fixture','exec'),scope)
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(scope[c]) for c in ('AstroSeedTests','AstroRuntimeTests'))
 result=unittest.TextTestRunner(verbosity=2).run(suite)
 if not result.wasSuccessful():raise SystemExit(1)
 print('Exact canonical emitted imports; acquisition/supervisor mocked; Windows publisher mocked as labeled in original tests.')
