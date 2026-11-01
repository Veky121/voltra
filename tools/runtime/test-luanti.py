"""Native configuration and staged game-install fixtures; not gameplay proof."""
import io
import json
import os
import stat
import tempfile
import types
import unittest
from unittest import mock
import zipfile
from pathlib import Path

runtime = types.ModuleType('luanti_runtime')
installer = types.ModuleType('luanti_installer')
patcher = types.ModuleType('luanti_patcher')
exec(RUNTIME_SOURCE, runtime.__dict__)
exec(INSTALL_SOURCE, installer.__dict__)
exec(PATCH_SOURCE, patcher.__dict__)


class ConfigTests(unittest.TestCase):
    def test_native_unicode_edges_and_nested_literal_delimiters(self):
        for edge in ('\u0085','\u2028','\u2029'):
            value=edge+'literal'+edge
            self.assertEqual(runtime.scalar(value,'server_name'),value)
            text='custom = {\nkey = '+edge+'{\n}\nserver_name = '+value+'\n'
            self.assertEqual(runtime.render(text,{'server_name':'ignored'}),text)

    def test_existing_world_retains_its_native_game_id(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);world=root/'.minetest/worlds/fixture';world.mkdir(parents=True)
            metadata=world/'world.mt';original=b'# operator\r\ngameid = existing_game\r\nbackend = sqlite3\r\n';metadata.write_bytes(original)
            self.assertEqual(runtime.selected_world_game(root,'fixture','startup_default'),'existing_game')
            self.assertEqual(metadata.read_bytes(),original)
            (root/'.voltra').mkdir();(root/'.voltra/luanti-admin.lua').write_bytes(b'-- controlled fixture\n')
            game=root/'.minetest/games/existing_game';game.mkdir(parents=True);(game/'game.conf').write_bytes(b'title = Fixture\n')
            env=dict(SERVER_ADMIN_NAME='Owner',SERVER_NAME='Server',SERVER_ANNOUNCE='false',SERVER_MAX_USERS='15',SERVER_PORT='23560',DEFAULT_GAME='uninstalled_startup_default',WORLD_NAME='fixture')
            with mock.patch.object(runtime.subprocess,'run',return_value=types.SimpleNamespace(stdout='Luanti 5.17.0 (Linux)\n')),mock.patch.object(runtime.os,'execve') as execute,mock.patch.object(runtime.os,'chdir'):
                runtime.launch(root,env)
            arguments=execute.call_args.args[1]
            self.assertEqual(arguments[arguments.index('--gameid')+1],'existing_game')
            self.assertEqual(metadata.read_bytes(),original)
            metadata.write_bytes(original+b'gameid = another\n')
            with self.assertRaises(ValueError):runtime.selected_world_game(root,'fixture','startup_default')

    def test_native_authority_resource_spans_and_unicode(self):
        for separator in ('\u0085', '\u2028', '\u2029'):
            text = '# operator\r\nserver_name = Native' + separator + 'Name\r\n  port  = 25565  \r\ncustom = {\nserver_name = nested\n}\n'
            expected = text.replace('25565', '23560')
            self.assertEqual(runtime.render(text, {'server_name':'ignored', 'port':'23560'}), expected)

    def test_native_gameplay_and_admin_name_survive_stale_startup(self):
        env = dict(SERVER_ADMIN_NAME='Owner', SERVER_NAME='Startup', SERVER_ANNOUNCE='false', SERVER_MAX_USERS='15', SERVER_PORT='23560', DEFAULT_GAME='minetest', WORLD_NAME='world', SERVER_ADMIN_PASSWORD='synthetic-fixture-password')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.voltra').mkdir()
            (root / '.voltra/luanti-admin.lua').write_bytes(b'-- controlled fixture\n')
            (root / '.minetest/games/minetest').mkdir(parents=True)
            (root / '.minetest/games/minetest/game.conf').write_bytes(b'title = Fixture\n')
            config = root / '.minetest/minetest.conf'
            original = b'# operator\nname = NativeAdmin\nserver_name = Native server\nmax_users = 7\nserver_announce = false\nmotd = """\nNative\nmessage\n"""\n'
            config.write_bytes(original)
            with mock.patch.object(runtime.subprocess,'run',return_value=types.SimpleNamespace(stdout='Luanti 5.17.0 (Linux)\n')),mock.patch.object(runtime.os,'execve'),mock.patch.object(runtime.os,'chdir'):
                runtime.launch(root,env)
                first=config.read_bytes()
                self.assertTrue(first.startswith(original))
                pending=root/'.minetest/worlds/world/.voltra-admin-bootstrap.json'
                self.assertEqual(json.loads(pending.read_text())['name'],'NativeAdmin')
                config.chmod(0o640)
                runtime.launch(root,dict(env,SERVER_NAME='bad\nunused',SERVER_ADMIN_NAME='bad unused',SERVER_MAX_USERS='unused',SERVER_ANNOUNCE='unused'))
                self.assertEqual(config.read_bytes(),first)
                if os.name!='nt':self.assertEqual(config.stat().st_mode&0o777,0o640)

    def test_duplicate_refusal_preserves_complete_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);config=root/'.minetest/minetest.conf';config.parent.mkdir()
            config.write_bytes(b'server_name = one\nserver_name = two\n')
            before={str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with self.assertRaises(ValueError):runtime.planned_settings(root,dict(SERVER_PORT='23560',DEFAULT_GAME='minetest'))
            self.assertEqual({str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()},before)

    def test_modified_bootstrap_mod_refuses_before_config_publication(self):
        env=dict(SERVER_ADMIN_NAME='Owner',SERVER_NAME='Server',SERVER_ANNOUNCE='false',SERVER_MAX_USERS='15',SERVER_PORT='23560',DEFAULT_GAME='minetest',WORLD_NAME='world')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'.voltra').mkdir();(root/'.voltra/luanti-admin.lua').write_bytes(b'-- managed\n')
            game=root/'.minetest/games/minetest';game.mkdir(parents=True);(game/'game.conf').write_bytes(b'title = Fixture\n')
            mod=root/'.minetest/worlds/world/worldmods/voltra_admin_bootstrap';mod.mkdir(parents=True);(mod/'init.lua').write_bytes(b'-- operator modification\n')
            before={str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            with mock.patch.object(runtime.subprocess,'run',return_value=types.SimpleNamespace(stdout='Luanti 5.17.0 (Linux)\n')):
                with self.assertRaisesRegex(ValueError,'Modified administrator'):runtime.launch(root,env)
            self.assertEqual({str(p):p.read_bytes() for p in root.rglob('*') if p.is_file()},before)

    def test_private_new_secret_preserves_existing_owner_and_other_modes(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'minetest.conf';path.write_bytes(b'# nonsecret operator file\n');path.chmod(0o644)
            identity=(path.stat().st_uid,path.stat().st_gid)
            runtime.configure(path,{'default_password':'synthetic-fixture-secret'})
            if os.name!='nt':
                self.assertEqual(path.stat().st_mode&0o777,0o600)
                self.assertEqual((path.stat().st_uid,path.stat().st_gid),identity)
            content=path.read_bytes();path.chmod(0o640)
            self.assertFalse(runtime.configure(path,{'default_password':'ignored-new-secret'}))
            self.assertEqual(path.read_bytes(),content)
            if os.name!='nt':self.assertEqual(path.stat().st_mode&0o777,0o640)

    def test_changed_preflight_refuses_without_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'minetest.conf';path.write_bytes(b'server_name = current\n')
            with self.assertRaisesRegex(ValueError,'changed during preflight'):runtime.configure(path,{'port':'23560'},expected=b'stale')
            self.assertEqual(path.read_bytes(),b'server_name = current\n')
            self.assertEqual(len(list(path.parent.iterdir())),1)

    def test_symlink_configuration_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'.minetest').mkdir();target=root/'operator.conf';target.write_bytes(b'unchanged')
            try:(root/'.minetest/minetest.conf').symlink_to(target)
            except OSError:self.skipTest('Windows symlink privilege unavailable')
            with self.assertRaises(ValueError):runtime.planned_settings(root,dict(SERVER_PORT='23560',DEFAULT_GAME='minetest'))
            self.assertEqual(target.read_bytes(),b'unchanged')

    def test_literal_punctuation(self):
        value = 'Name, $HOME = "quoted" # literal 世界'
        self.assertEqual(runtime.render('', {'server_name': value}), 'server_name = ' + value + '\n')

    def test_injection_and_native_delimiters(self):
        for value in ['one\nserver_announce = true', 'one\r', '\0', '{', '"""', ' secret', 'secret ']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                runtime.render('', {'default_password': value})

    def test_preserves_unrelated_groups_and_multiline(self):
        unrelated = '# operator data\ncustom = {\nserver_name = nested\nother = """\n  """\nserver_name = still text\n"""\n}\nmotd = """\nserver_name = text\n"""\n'
        self.assertEqual(runtime.render(unrelated + 'server_name = old\n', {'server_name': 'new'}), unrelated + 'server_name = old\n')

    def test_replace_multiline_and_group_managed_values(self):
        old = 'server_name = """\nold\n"""\n'
        self.assertEqual(runtime.render(old, {'server_name': 'new'}), old)
        with self.assertRaises(ValueError):
            runtime.render('max_users = {\nx = y\n}\n', {'max_users': '30'})

    def test_duplicates_and_no_final_newline(self):
        with self.assertRaises(ValueError):
            runtime.render('server_name = old\nserver_name = duplicate\nkeep = yes', {'server_name': 'new', 'port': '23560'})
        self.assertEqual(runtime.render('server_name = old\nkeep = yes', {'server_name': 'new', 'port': '23560'}), 'server_name = old\nkeep = yes\nport = 23560\n')

    def test_identical_bytes_and_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'minetest.conf'
            old = b'# operator\r\n server_name  = same\r\n'
            path.write_bytes(old)
            self.assertFalse(runtime.configure(path, {'server_name': 'same'}))
            self.assertEqual(path.read_bytes(), old)
            self.assertFalse(path.with_name(path.name + '.voltra-backup').exists())
            self.assertFalse(runtime.configure(path, {'server_name': 'changed'}))
            self.assertTrue(runtime.configure(path, {'server_name': 'changed', 'port': '23560'}))
            backups = list(path.parent.glob(path.name + '.voltra-backup-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), old)

    def test_invalid_config_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'minetest.conf'
            old = b'operator = {\nserver_name = nested\n'
            path.write_bytes(old)
            with self.assertRaises(ValueError):
                runtime.configure(path, {'server_name': 'new'})
            self.assertEqual(path.read_bytes(), old)

    def test_environment_bounds(self):
        env = dict(SERVER_ADMIN_NAME='Owner', SERVER_NAME='Server', SERVER_ANNOUNCE='false', SERVER_MAX_USERS='15', SERVER_PORT='23560', DEFAULT_GAME='minetest')
        self.assertEqual(runtime.settings(env)['server_announce'], 'false')
        for key, bad in [('SERVER_ADMIN_NAME', 'bad admin'), ('SERVER_PORT', '0'), ('SERVER_MAX_USERS', '65536'), ('DEFAULT_GAME', '../world'), ('SERVER_PASSWORD', '"""')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                runtime.settings(dict(env, **{key: bad}))

    def test_runtime_library_path_and_secret_arguments(self):
        env = dict(SERVER_ADMIN_NAME='Owner', SERVER_NAME='World, $literal', SERVER_ANNOUNCE='false', SERVER_MAX_USERS='15', SERVER_PORT='23560', DEFAULT_GAME='minetest', WORLD_NAME='world', SERVER_PASSWORD='private-fixture')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            game = root / '.minetest/games/minetest'
            game.mkdir(parents=True)
            (game / 'game.conf').write_text('title = Fixture\n')
            (root / '.voltra').mkdir()
            (root / '.voltra/luanti-admin.lua').write_text('-- fixture\n')
            version = types.SimpleNamespace(stdout='Luanti 5.17.0 (Linux)\n')
            with mock.patch.object(runtime.subprocess, 'run', return_value=version) as run, mock.patch.object(runtime.os, 'execve') as execute, mock.patch.object(runtime.os, 'chdir'):
                runtime.launch(root, env)
            expected = str(root / '.voltra/luanti-libs')
            self.assertEqual(run.call_args.kwargs['env']['LD_LIBRARY_PATH'], expected)
            binary, arguments, child_env = execute.call_args.args
            self.assertEqual(child_env['LD_LIBRARY_PATH'], expected)
            self.assertEqual(child_env['LUANTI_USER_PATH'], str(root / '.minetest'))
            self.assertEqual(child_env['VOLTRA_LUANTI_PLAIN_CONSOLE'], '1')
            self.assertNotIn(env['SERVER_PASSWORD'], ' '.join(arguments))
            self.assertNotIn(env['SERVER_NAME'], ' '.join(arguments))
            self.assertEqual(binary, str(root / '.voltra/luanti/bin/luantiserver'))

    def test_old_engine_rejected_before_config_write(self):
        env = dict(SERVER_ADMIN_NAME='Owner', SERVER_NAME='Server', SERVER_ANNOUNCE='false', SERVER_MAX_USERS='15', SERVER_PORT='23560', DEFAULT_GAME='minetest', WORLD_NAME='world')
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(runtime.subprocess, 'run', return_value=types.SimpleNamespace(stdout='Luanti 5.16.1 (Linux)\n')):
            with self.assertRaises(ValueError):
                runtime.launch(directory, env)
            self.assertFalse((Path(directory) / '.minetest/minetest.conf').exists())

    def test_admin_pending_secret_is_private_and_existing_receipt_reused(self):
        env = dict(SERVER_ADMIN_NAME='Owner', BOOTSTRAP_ADMIN='1')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.voltra').mkdir()
            (root / '.voltra/luanti-admin.lua').write_text('-- fixture\n')
            runtime.prepare_admin(root, 'world', env)
            world = root / '.minetest/worlds/world'
            pending = world / '.voltra-admin-bootstrap.json'
            generated = json.loads(pending.read_text())
            self.assertTrue(generated['generated'])
            self.assertGreaterEqual(len(generated['password']), 32)
            if os.name != 'nt':
                self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
            pending.rename(world / 'voltra-admin-password-Owner.json')
            runtime.prepare_admin(root, 'world', env)
            self.assertEqual(json.loads(pending.read_text())['password'], generated['password'])
            self.assertEqual(json.loads((world / 'voltra-admin-password-Owner.json').read_text()), generated)
            runtime.prepare_admin(root, 'world', dict(env, SERVER_ADMIN_PASSWORD='chosen-fixture'))
            self.assertEqual(json.loads(pending.read_text())['password'], 'chosen-fixture')
            self.assertFalse(json.loads(pending.read_text())['generated'])

    def test_disabled_admin_does_not_generate_a_password(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.voltra').mkdir()
            (root / '.voltra/luanti-admin.lua').write_text('-- fixture\n')
            runtime.prepare_admin(root, 'world', dict(SERVER_ADMIN_NAME='Owner', BOOTSTRAP_ADMIN='0'))
            data = json.loads((root / '.minetest/worlds/world/.voltra-admin-bootstrap.json').read_text())
            self.assertFalse(data['enabled'])
            self.assertEqual(data['password'], '')


def game_zip(extra=(), symlink=False):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as zipped:
        zipped.writestr('pack/game.conf', 'title = Fixture Game\n')
        zipped.writestr('pack/mods/fixture/init.lua', '-- fixture\n')
        for name, value in extra:
            entry = zipfile.ZipInfo('literal-entry')
            entry.filename = entry.orig_filename = name
            zipped.writestr(entry, value)
        if symlink:
            link = zipfile.ZipInfo('pack/link')
            link.create_system = 3
            link.external_attr = (stat.S_IFLNK | 0o777) << 16
            zipped.writestr(link, '../outside')
    return stream.getvalue()


class GameTests(unittest.TestCase):
    def setUp(self):
        self.env = dict(DEFAULT_GAME='minetest', COMMUNITY_DOWNLOAD='1', COMMUNITY_GAME_AUTOR='FixtureAuthor', COMMUNITY_GAME_NAME='fixture_game', COMMUNITY_GAME_RELEASE='38214')
        self.archive = game_zip()
        self.release = dict(id=38214, url='https://cdn.content.luanti.org/test.zip', size=len(self.archive), min_minetest_version={'name': '5.8'}, max_minetest_version=None)

    def fetch(self, url):
        return dict(self.release) if '/releases/' in url else {'type': 'game'}

    def test_default_fallback_pins_game_tree_across_zip_envelopes(self):
        env=dict(self.env,COMMUNITY_GAME_AUTOR='Luanti',COMMUNITY_GAME_NAME='minetest_game')
        repacked=io.BytesIO()
        with zipfile.ZipFile(repacked,'w',compression=zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr('another-root/mods/fixture/init.lua','-- fixture\n')
            zipped.writestr('another-root/game.conf','title = Fixture Game\n')
        self.assertNotEqual(self.archive,repacked.getvalue())
        for archive in (self.archive,repacked.getvalue()):
            with tempfile.TemporaryDirectory() as directory,mock.patch.object(installer,'REVIEWED_GAME_TREE','33cc5127dd2a280f666f3fa3261e396c38bd8e3a58131a742c6c65644e249fca'):
                def unavailable(_):raise installer.MetadataUnavailable('ContentDB unavailable',503)
                def download(url):
                    self.assertEqual(url,installer.REVIEWED_GAME_GIT_URL)
                    return io.BytesIO(archive)
                self.assertTrue(installer.install(directory,env,unavailable,download))
                receipt=json.loads((Path(directory)/'.minetest/games/minetest/.voltra-contentdb.json').read_text())
                self.assertEqual(receipt['source'],'reviewed_official_git_commit')
                self.assertEqual(receipt['commit'],'c42e4d0c0ff9d27ff7b9b308c3cfc14098dd3a0f')

    def test_exact_default_cache_avoids_network_and_tamper_never_publishes(self):
        env=dict(self.env,COMMUNITY_GAME_AUTOR='Luanti',COMMUNITY_GAME_NAME='minetest_game')
        for archive,valid in [(self.archive,True),(game_zip([('pack/extra.lua','unexpected')]),False)]:
            with tempfile.TemporaryDirectory() as directory,mock.patch.object(installer,'REVIEWED_GAME_TREE','33cc5127dd2a280f666f3fa3261e396c38bd8e3a58131a742c6c65644e249fca'):
                root=Path(directory);cache=root/'.voltra/luanti-cache'/('minetest-game-'+installer.REVIEWED_GAME_COMMIT+'.zip');cache.parent.mkdir(parents=True);cache.write_bytes(archive)
                def no_network(_):self.fail('Verified default cache must avoid network')
                if valid:self.assertTrue(installer.install(root,env,no_network,no_network))
                else:
                    with self.assertRaisesRegex(ValueError,'content tree'):installer.install(root,env,no_network,no_network)
                    self.assertFalse((root/'.minetest/games/minetest').exists())

    def test_fallback_never_changes_custom_latest_or_authorization_semantics(self):
        exact=dict(self.env,COMMUNITY_GAME_AUTOR='Luanti',COMMUNITY_GAME_NAME='minetest_game')
        for env,status in [(exact,403),(dict(exact,COMMUNITY_GAME_RELEASE='0'),503),(self.env,503)]:
            with tempfile.TemporaryDirectory() as directory:
                def unavailable(_):raise installer.MetadataUnavailable('Metadata unavailable',status)
                def no_download(_):self.fail('Fallback must not change requested release or permissions')
                with self.assertRaises(installer.MetadataUnavailable):installer.install(directory,env,unavailable,no_download)
                self.assertFalse((Path(directory)/'.minetest/games/minetest').exists())

    def test_staged_install_and_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertTrue(installer.install(directory, self.env, self.fetch, lambda _: io.BytesIO(self.archive)))
            game = Path(directory) / '.minetest/games/minetest'
            self.assertTrue((game / 'game.conf').is_file())
            receipt = json.loads((game / '.voltra-contentdb.json').read_text())
            self.assertEqual(receipt['release'], 38214)
            self.assertEqual(receipt['archive_bytes'], len(self.archive))
            self.assertEqual(len(receipt['archive_sha256']), 64)

    def test_reinstall_retains_operator_game_and_world_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            game = Path(directory) / '.minetest/games/minetest'
            game.mkdir(parents=True)
            (game / 'game.conf').write_bytes(b'title = Operator\n')
            world = Path(directory) / '.minetest/worlds/world/map.sqlite'
            world.parent.mkdir(parents=True)
            world.write_bytes(b'existing-world-fixture')
            def no_network(_):
                self.fail('Existing game must not trigger network requests')
            self.assertFalse(installer.install(directory, self.env, no_network, no_network))
            self.assertEqual((game / 'game.conf').read_bytes(), b'title = Operator\n')
            self.assertEqual(world.read_bytes(), b'existing-world-fixture')

    def test_manual_mode_accepts_post_install_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertFalse(installer.install(directory, dict(self.env, COMMUNITY_DOWNLOAD='0')))
            self.assertTrue((Path(directory) / '.minetest/games').is_dir())

    def test_invalid_archives_never_publish_game(self):
        archives = [game_zip([('../outside', 'bad')]), game_zip([('/absolute', 'bad')]), game_zip([('pack\\escape', 'bad')]), game_zip([('other/game.conf', 'other')]), game_zip(symlink=True), b'not a zip']
        for archive in archives:
            with self.subTest(size=len(archive)), tempfile.TemporaryDirectory() as directory:
                release = dict(self.release, size=len(archive))
                fetch = lambda url: release if '/releases/' in url else {'type': 'game'}
                with self.assertRaises((ValueError, zipfile.BadZipFile)):
                    installer.install(directory, self.env, fetch, lambda _: io.BytesIO(archive))
                self.assertFalse((Path(directory) / '.minetest/games/minetest').exists())
                self.assertFalse(list((Path(directory) / '.minetest/games').glob('.luanti-game-*')))

    def test_truncated_download_not_published(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            installer.install(directory, self.env, self.fetch, lambda _: io.BytesIO(self.archive[:-1]))

    def test_reviewed_default_rejects_a_changed_archive(self):
        env = dict(self.env, COMMUNITY_GAME_AUTOR='Luanti', COMMUNITY_GAME_NAME='minetest_game')
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'checksum'):
                installer.install(directory, env, self.fetch, lambda _: io.BytesIO(self.archive))
            self.assertFalse((Path(directory) / '.minetest/games/minetest').exists())

    def test_package_type_and_release_compatibility(self):
        for release in [dict(self.release, id=4), dict(self.release, min_minetest_version={'name': '5.18'}), dict(self.release, max_minetest_version={'name': '5.16'}), dict(self.release, min_minetest_version={'name': 'unknown'})]:
            with self.subTest(release=release), self.assertRaises(ValueError):
                installer.select_release('Luanti', 'minetest_game', 38214, lambda url: release if '/releases/' in url else {'type': 'game'})
        with self.assertRaises(ValueError):
            installer.select_release('Author', 'mod', 1, lambda _: {'type': 'mod'})

    def test_latest_selects_compatible_release(self):
        releases = [dict(self.release, id=1), dict(self.release, id=2, min_minetest_version={'name': '5.18'})]
        chosen = installer.select_release('Luanti', 'game', 0, lambda url: releases if '/releases/' in url else {'type': 'game'})
        self.assertEqual(chosen['id'], 1)


class ConsolePatchTests(unittest.TestCase):
    def test_preserves_original_console_and_rejects_wrong_source(self):
        source = '#include <inttypes.h>\nvoid *TerminalChatConsole::run()\n{\n\tBEGIN_DEBUG_EXCEPTION_HANDLER\nORIGINAL_CONSOLE_BODY\n}\n'
        adapter = '// VOLTRA_LUANTI_PLAIN_CONSOLE adapter\n'
        result = patcher.patch(source, adapter)
        self.assertIn('ORIGINAL_CONSOLE_BODY', result)
        self.assertIn('#include <termios.h>', result)
        self.assertIn(adapter, result)
        with self.assertRaises(ValueError):
            patcher.patch(result, adapter)
        with self.assertRaises(ValueError):
            patcher.patch(source.replace('TerminalChatConsole::run()', 'ChangedConsole::run()'), adapter)


if __name__ == '__main__':
    unittest.main()
