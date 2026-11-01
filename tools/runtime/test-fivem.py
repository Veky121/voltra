import importlib.util
import io
from pathlib import Path
import tempfile
import tarfile
import unittest
import zipfile

def load(name):
    spec=importlib.util.spec_from_file_location(name,Path('internal/panel/game_library/scripts')/(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

class FiveM(unittest.TestCase):
    def test_original_custom_zip_archive_and_confinement(self):
        installer=load('fivem-install')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);archive=root/'custom.zip';out=root/'out';out.mkdir()
            with zipfile.ZipFile(archive,'w') as source:
                source.writestr('alpine/opt/cfx-server/FXServer',b'native fixture')
                source.writestr('alpine/lib/original.so',b'library')
                link=zipfile.ZipInfo('alpine/lib/alias.so');link.create_system=3;link.external_attr=(0o120777<<16);source.writestr(link,'/lib/original.so')
            installer.extract_runtime(archive,out,None);self.assertEqual((out/'alpine/lib/alias.so').read_bytes(),b'library');self.assertFalse((out/'alpine/lib/alias.so').is_symlink())
            with zipfile.ZipFile(archive,'w') as source:source.writestr('../escape','bad')
            with self.assertRaises(ValueError):installer.extract_runtime(archive,out,None)
    def test_original_redm_aliases_and_slots_without_fake_license(self):
        installer=load('fivem-install');runtime=load('fivem-runtime')
        self.assertEqual(installer.identity({'CFX_VERSION':'35245'})['sha256'],installer.RELEASE['sha256'])
        full='1383-'+'a'*40
        self.assertIn('/'+full+'/fx.tar.xz',installer.identity({'CFX_VERSION':full,'FIVEM_RELEASE_SHA256':'b'*64})['url'])
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);env={'VOLTRA_CFX_GAME':'redm','CFX_LICENSE':'','SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','MAX_PLAYERS':'32'}
            with self.assertRaises(ValueError):runtime.configure(root,env)
            settings=runtime.configure(root,env,require_license=False);self.assertEqual(settings['game'],'redm');self.assertIn('set gamename "rdr3"',(root/'server.cfg').read_text());self.assertIn('sv_maxclients 32',(root/'server.cfg').read_text())
            env['MAX_PLAYERS']='33'
            with self.assertRaises(ValueError):runtime.configure(root,env,require_license=False)
    def test_state_paths_reject_symlinks_before_network(self):
        installer=load('fivem-install')
        with tempfile.TemporaryDirectory() as tmp,tempfile.TemporaryDirectory() as external:
            root=Path(tmp);(root/'.voltra').symlink_to(external,target_is_directory=True)
            with self.assertRaises(ValueError):installer.install(root,{})
    def test_license_public_gate_and_original_controls(self):
        runtime=load('fivem-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);p=root/'server.cfg';p.write_text('# retain\nensure myresource\nadd_ace group.admin command allow\nendpoint_add_udp "0.0.0.0:1"\nsv_hostname "old"\n')
            env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','LAN_ONLY':'1','SERVER_HOSTNAME':'Literal " $ +exec unsafe','MAX_PLAYERS':'12','TXHOST_GAME_NAME':'redm'}
            with self.assertRaises(ValueError):runtime.configure(root,env)
            result=runtime.configure(root,env,require_license=False);self.assertTrue(result['lan']);raw=p.read_text();self.assertIn('ensure myresource',raw);self.assertIn('add_ace group.admin command allow',raw);self.assertNotIn('0.0.0.0:1"',raw);self.assertIn('set gamename "rdr3"',raw);self.assertIn('sv_maxclients 12',raw);self.assertIn('sv_lan true',raw);self.assertIn('\\" $ +exec unsafe',raw)
            env['LAN_ONLY']='0'
            with self.assertRaises(ValueError):runtime.configure(root,env)
    def test_txadmin_separate_allocation_and_path(self):
        runtime=load('fivem-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);env={'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010,28011','LAN_ONLY':'1','TXADMIN_ENABLE':'1'}
            self.assertEqual(runtime.configure(root,env,require_license=False)['txport'],28011)
            env['TXHOST_TXA_PORT']='28010'
            with self.assertRaises(ValueError):runtime.configure(root,env,require_license=False)
            env['TXHOST_TXA_PORT']='28011';env['TXHOST_DATA_PATH']='../../escape'
            with self.assertRaises(ValueError):runtime.configure(root,env,require_license=False)
    def test_materialize_contained_alpine_links(self):
        installer=load('fivem-install')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);archive=root/'fx.tar';out=root/'out';out.mkdir()
            with tarfile.open(archive,'w') as tar:
                member=tarfile.TarInfo('alpine/lib/original.so');member.size=3;tar.addfile(member,io.BytesIO(b'lib'))
                link=tarfile.TarInfo('alpine/lib/alias.so');link.type=tarfile.SYMTYPE;link.linkname='/lib/original.so';tar.addfile(link)
            installer.extract_runtime(archive,out,None);self.assertEqual((out/'alpine/lib/alias.so').read_bytes(),b'lib');self.assertFalse((out/'alpine/lib/alias.so').is_symlink())
            with tarfile.open(archive,'w') as tar:
                link=tarfile.TarInfo('alpine/lib/escape.so');link.type=tarfile.SYMTYPE;link.linkname='../../../../etc/passwd';tar.addfile(link)
            with self.assertRaises(ValueError):installer.extract_runtime(archive,out,None)

class ConfigSafety(unittest.TestCase):
    def test_preserves_order_comments_unknown_and_crlf(self):
        cfg=load('fivem-cfg')
        raw='# private comment\r\n  sv_hostname "old" # keep\r\nensure custom\r\nset secret "private;value"\r\n'
        result=cfg.render(raw,{'sv_hostname':'"new"'})
        self.assertEqual(result,raw.replace('"old"','"new"'))
        self.assertEqual(cfg.render(result,{'sv_hostname':'"new"'}),result)
    def test_ambiguous_input_refuses_without_mutation(self):
        runtime=load('fivem-runtime')
        for raw in ['exec resources.cfg\n','sv_hostname a; quit\n',
                    'sv_hostname "unterminated\n','sv_hostname a\nSV_HOSTNAME b\n',
                    'sv_maxclients 12\nsv_maxplayers 13\n','vstr bootstrap\n']:
            with self.subTest(raw=raw),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);p=root/'server.cfg';p.write_bytes(raw.encode())
                with self.assertRaises(ValueError):
                    runtime.configure(root,{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010'},require_license=False)
                self.assertEqual(p.read_bytes(),raw.encode())
                self.assertFalse((root/'.voltra').exists())
    def test_typed_roundtrip_keeps_secrets_and_rejects_wrong_types(self):
        cfg=load('fivem-cfg');raw='sv_licenseKey "private"\nsv_hostname "old" # retained\n'
        changed=cfg.typed_patch(raw,{'sv_hostname':'new "quoted"','sv_maxclients':24,'sv_lan':True})
        self.assertEqual(cfg.typed_values(changed),{'sv_hostname':'new "quoted"','sv_maxclients':24,'sv_lan':True})
        self.assertIn('sv_licenseKey "private"',changed)
        for changes in [{'sv_licensekey':'replacement'},{'sv_maxclients':True},{'sv_lan':'false'},{'sv_hostname':'bad\nquit'}]:
            with self.assertRaises(ValueError):cfg.typed_patch(raw,changes)
    def test_installer_validates_before_acquisition(self):
        installer=load('fivem-install')
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);p=root/'server.cfg';p.write_text('exec @resource/private.cfg\n')
            with self.assertRaisesRegex(ValueError,'plain Files'):
                installer.install(root,{})
            self.assertEqual(list(root.iterdir()),[p])
    def test_redm_name_selects_slot_bound(self):
        runtime=load('fivem-runtime')
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                runtime.configure(Path(tmp),{'SERVER_PORT':'28010','VOLTRA_ALLOCATED_PORTS':'28010','TXHOST_GAME_NAME':'redm','MAX_PLAYERS':'33'},require_license=False)

if __name__=='__main__':unittest.main()
