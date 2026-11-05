"""Isolated tests against exact installer-emitted module names; all boundaries mocked."""
import json, os, runpy, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/game-parity-20261029/wave60-solace'
sys.path.insert(0, str(OUT / 'emitted'))
import fantasy_worlds_runtime as runtime
import fantasy_worlds_install as installer
import steam_template as steam
class Solace(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='wave60-solace-')
        self.root = Path(self.tmp.name)
        self.env = {'SERVER_PORT':'28015','VOLTRA_ALLOCATED_PORTS':'28015,28016','AUTO_UPDATE':'1'}
    def tearDown(self): self.tmp.cleanup()
    def write(self, name, data):
        p = self.root / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(data); p.chmod(0o640); return p
    def entry(self, kind, env):
        script = OUT / 'emitted' / ('fantasy_worlds_install.py' if kind == 'install' else 'fantasy_worlds_runtime.py')
        with patch.object(Path, 'cwd', return_value=self.root), patch.dict(os.environ, env, clear=True), patch.object(sys, 'argv', [str(script),'solace']):
            return runpy.run_path(str(script), run_name='__main__')
    def test_emitted_refusals_before_acquisition_or_writes(self):
        for kind in ('install','start'):
            for config in ('{', json.dumps({**runtime.defaults()['solace'], 'isPrivate':'false'}), json.dumps(runtime.defaults()['solace'])):
                p = self.write(runtime.SOLACE+'/servercfg.dat',config)
                for changes in ({}, {'QUERY_PORT':'28015'}, {'SERVER_PORT':'1'}, {'STEAM_PASS':'secret-never-log'}):
                    if config == json.dumps(runtime.defaults()['solace']) and not changes: continue
                    before = {str(x.relative_to(self.root)):(x.read_bytes(),x.stat().st_mode) for x in self.root.rglob('*') if x.is_file()}
                    with patch.object(steam,'update',side_effect=AssertionError('acquisition')), patch.object(runtime,'run',side_effect=AssertionError('process')), self.assertRaises(SystemExit) as result:
                        self.entry(kind,{**self.env,**changes})
                    self.assertEqual(result.exception.code,1)
                    self.assertEqual(before,{str(x.relative_to(self.root)):(x.read_bytes(),x.stat().st_mode) for x in self.root.rglob('*') if x.is_file()})
    def test_original_gap_reproduced_without_native_process(self):
        # Model the exact old installer by removing only the new preflight block.
        source = (OUT / 'emitted/fantasy_worlds_install.py').read_text()
        source = source.replace("    if game == 'solace':\n        from fantasy_worlds_runtime import solace_plan\n        solace_plan(root, env)\n", "")
        namespace = {'__name__':'wave60_before'}
        exec(compile(source, 'wave60-before-install', 'exec'), namespace)
        self.write(runtime.SOLACE+'/servercfg.dat','{')
        with patch.object(steam,'update',return_value={'source':'mock'}) as update:
            namespace['install'](self.root,'solace',self.env)
        update.assert_called_once()
    def test_mocked_update_success_failure_preserve_state(self):
        for fail in (False, True):
            config = {**runtime.defaults()['solace'], 'name':'operator','custom':{'x':1},'password':'native-secret'}
            files = [self.write(runtime.SOLACE+'/servercfg.dat',json.dumps(config)),self.write(runtime.SOLACE+'/Worlds/World/wd.dat','world'),self.write('Mods/operator','mod')]
            before = [(p.read_bytes(),p.stat().st_mode) for p in files]
            def update(*args, **kwargs):
                for p in files: p.write_text('publisher overwrite'); p.chmod(0o644)
                if fail: raise RuntimeError('mock publisher failure')
                return {'source':'mock'}
            with patch.object(steam,'update',side_effect=update):
                if fail:
                    with self.assertRaises(RuntimeError): installer.install(self.root,'solace',self.env)
                else: installer.install(self.root,'solace',self.env)
            self.assertEqual(before,[(p.read_bytes(),p.stat().st_mode) for p in files])
    def test_seed_once_ports_credentials_and_lifecycle(self):
        runtime.configure(self.root,'solace',self.env)
        p = self.root / runtime.SOLACE / 'servercfg.dat'
        value = json.loads(p.read_text()); value.update(name='operator',password='native-secret',worldSaveToUse='CustomWorld',custom=7)
        p.write_text(json.dumps(value))
        result = runtime.configure(self.root,'solace',self.env)
        self.assertEqual(json.loads(p.read_text()),value)
        self.assertIn('native-secret',result[4]); self.assertEqual(result[3],'\x03')
        self.assertEqual(result[5],b' server started . (True)')
        with patch.object(installer,'install') as update, patch.object(runtime,'run',return_value=23) as run, patch.object(Path,'cwd',return_value=self.root), patch.dict(os.environ,self.env,clear=True), patch.object(sys,'argv',['runtime','solace']):
            self.assertEqual(runtime.main(),23)
        update.assert_called_once(); self.assertEqual(run.call_args.kwargs['stop_signal'],runtime.signal.SIGINT)
        self.assertTrue(run.call_args.kwargs['terminal_query_reply'])
if __name__ == '__main__': unittest.main(verbosity=2)
