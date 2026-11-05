import importlib.util
from pathlib import Path
import tempfile
import shutil
import unittest
from unittest.mock import patch

class Holdfast(unittest.TestCase):
 def test_run_refuses_before_update_or_filesystem_publication(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);scripts=Path('internal/panel/game_library/scripts')
   for name in ('holdfast-wave28.py','steam-native-next.py','native-config.py','native-release.py','native-console.py','source-install.py','steam-template.py'):
    shutil.copyfile(scripts/name,root/name)
   spec=importlib.util.spec_from_file_location('adapter_preflight',root/'holdfast-wave28.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a);shared=a.load()
   target=root/'holdfastnaw-dedicated/configs/operator.txt';target.parent.mkdir(parents=True)
   raw=b'# Voltra managed server fields\nserver_port 28000\nsteam_communications_port 28001\nsteam_query_port 28002\n'
   env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','SERVER_CONFIG_PATH':'operator.txt','ADMIN_PASS':'fixture-admin','VOLTRA_STEAM_AUTO_UPDATE':'1'}
   cases=[(raw+b'import other.txt\n',{}),(raw+b'server_port 28000\n',{}),(raw,{'VOLTRA_STEAM_AUTO_UPDATE':'invalid'}),(raw,{'SERVER_QUERY_PORT':'28000'}),(raw,{'FPSMAX':'0'}),(raw,{'SERVER_LOG_ARCHIVE_PATH':'../outside'})]
   for data,changes in cases:
    target.write_bytes(data);before={str(p.relative_to(root)):p.read_bytes() if p.is_file() else None for p in root.rglob('*')}
    with patch.object(a,'load',return_value=shared),patch.object(shared,'run') as run:
     with self.assertRaises(ValueError):a.run(root,{**env,**changes})
     run.assert_not_called()
    self.assertEqual(before,{str(p.relative_to(root)):p.read_bytes() if p.is_file() else None for p in root.rglob('*')})
 def test_emitted_helpers_and_preservation(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp); scripts=Path('internal/panel/game_library/scripts')
   for name in ('holdfast-wave28.py','steam-native-next.py','native-config.py','native-release.py','native-console.py','source-install.py'):
    shutil.copyfile(scripts/name,root/name)
   shutil.copyfile(scripts/'steam-template.py',root/'steam-template.py')
   spec=importlib.util.spec_from_file_location('adapter',root/'holdfast-wave28.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
   shared=a.load()
   target=root/'holdfastnaw-dedicated/configs/operator.txt';target.parent.mkdir(parents=True)
   raw=b'# Voltra managed server fields\r\nserver_port 28000\r\nsteam_communications_port 28001\r\nsteam_query_port 28002\r\nserver_name Operator\r\nserver_admin_password synthetic-native\r\nunknown array a b\r\n!map_rotation start\r\nmaximum_players 17\r\n!map_rotation end\r\n'
   target.write_bytes(raw)
   env={'SERVER_PORT':'28000','VOLTRA_ALLOCATED_PORTS':'28000,28001,28002','SERVER_CONFIG_PATH':'operator.txt','ADMIN_PASS':'synthetic-env'}
   argv,secrets=a.configure(shared,root,env)
   self.assertEqual(target.read_bytes(),raw);self.assertIn('synthetic-native',secrets);self.assertIn(str(target),argv)
   for bad in (raw+b'server_port 28000\n',b'import other.txt\n'+raw):
    target.write_bytes(bad)
    with self.assertRaises(ValueError):a.configure(shared,root,env)
    self.assertEqual(target.read_bytes(),bad)
if __name__=='__main__': unittest.main()

