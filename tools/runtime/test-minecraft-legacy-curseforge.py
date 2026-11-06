import base64,os,subprocess,tempfile,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parents[2]/'internal/panel/game_library'
class LegacyPublication(unittest.TestCase):
 def test_clean_mods_and_override_on_actual_shell_path(self):
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory)/'server';root.mkdir()
   original="""#!/bin/bash
set -eu
mkdir -p "$SERVER_DIR/mods" "$SERVER_DIR/config" "$SERVER_DIR/libraries/fixture"
printf mod > "$SERVER_DIR/mods/$FIXTURE_MOD.jar"
printf default > "$SERVER_DIR/config/example.toml"
printf args > "$SERVER_DIR/libraries/fixture/args.txt"
ln -s libraries/fixture/args.txt "$SERVER_DIR/unix_args.txt"
"""
   shell=(BASE/'minecraft-legacy-curseforge.sh').read_text().replace('# VOLTRA_SHARED_INSTALLER',(BASE/'minecraft-install.py').read_text(),1).replace('VOLTRA_ORIGINAL_BASE64',base64.b64encode(original.encode()).decode(),1)
   script=Path(directory)/'install.sh';script.write_text(shell)
   env={**os.environ,'SERVER_DIR':str(root),'FIXTURE_MOD':'old-0.6.3'}
   subprocess.run(['bash',str(script)],env=env,check=True,stdout=subprocess.PIPE)
   (root/'mods/renamed-0.6.8.jar').write_bytes(b'stale')
   (root/'config/example.toml').write_bytes(b'user')
   env['FIXTURE_MOD']='new-0.6.10'
   subprocess.run(['bash',str(script)],env=env,check=True,stdout=subprocess.PIPE)
   self.assertEqual([p.name for p in (root/'mods').iterdir()],['new-0.6.10.jar'])
   self.assertEqual((root/'config/example.toml').read_bytes(),b'user')
   self.assertEqual((root/'.voltra/overrides/config/example.toml').read_bytes(),b'user')
   self.assertTrue((root/'unix_args.txt').is_file())
if __name__=='__main__':unittest.main()
