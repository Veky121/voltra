"""Publisher metadata selection only. No downloads or native child starts."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'internal/panel/game_library/scripts'

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,file)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module

load('native_release',BASE/'native-release.py')
installer=load('ddnet_install',BASE/'ddnet-install.py')

def archive(version):return 'DDNet-'+version+'-linux_x86_64.tar.xz'
def page(*versions):return '\n'.join('<a href="'+archive(version)+'">Linux</a>' for version in versions)
def row(version,digest='a'*64):return digest+'  '+archive(version)+'\n'

class LatestPublisherChecksums(unittest.TestCase):
    def resolve(self,version,html,sums):
        calls=[]
        def fixture(url):
            calls.append(url)
            if url=='https://ddnet.org/downloads/':return html
            if url==installer.CHECKSUMS_URL:return sums
            raise AssertionError('Unexpected metadata origin '+url)
        output=io.StringIO()
        with patch.object(installer,'text',side_effect=fixture),contextlib.redirect_stdout(output):
            result=installer.select_release(version)
        return result,output.getvalue(),calls

    def test_reviewed_pin_keeps_exact_identity_without_metadata_request(self):
        with patch.object(installer,'text',side_effect=AssertionError('Pinned metadata changed')):
            result=installer.select_release('20.1.1')
        self.assertEqual(result['sha256'],'13e75af21845ebb2bb02d76e4b9c5a1680ab4fb044057c1586ceb83835c811f3')
        self.assertEqual(result['bytes'],45927396)

    def test_stale_manifest_selects_newest_verified_stable_and_discloses_skip(self):
        # The hotfix replaced its base release on the downloads page. The
        # official checksum manifest still lists the checksummed base20.2.
        result,output,_=self.resolve('latest',page('20.2.1','20.1.1'),row('20.2','b'*64)+row('20.1.1'))
        self.assertEqual(result['version'],'20.2');self.assertEqual(result['sha256'],'b'*64)
        self.assertEqual(result['url'],'https://ddnet.org/downloads/'+archive('20.2'))
        self.assertIn('20.2.1',output);self.assertIn('missing or ambiguous',output);self.assertIn('selected publisher-checksummed stable 20.2',output)

    def test_explicit_missing_version_never_falls_back(self):
        with self.assertRaisesRegex(ValueError,'20.2.1.*uniquely publisher-checksummed'):
            self.resolve('20.2.1',page('20.2.1'),row('20.2'))

    def test_semantic_version_order_does_not_depend_on_page_or_manifest_order(self):
        for html in (page('20.9','20.10','19.99'),page('19.99','20.10','20.9')):
            for sums in (row('20.9')+row('20.10','b'*64)+row('19.99'),row('19.99')+row('20.10','b'*64)+row('20.9')):
                result,_,_=self.resolve('latest',html,sums)
                self.assertEqual(result['version'],'20.10')

    def test_ambiguous_newer_release_is_not_downloaded_or_silently_selected(self):
        sums=row('20.2','a'*64)+row('20.2','b'*64)+row('20.1.2','c'*64)
        result,output,_=self.resolve('latest',page('20.2','20.1.2'),sums)
        self.assertEqual(result['version'],'20.1.2');self.assertIn('20.2',output);self.assertIn('ambiguous',output)
        with self.assertRaisesRegex(ValueError,'missing or ambiguous'):
            self.resolve('20.2',page('20.2'),sums)

    def test_no_unique_checksum_cannot_use_hardcoded_pin_or_self_hash(self):
        for sums in ('',row('20.2')+row('20.2'),('0'*63)+'  '+archive('20.2')):
            with self.subTest(sums=sums),self.assertRaisesRegex(ValueError,'No stable DDNet'):
                self.resolve('latest',page('20.2'),sums)

    def test_untrusted_archive_links_do_not_supply_version_or_download_origin(self):
        for url in ('https://evil.invalid/'+archive('99.0'),'https://ddnet.org.evil.invalid/downloads/'+archive('99.0'),'http://ddnet.org/downloads/'+archive('99.0'),'../'+archive('99.0')):
            with self.subTest(url=url),self.assertRaisesRegex(ValueError,'was not found'):
                self.resolve('latest','<a href="'+url+'">Linux</a>',row('20.2'))
        result,_,_=self.resolve('latest',page('20.2')+'<a href="https://evil.invalid/'+archive('99.0')+'">bad</a>',row('20.2'))
        self.assertEqual(result['version'],'20.2')

    def test_other_platform_prerelease_and_path_manifest_rows_are_ignored(self):
        invalid=['DDNet-99.0-linux_x86.tar.xz','DDNet-99.0-linux_arm64.tar.xz','DDNet-nightly-linux_x86_64.tar.xz','DDNet-99.0-rc1-linux_x86_64.tar.xz','../'+archive('99.0'),'https://evil.invalid/'+archive('99.0')]
        sums=''.join('b'*64+'  '+name+'\n' for name in invalid)+row('20.2')
        result,_,_=self.resolve('latest',page('20.2'),sums)
        self.assertEqual(result['version'],'20.2')
        for name in invalid[:2]:
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'was not found'):
                self.resolve('latest','<a href="'+name+'">Linux</a>',sums)

    def test_binary_marker_crlf_and_explicit_identity_remain_supported(self):
        result,output,calls=self.resolve('20.2',page('20.2.1'),'b'*64+'\t*'+archive('20.2')+'\r\n')
        self.assertEqual(result['version'],'20.2');self.assertEqual(result['prefix'],'DDNet-20.2-linux_x86_64');self.assertEqual(output,'')
        self.assertEqual(calls,[installer.CHECKSUMS_URL])

    def test_invalid_explicit_versions_refuse_before_network(self):
        for version in ('../20.2','20.2;quit','nightly','20','20.2-rc1'):
            with self.subTest(version=version),patch.object(installer,'text',side_effect=AssertionError('Unexpected metadata call')),self.assertRaises(ValueError):
                installer.select_release(version)

    def test_ddrace_nightly_alias_keeps_its_separate_publisher_checked_path(self):
        load('ddnet_runtime',BASE/'ddnet-runtime.py')
        legacy=load('ddrace_legacy',BASE/'ddrace-network.py')
        sums='c'*64+'  DDNet-nightly-linux_x86_64.tar.xz\n'
        with patch.object(legacy,'text',return_value=sums),patch.object(legacy,'nightly_prefix',return_value='DDNet-nightly-20261029-linux_x86_64'),patch.object(legacy,'select_release',side_effect=AssertionError('Nightly must not use stable selector')):
            result=legacy.release('nightly')
        self.assertEqual(result['version'],'nightly');self.assertEqual(result['sha256'],'c'*64)
        self.assertEqual(result['url'],'https://ddnet.org/downloads/DDNet-nightly-linux_x86_64.tar.xz')

if __name__=='__main__':unittest.main()
