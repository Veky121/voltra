"""Linux root-installer/game-UID regression; own temporary files only."""
import importlib.util
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch

source=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts/minecraft-pack-install.py'
spec=importlib.util.spec_from_file_location('pack',source)
pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)


@unittest.skipUnless(hasattr(os,'chown') and os.getuid()==0,'Requires isolated Linux root installer fixture')
class ProgramOwnership(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'server';self.root.mkdir()
        self.stage=Path(self.temp.name)/'stage';self.stage.mkdir()
        (self.stage/'server.jar').write_bytes(b'publisher-v1')
        pack.publish(self.stage,self.root,{'version':'one'},'server.jar')
        self.jar=self.root/'server.jar';self.jar.chmod(0o644);os.chown(self.jar,988,988)

    def metadata(self):
        st=self.jar.stat();return st.st_uid,st.st_gid,st.st_mode&0o777

    def test_unchanged_program_keeps_game_owner_and_inode(self):
        before=self.jar.stat().st_ino
        pack.publish(self.stage,self.root,{'version':'one'},'server.jar')
        self.assertEqual(self.metadata(),(988,988,0o644))
        self.assertEqual(self.jar.stat().st_ino,before)

    def test_updated_tracked_program_retains_game_owner_and_mode(self):
        (self.stage/'server.jar').write_bytes(b'publisher-v2');(self.stage/'server.jar').chmod(0o755)
        pack.publish(self.stage,self.root,{'version':'two'},'server.jar')
        self.assertEqual(self.jar.read_bytes(),b'publisher-v2')
        self.assertEqual(self.metadata(),(988,988,0o644))

    def test_failed_commit_rolls_back_game_owner_and_bytes(self):
        (self.stage/'server.jar').write_bytes(b'publisher-v2')
        replace=pack.os.replace
        def failing(source,destination):
            if Path(destination).name=='release.json':raise OSError('fixture commit failure')
            return replace(source,destination)
        with patch.object(pack.os,'replace',side_effect=failing):
            with self.assertRaises(OSError):pack.publish(self.stage,self.root,{'version':'two'},'server.jar')
        self.assertEqual(self.jar.read_bytes(),b'publisher-v1')
        self.assertEqual(self.metadata(),(988,988,0o644))


if __name__=='__main__':unittest.main()
