import sys, types, unittest, tempfile
from pathlib import Path
from unittest.mock import patch
base=Path('internal/panel/game_library/scripts')
for name in ['steam-template','native-config','native-console','source-install','source-next-install','tactical-install','tactical-runtime','publisher-install','publisher-runtime','pot-runtime']:
    module=types.ModuleType(name.replace('-','_'));sys.modules[module.__name__]=module
    exec((base/(name+'.py')).read_text(encoding='utf-8-sig'),module.__dict__)
pot=sys.modules['pot_runtime']
class Gate(unittest.TestCase):
    def env(self,**extra):
        return dict(VOLTRA_PUBLISHER='titans',ACQUISITION_MODE='publisher',POT_HOSTING_AGREEMENT='1',AG_AUTH_TOKEN='synthetic.offline.fixture',SERVER_GUID='550e8400-e29b-41d4-a716-446655440000',SERVER_PORT='28010',QUERY_PORT='7778',RCON_PORT='7779',VOLTRA_ALLOCATED_PORTS='28010,28011,28013,7778,7779',**extra)
    def test_invalid_inputs_refuse_before_acquisition_and_mutation(self):
        cases=[('AG_AUTH_TOKEN',''),('AG_AUTH_TOKEN','changeme'),('POT_HOSTING_AGREEMENT','0'),('SERVER_GUID','00000000-0000-0000-0000-000000000000'),('QUERY_PORT','28011'),('SERVER_PORT','65535'),('SERVER_MAX_PLAYERS','201'),('SERVER_MAP','../escape'),('VOLTRA_ALLOCATED_PORTS','28010'),('SERVER_NAME','bad\nname')]
        for key,value in cases:
            with self.subTest(key=key),tempfile.TemporaryDirectory() as d,patch.object(pot,'publisher_install') as acquire:
                env=self.env();env[key]=value
                with self.assertRaises(ValueError):pot.install(Path(d),env)
                acquire.assert_not_called();self.assertEqual(list(Path(d).iterdir()),[])
    def test_valid_preflight_preserves_native_collections_and_secrets(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'server/PathOfTitans/Saved/Config/LinuxServer/Game.ini';p.parent.mkdir(parents=True)
            data=b'; operator\r\n[SourceRCON]\r\nPassword="private-fixture"\r\nIPAllowList=127.0.0.1\r\nIPAllowList=10.0.0.1\r\n';p.write_bytes(data)
            pot.preflight(root,self.env());self.assertEqual(p.read_bytes(),data)
    def test_startup_also_gates_before_shared_main(self):
        with tempfile.TemporaryDirectory() as d,patch.object(pot,'publisher_main') as run:
            env=self.env();env['POT_HOSTING_AGREEMENT']='0'
            with self.assertRaises(ValueError):pot.main(Path(d),env)
            run.assert_not_called()
    def test_bad_encoding_refuses_before_download(self):
        with tempfile.TemporaryDirectory() as d,patch.object(pot,'publisher_install') as acquire:
            root=Path(d);p=root/'server/PathOfTitans/Saved/Config/LinuxServer/Game.ini';p.parent.mkdir(parents=True);p.write_bytes(b'\xff')
            with self.assertRaises(ValueError):pot.install(root,self.env())
            acquire.assert_not_called();self.assertEqual(p.read_bytes(),b'\xff')
unittest.main()
