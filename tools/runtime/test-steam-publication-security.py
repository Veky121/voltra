"""Real Linux filesystem boundaries; Steam process and network are mocked."""
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('steam','/helpers/steam-template.py')
steam=importlib.util.module_from_spec(spec);spec.loader.exec_module(steam)


class PublicationSecurity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)
        self.root=self.base/'server';self.root.mkdir()
        self.outside=self.base/'outside';self.outside.mkdir()
        self.sentinel=self.outside/'steam-template-release.json';self.sentinel.write_bytes(b'outside')

    def tearDown(self):self.temp.cleanup()

    def update(self,wait=lambda:0):
        process=types.SimpleNamespace(stdout=io.BytesIO(b''),wait=wait)
        with patch.object(steam,'bootstrap') as bootstrap,patch.object(steam.subprocess,'Popen',return_value=process) as launch,patch.object(steam,'manifest',return_value={'appid':90,'StateFlags':4,'buildid':123}):
            try:return steam.update(self.root,90,{})
            finally:self.bootstrap_calls=bootstrap.call_count;self.launch_calls=launch.call_count

    def test_symlink_parent_leaf_and_nonregular_rejected_before_publisher(self):
        for relative,kind in [('.voltra','link'),('.steam','link'),('.voltra/steam-template-release.json','link'),('.voltra/steam-template-release.json','directory')]:
            with self.subTest(relative=relative,kind=kind):
                target=self.root/relative;target.parent.mkdir(parents=True,exist_ok=True)
                if kind=='link':target.symlink_to(self.outside)
                else:target.mkdir()
                with self.assertRaises((ValueError,OSError)):self.update()
                self.assertEqual((self.bootstrap_calls,self.launch_calls),(0,0))
                if kind=='link':target.unlink()
                else:target.rmdir()
        self.assertEqual(self.sentinel.read_bytes(),b'outside')

    def test_parent_swapped_by_publisher_rejected_before_publication(self):
        folder=self.root/'.voltra';folder.mkdir()
        def publisher():
            folder.rename(self.root/'.voltra-old');folder.symlink_to(self.outside)
            return 0
        with self.assertRaises((ValueError,OSError)):self.update(wait=publisher)
        self.assertEqual(self.sentinel.read_bytes(),b'outside')
        self.assertEqual(list((self.root/'.voltra-old').iterdir()),[])

    def test_new_receipt_and_sdk_belong_to_volume_owner(self):
        os.chown(self.root,988,988)
        source=self.root/'.voltra/steamcmd/linux64/steamclient.so'
        source.parent.mkdir(parents=True);source.write_bytes(b'publisher-sdk');source.chmod(0o755)
        self.update()
        for relative,mode in [('.voltra/steam-template-release.json',0o644),('.steam/sdk64/steamclient.so',0o755)]:
            metadata=(self.root/relative).stat()
            self.assertEqual((metadata.st_uid,metadata.st_gid,metadata.st_mode&0o777),(988,988,mode))
        self.assertEqual((self.root/'.steam/sdk64').stat().st_uid,988)

    def test_failed_write_or_replace_keeps_old_payload_and_cleans_only_owned_temp(self):
        target=self.root/'receipt';target.write_bytes(b'original');target.chmod(0o640);os.chown(target,988,988)
        unknown=self.root/'.voltra-publish-operator';unknown.write_bytes(b'operator')
        def failing_writer(output):output.write(b'partial');raise OSError('fixture writer failed')
        for replace_failure in [False,True]:
            with self.subTest(replace_failure=replace_failure):
                if replace_failure:
                    with patch.object(steam.os,'replace',side_effect=OSError('fixture replace failed')):
                        with self.assertRaises(OSError):steam._publish(self.root,'receipt',lambda output:output.write(b'new'))
                else:
                    with self.assertRaises(OSError):steam._publish(self.root,'receipt',failing_writer)
                self.assertEqual(target.read_bytes(),b'original')
                metadata=target.stat();self.assertEqual((metadata.st_uid,metadata.st_gid,metadata.st_mode&0o777),(988,988,0o640))
                self.assertEqual(sorted(p.name for p in self.root.iterdir()),['.voltra-publish-operator','receipt'])

    def test_destination_replaced_during_write_rejected_without_following_link(self):
        target=self.root/'receipt';target.write_bytes(b'original')
        def writer(output):
            output.write(b'new');target.unlink();target.symlink_to(self.sentinel)
        with self.assertRaises(ValueError):steam._publish(self.root,'receipt',writer)
        self.assertEqual(self.sentinel.read_bytes(),b'outside')
        self.assertEqual(list(self.root.glob('.voltra-publish-*')),[])

    def test_exclusive_temp_collision_never_removes_unknown_file(self):
        unknown=self.root/('.voltra-publish-'+'a'*32);unknown.symlink_to(self.sentinel)
        with patch.object(steam.secrets,'token_hex',return_value='a'*32):
            with self.assertRaises(ValueError):steam._publish(self.root,'receipt',lambda output:output.write(b'new'))
        self.assertTrue(unknown.is_symlink());self.assertEqual(self.sentinel.read_bytes(),b'outside')

    def test_sdk_source_symlink_rejected_before_publisher(self):
        source=self.root/'.voltra/steamcmd/linux64/steamclient.so';source.parent.mkdir(parents=True);source.symlink_to(self.sentinel)
        with self.assertRaises(ValueError):self.update()
        self.assertEqual((self.bootstrap_calls,self.launch_calls),(0,0))

    def test_substituted_temporary_file_is_not_published_or_removed(self):
        target=self.root/'receipt';target.write_bytes(b'original')
        names=[]
        def writer(output):
            output.write(b'new')
            temporary=next(self.root.glob('.voltra-publish-*'));names.append(temporary)
            temporary.unlink();temporary.write_bytes(b'unknown replacement')
        with self.assertRaisesRegex(ValueError,'temporary file changed'):
            steam._publish(self.root,'receipt',writer)
        self.assertEqual(target.read_bytes(),b'original')
        self.assertEqual(names[0].read_bytes(),b'unknown replacement')

    def test_volume_symlink_rejected_and_existing_hardlink_is_not_overwritten(self):
        original=self.root
        link=self.base/'volume-link';link.symlink_to(original,target_is_directory=True)
        self.root=link
        try:
            with self.assertRaises(ValueError):self.update()
            self.assertEqual((self.bootstrap_calls,self.launch_calls),(0,0))
        finally:self.root=original
        target=self.root/'receipt';os.link(self.sentinel,target)
        steam._publish(self.root,'receipt',lambda output:output.write(b'new receipt'))
        self.assertEqual(target.read_bytes(),b'new receipt')
        self.assertEqual(self.sentinel.read_bytes(),b'outside')


unittest.main()
