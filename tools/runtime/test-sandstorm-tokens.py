from pathlib import Path

class SandstormOptionalTokenTests(TacticalTests):
    def test_optional_token_combinations_and_literal_order(self):
        for login, stats in [('', ''), ('login.A_-9', ''), ('', 'stats.B_-8'), ('login.A_-9', 'stats.B_-8')]:
            with self.subTest(login=bool(login), stats=bool(stats)), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                env = self.fixture(root, 'sandstorm', GSLTT=login, GST=stats, HOSTNAME="Literal $name 'quoted'", ADDSWITCHES='-Mods')
                argv, child, secrets, ready = runtime.configure(root, env)
                expected = [str(root / installer.GAMES['sandstorm'][2]), 'Canyon?Scenario=Scenario_Crossing_Checkpoint_Insurgents?MaxPlayers=28', '-Port=28010', '-QueryPort=28011', '-log', "-hostname=Literal $name 'quoted'"]
                if login: expected += ['-GSLTToken=' + login]
                if stats: expected += ['-GameStats', '-GameStatsToken=' + stats]
                self.assertEqual(argv, expected + ['-Mods', '-stdout', '-FullStdOutLogOutput'])
                self.assertIn(login, secrets); self.assertIn(stats, secrets)

    def test_invalid_tokens_fail_before_operator_writes(self):
        for key in ('GSLTT', 'GST'):
            for value in ('bad token', 'bad\nvalue', 'x' * 513):
                with self.subTest(key=key, value_length=len(value)), tempfile.TemporaryDirectory() as directory:
                    root=Path(directory); env=self.fixture(root, 'sandstorm', **{key:value})
                    cfg=root/'Insurgency/Saved/Config/LinuxServer/Game.ini'; cfg.parent.mkdir(parents=True); cfg.write_bytes(b'; operator\nUnknown=73\n'); cfg.chmod(0o640)
                    before=(cfg.read_bytes(), cfg.stat().st_mode, cfg.stat().st_uid, cfg.stat().st_gid)
                    with self.assertRaises(ValueError): runtime.configure(root, env)
                    self.assertEqual((cfg.read_bytes(), cfg.stat().st_mode, cfg.stat().st_uid, cfg.stat().st_gid), before)

    def test_other_branches_exact_old_source_parity(self):
        old=types.ModuleType('old_tactical_runtime'); exec(OLD_RUNTIME, old.__dict__)
        for kind in ('squad','postscriptum'):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as directory:
                root=Path(directory); env=self.fixture(root,kind)
                before=old.configure(root,env)
                cfg=root/installer.GAMES[kind][1]/'ServerConfig/Server.cfg'
                contents=cfg.read_bytes(); identity=(cfg.stat().st_mode,cfg.stat().st_uid,cfg.stat().st_gid)
                after=runtime.configure(root,env)
                self.assertEqual(before,after); self.assertEqual(cfg.read_bytes(),contents)
                self.assertEqual((cfg.stat().st_mode,cfg.stat().st_uid,cfg.stat().st_gid),identity)

    def test_blank_tokens_preserve_existing_operator_config_and_raw_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);env=self.fixture(root,'sandstorm',AUTO_UPDATE='0')
            cfg=root/'Insurgency/Saved/Config/LinuxServer/Game.ini';cfg.parent.mkdir(parents=True);cfg.write_bytes(b'; original\nCustom=73\n');cfg.chmod(0o640)
            with mock.patch.object(runtime,'run',return_value=-11) as native:
                self.assertEqual(runtime.main(root,env),-11)
            self.assertEqual(cfg.read_bytes(),b'; original\nCustom=73\n')
            self.assertEqual(cfg.stat().st_mode & 0o777,0o640)
            self.assertEqual(native.call_args.kwargs['stop_signal'],signal.SIGINT)
            self.assertFalse(any(a.startswith('-GSLTToken=') or a.startswith('-GameStats') for a in native.call_args.args[1]))
