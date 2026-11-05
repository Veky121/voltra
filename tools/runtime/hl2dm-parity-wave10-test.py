import importlib.util
from importlib.machinery import SourceFileLoader
import os
import json
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'internal/panel/game_library/scripts'


def load(name, path):
    spec = importlib.util.spec_from_loader(name, SourceFileLoader(name, str(path)))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


for filename in ('steam-template.py','native-console.py','source-install.py','source-runtime.py','source-variant-runtime.py'):
    load(filename[:-3].replace('-', '_'), BASE / filename)
gameplay = load('hl2dm_gameplay', BASE / 'hl2dm-gameplay.py')
adapter = load('hl2dm_runtime_candidate', BASE / 'hl2dm-runtime.py')


class HL2DMPreflight(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for name in ('srcds_run','hl2mp/gameinfo.txt','hl2mp/maps/dm_lockdown.bsp'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'fixture: not executable or publisher data')
        # The portable fixture contains no publisher payload. Production still
        # pins the independently captured public gameinfo search-path hash.
        patched=patch.object(gameplay,'GAMEINFO_SHA256',hashlib.sha256((self.root/'hl2mp/gameinfo.txt').read_bytes()).hexdigest())
        patched.start();self.addCleanup(patched.stop)
        patched_maps=patch.object(gameplay,'MAP_SHA256',{'dm_lockdown.bsp':hashlib.sha256((self.root/'hl2mp/maps/dm_lockdown.bsp').read_bytes()).hexdigest()})
        patched_maps.start();self.addCleanup(patched_maps.stop)
        self.env = dict(SRCDS_APPID='232370',SERVER_NAME='Original native name',MAP_NAME='dm_lockdown',MAX_PLAYERS='20',TICK_RATE='66',SERVER_PASSWORD='',RCON_PASSWORD='',PUBLIC_SERVER='0',TV_ENABLE='0',SRCDS_CPORT='0',SRCDS_STV='0',AUTO_UPDATE='0',SERVER_PORT='29120',VOLTRA_ALLOCATED_PORTS='29120,29121,29122')

    def tree(self):
        return {p.relative_to(self.root).as_posix():p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def test_explicit_tv_role_reserved_before_automatic_client_port(self):
        env, automatic = adapter.preflight(self.root, dict(self.env,SRCDS_STV='29121'))
        self.assertEqual((env['SRCDS_CPORT'],env['SRCDS_STV'],automatic), ('29122','29121','0'))
        argv, _ = adapter.source_variant_runtime.launch(self.root,env)
        self.assertIn('+clientport',argv)
        self.assertEqual(argv[argv.index('+clientport')+1],'29122')
        self.assertEqual(argv[argv.index('+tv_port')+1],'29121')

    def test_original_aliases_and_shared_launch_configuration(self):
        env, _ = adapter.preflight(self.root,self.env)
        argv, child = adapter.source_variant_runtime.launch(self.root,env)
        self.assertEqual(argv[argv.index('-game')+1],'hl2mp')
        self.assertEqual(argv[argv.index('+map')+1],'dm_lockdown')
        self.assertEqual(argv[argv.index('-tickrate')+1],'66')
        self.assertEqual(argv[argv.index('-maxplayers')+1],'20')
        self.assertIn('hostname "Original native name"', (self.root/'hl2mp/cfg/voltra-managed.cfg').read_text())
        self.assertEqual((self.root/'hl2mp/cfg/voltra-server.cfg').read_text(),'exec server.cfg\nexec voltra-managed.cfg\n')
        self.assertEqual(child['LD_LIBRARY_PATH'],str(self.root/'bin')+':'+str(self.root/'bin/linux64'))

    def test_bad_controls_refuse_before_acquisition_or_any_publication(self):
        for changes in ({'SERVER_NAME':'bad;quit'},{'SERVER_NAME':''},{'MAP_NAME':'../escape'}, {'MAX_PLAYERS':'21'}, {'TICK_RATE':'9'}, {'PUBLIC_SERVER':'2'}, {'TV_ENABLE':'2'}, {'SRCDS_APPID':'232330'}, {'SRCDS_GAME':'cstrike'}, {'SRCDS_BETAID':'bad branch'}, {'SRCDS_BETAPASS':'bad\ncredential'}, {'STEAM_GSLT':'bad-token'}, {'SRCDS_CPORT':'29121','SRCDS_STV':'29121'}, {'VOLTRA_ALLOCATED_PORTS':'29120,29121,29121'}):
            before = self.tree()
            update, launch, supervise = Mock(), Mock(), Mock()
            with self.assertRaises(ValueError):
                adapter.main(self.root,dict(self.env,AUTO_UPDATE='1',**changes),update,launch,supervise)
            update.assert_not_called();launch.assert_not_called();supervise.assert_not_called()
            self.assertEqual(before,self.tree())

    def test_missing_native_payload_refuses_without_configuration(self):
        (self.root/'hl2mp/maps/dm_lockdown.bsp').unlink()
        before=self.tree()
        with self.assertRaisesRegex(ValueError,'Reinstall'):
            adapter.main(self.root,self.env,Mock(),Mock(),Mock())
        self.assertEqual(before,self.tree())

    def test_managed_symlink_and_parent_type_refuse_before_update(self):
        folder=self.root/'hl2mp/cfg';folder.mkdir()
        outside=self.root/'outside';outside.write_bytes(b'untouched')
        (folder/'voltra-managed.cfg').symlink_to(outside)
        update=Mock()
        with self.assertRaises(ValueError):adapter.main(self.root,dict(self.env,AUTO_UPDATE='1'),update,Mock(),Mock())
        update.assert_not_called();self.assertEqual(outside.read_bytes(),b'untouched')
        (folder/'voltra-managed.cfg').unlink()
        (folder/'voltra-server.cfg').mkdir()
        with self.assertRaises(ValueError):adapter.preflight(self.root,self.env)

    def test_operator_files_unchanged_and_raw_shared_status_preserved(self):
        folder=self.root/'hl2mp/cfg';folder.mkdir()
        path=folder/'server.cfg';original=b'// operator\r\nexec custom.cfg\r\n';path.write_bytes(original)
        launch=Mock(return_value=(['native-srcds'],{'native':'child'}))
        supervise=Mock(return_value=-9)
        self.assertEqual(adapter.main(self.root,self.env,Mock(),launch,supervise),-9)
        self.assertEqual(path.read_bytes(),original)
        self.assertEqual(supervise.call_args.args[3],'quit')
        self.assertTrue(supervise.call_args.kwargs['terminal_input'])

    def receipt(self):
        cfg=self.root/'hl2mp/cfg';cfg.mkdir(exist_ok=True)
        manifest=self.root/'steamapps/appmanifest_232370.acf';manifest.parent.mkdir(exist_ok=True)
        manifest.write_text('"AppState" { "buildid" "24600426" }')
        target=self.root/gameplay.RECEIPT;target.parent.mkdir(exist_ok=True)
        target.write_text(json.dumps(gameplay.snapshot(self.root,gameplay.DEFAULTS)))
        return target

    def test_explicit_measured_migration_orders_before_initial_map_and_every_map(self):
        self.receipt()
        env,_=adapter.preflight(self.root,self.env)
        argv,_=gameplay.configure(self.root,env,adapter.source_variant_runtime.launch)
        self.assertEqual(argv[argv.index('+map')-4:argv.index('+map')],['+exec','voltra-gameplay.cfg','+exec','voltra-managed.cfg'])
        self.assertEqual((self.root/'hl2mp/cfg/voltra-server.cfg').read_text(),gameplay.WRAPPER)
        document=self.root/gameplay.DOCUMENT
        values=gameplay.parse_document(document.read_bytes())
        self.assertEqual(values,gameplay.DEFAULTS)
        self.assertEqual(values['mp_forcerespawn'],'0') # measured0, declaration default1

    def test_existing_partial_gameplay_preserved_without_reseeding(self):
        self.receipt();target=self.root/gameplay.DOCUMENT
        original=b'// operator\r\nMP_TEAMPLAY "1" // keep\tcomment\r\n';target.write_bytes(original)
        env,_=adapter.preflight(self.root,self.env)
        gameplay.configure(self.root,env,adapter.source_variant_runtime.launch)
        gameplay.configure(self.root,env,adapter.source_variant_runtime.launch)
        self.assertEqual(target.read_bytes(),original)

    def test_snapshot_drift_and_wrong_build_refuse_before_publication(self):
        receipt=self.receipt();legacy=self.root/'hl2mp/cfg/server.cfg';legacy.write_text('mp_timelimit 9\n')
        before=self.tree()
        with self.assertRaisesRegex(ValueError,'changed'):gameplay.plan(self.root)
        self.assertEqual(self.tree(),before)
        receipt.write_text(json.dumps(gameplay.snapshot(self.root,gameplay.DEFAULTS)))
        (self.root/'steamapps/appmanifest_232370.acf').write_text('"buildid" "other"')
        with self.assertRaisesRegex(ValueError,'build'):gameplay.plan(self.root)

    def test_complex_alias_routing_cycle_missing_include_and_custom_startup_refuse(self):
        folder=self.root/'hl2mp/cfg';folder.mkdir()
        for content in ('alias mp_teamplay "quit"\n','servercfgfile bad.cfg\n','exec absent.cfg\n','exec server.cfg\n','mp_timelimit 1;quit\n'):
            (folder/'server.cfg').write_text(content)
            before=self.tree()
            with self.assertRaises(ValueError):gameplay.snapshot(self.root,gameplay.DEFAULTS)
            self.assertEqual(self.tree(),before)
        (folder/'server.cfg').unlink()
        (self.root/'hl2mp/valve.rc').write_text('exec custom.cfg\n')
        with self.assertRaisesRegex(ValueError,'startup'):gameplay.legacy_safe(self.root)

    def test_safe_legacy_include_and_ban_bytes_stay_unchanged(self):
        self.receipt();folder=self.root/'hl2mp/cfg'
        rows={'server.cfg':b'// own\r\nexec custom.cfg\r\nexec banned_ip.cfg\r\n', 'custom.cfg':b'mp_timelimit "9"\r\n','banned_ip.cfg':b'addip 0 192.0.2.42\r\n'}
        for name,data in rows.items():(folder/name).write_bytes(data)
        (self.root/gameplay.RECEIPT).write_text(json.dumps(gameplay.snapshot(self.root,gameplay.DEFAULTS)))
        env,_=adapter.preflight(self.root,self.env)
        gameplay.configure(self.root,env,adapter.source_variant_runtime.launch)
        for name,data in rows.items():self.assertEqual((folder/name).read_bytes(),data)

    def test_scalar_closed_schema_duplicates_injection_and_domains(self):
        for value in (b'alias foo bar\n',b'mp_teamplay 1\nMP_TEAMPLAY 0\n',b'hostname stolen\n',b'mp_teamplay 1.0\n',b'mp_chattime 0\n',b'mp_chattime 121\n',b'mp_fraglimit 1.5\n',b'mp_timelimit 2147483647\n',b'mp_fraglimit 2147483520.000000001\n',b'sv_gravity -1\n',b'sv_gravity 1;quit\n',b'mp_teamplay 1\r',b'mp_teamplay 1\xe2\x80\xa8',b'mp_teamplay 1\x00'):
            with self.assertRaises(ValueError,msg=repr(value)):gameplay.parse_document(value)
        for value in (b'mp_chattime 1\n',b'mp_chattime 120\n',b'sv_gravity "600" // tab\tcomment\r\n'):
            self.assertTrue(gameplay.parse_document(value))

    def test_invalid_existing_document_refuses_before_automatic_update(self):
        folder=self.root/'hl2mp/cfg';folder.mkdir();(self.root/gameplay.DOCUMENT).write_bytes(b'alias mp_teamplay quit\n')
        before=self.tree();update=Mock()
        with self.assertRaises(ValueError):adapter.main(self.root,dict(self.env,AUTO_UPDATE='1'),update,Mock(),Mock())
        update.assert_not_called();self.assertEqual(self.tree(),before)

    def test_seed_create_only_never_overwrites_racing_operator(self):
        self.receipt();data=gameplay.plan(self.root);target=self.root/gameplay.DOCUMENT
        target.write_bytes(b'mp_teamplay 1\n')
        with self.assertRaisesRegex(ValueError,'appeared'):gameplay.seed_absent(self.root,data)
        self.assertEqual(target.read_bytes(),b'mp_teamplay 1\n')

    def test_publisher_searchpath_shadow_and_joystick_alias_refuse(self):
        self.receipt()
        custom=self.root/'hl2mp/custom';custom.mkdir();(custom/'readme.txt').write_text('Inert stock-style readme')
        self.assertIsNotNone(gameplay.plan(self.root))
        for name in ('override.vpk','override'):
            target=custom/name
            target.write_bytes(b'fixture shadow content')
            with self.assertRaisesRegex(ValueError,'shadow'):gameplay.plan(self.root)
            target.unlink()
        folder=self.root/'hl2mp/cfg';(folder/'joystick.cfg').write_text('alias mp_teamplay quit\n')
        with self.assertRaisesRegex(ValueError,'Complex'):gameplay.legacy_safe(self.root)
        (folder/'joystick.cfg').unlink()
        fallback=self.root/'hl2/cfg';fallback.mkdir(parents=True);(fallback/'autoexec.cfg').write_text('alias mp_teamplay quit\n')
        with self.assertRaisesRegex(ValueError,'fallback'):gameplay.plan(self.root)
        (fallback/'autoexec.cfg').unlink()
        (self.root/'hl2mp/gameinfo.txt').write_text('modified search paths')
        with self.assertRaisesRegex(ValueError,'search paths'):gameplay.legacy_safe(self.root)

    def test_unknown_or_changed_bsp_refuses_even_when_initial_map_is_stock(self):
        self.receipt()
        custom=self.root/'hl2mp/maps/custom.bsp';custom.write_bytes(b'fixture contains an unreviewed embedded cfg pack')
        with self.assertRaisesRegex(ValueError,'Custom HL2DM maps'):gameplay.plan(self.root)
        custom.unlink()
        known=self.root/'hl2mp/maps/dm_lockdown.bsp';known.write_bytes(b'changed embedded map configuration')
        with self.assertRaisesRegex(ValueError,'Changed HL2DM map'):gameplay.plan(self.root)


if __name__ == '__main__':unittest.main()
