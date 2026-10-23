import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch, Mock
import subprocess

steam=types.ModuleType('steam_template');exec(STEAM_SOURCE,steam.__dict__)


class SteamTemplateTests(unittest.TestCase):
    def test_explicit_linux_platform_is_opt_in_and_precedes_login(self):
        original=steam.arguments(Path('/server'),222860,{})
        explicit=steam.arguments(Path('/server'),222860,{},force_platform=True)
        self.assertNotIn('+@sSteamCmdForcePlatformType',original)
        position=explicit.index('+@sSteamCmdForcePlatformType')
        self.assertEqual(explicit[position+1],'linux');self.assertLess(position,explicit.index('+login'))
        with self.assertRaises(ValueError):steam.arguments(Path('/server'),222860,{},force_platform='linux')

    def test_invalid_platform_classifier_matches_only_exact_target_error(self):
        message=b"ERROR! Failed to install app '222860' (Invalid platform)"
        self.assertEqual(steam.failure_reason(b'\x1b[0m'+message+b'\r\n',222860),'invalid_platform')
        for data,appid in [(message,232330),(message+b' extra',222860),(b'Invalid platform',222860),(b"ERROR! Failed to install app '222860' (No subscription)",222860)]:
            self.assertEqual(steam.failure_reason(data,appid),'steamcmd_failed')

    def test_streamed_failed_process_raises_safe_structured_platform_error(self):
        with tempfile.TemporaryDirectory() as directory:
            child=Mock();child.stdout.read1.side_effect=[b"ERROR! Failed to install app '222",b"860' (Invalid plat",b'form)\r\n',b''];child.wait.return_value=8
            output=Mock();output.buffer=io.BytesIO()
            with patch.object(steam,'bootstrap'),patch.object(steam.subprocess,'Popen',return_value=child),patch('sys.stdout',output):
                with self.assertRaises(steam.SteamInstallError) as error:steam.update(Path(directory),222860,{})
            self.assertEqual((error.exception.app_id,error.exception.status,error.exception.reason),(222860,8,'invalid_platform'))

    def test_windows_depots_require_an_explicit_reviewed_platform(self):
        args=steam.arguments(Path('/server'),2278520,{'WINDOWS_INSTALL':'1'},platform='windows')
        position=args.index('+@sSteamCmdForcePlatformType')
        self.assertEqual(args[position+1],'windows')
        self.assertLess(position,args.index('+login'))
        self.assertNotIn('+@sSteamCmdForcePlatformType',steam.arguments(Path('/server'),380870,{}))
        for platform,env in [('linux',{'WINDOWS_INSTALL':'1'}),('windows',{'WINDOWS_INSTALL':'0'}),('macos',{})]:
            with self.assertRaises(ValueError):steam.arguments(Path('/server'),2278520,env,platform=platform)

    def test_hlds_mod_selection_is_typed_and_precedes_update(self):
        args=steam.arguments(Path('/server'),90,{'HLDS_GAME':'valve'})
        position=args.index('+app_set_config')
        self.assertEqual(args[position:position+4],['+app_set_config','90','mod','valve'])
        self.assertLess(position,args.index('+app_update'))
        self.assertNotIn('+app_set_config',steam.arguments(Path('/server'),232330,{'HLDS_GAME':'+quit'}))
        for game in ['', '../valve', '+quit', 'valve;quit', 'bad\nmod', 'x'*33]:
            with self.assertRaises(ValueError):steam.arguments(Path('/server'),90,{'HLDS_GAME':game})

    def test_interrupted_child_timeout_does_not_expose_command_arguments(self):
        with tempfile.TemporaryDirectory() as directory:
            child=Mock();child.stdout.read1.side_effect=KeyboardInterrupt
            child.wait.side_effect=[subprocess.TimeoutExpired(['fixture-private-password'],30),0]
            with patch.object(steam,'bootstrap'),patch.object(steam.subprocess,'Popen',return_value=child):
                with self.assertRaises(RuntimeError) as error:
                    steam.update(Path(directory),380870,{})
            self.assertNotIn('fixture-private-password',str(error.exception))
            self.assertEqual(child.kill.call_count,1)

    def test_cold_cache_refresh_precedes_target_mutation(self):
        args=steam.arguments(Path('/server with spaces'),380870,{},True)
        self.assertEqual(args[0],'/server with spaces/.voltra/steamcmd/steamcmd.sh')
        self.assertEqual(args[args.index('+login')+1],'anonymous')
        self.assertLess(args.index('+app_info_update'),args.index('+app_info_print'))
        self.assertLess(args.index('+app_info_print'),args.index('+app_update'))
        self.assertEqual(args[args.index('+app_info_print')+1],'380870')
        self.assertIn('validate',args)

    def test_public_branch_arguments_remain_separate_literals(self):
        env={'STEAM_USER':'anonymous','SRCDS_BETAID':'unstable'}
        args=steam.arguments(Path('/server'),380870,env,False)
        self.assertEqual(args[args.index('-beta')+1],'unstable')
        self.assertNotIn('validate',args)
        self.assertEqual(args[-1],'+quit')

    def test_unproved_credential_parser_paths_fail_before_side_effects(self):
        cases=[{'STEAM_USER':'fixture-user'},{'STEAM_PASS':'literal p;ass$word'},{'STEAM_AUTH':'fixture-secret'},{'SRCDS_BETAID':'private','SRCDS_BETAPASS':'fixture-beta-secret'}]
        for env in cases:
            with self.subTest(keys=list(env)),tempfile.TemporaryDirectory() as directory:
                with patch.object(steam,'bootstrap') as bootstrap,patch.object(steam.subprocess,'Popen') as process:
                    with self.assertRaises(ValueError) as error:steam.update(Path(directory),380870,env)
                bootstrap.assert_not_called();process.assert_not_called();self.assertEqual(list(Path(directory).iterdir()),[])
                for value in env.values():self.assertNotIn(value,str(error.exception))

    def test_reject_command_language_injection_and_unsupported_platform(self):
        for env in [{'SRCDS_BETAID':'../branch'},{'SRCDS_BETAID':'+quit'},{'STEAM_USER':'user'},{'STEAM_USER':'+quit','STEAM_PASS':'password'},{'STEAM_USER':'user','STEAM_PASS':'+app_update'},{'STEAM_PASS':'bad\npassword'},{'SRCDS_BETAPASS':'private'},{'WINDOWS_INSTALL':'1'},{'INSTALL_FLAGS':'+quit'}]:
            with self.assertRaises(ValueError):steam.arguments(Path('/server'),380870,env)
        for app_id in ['380870',True,0,-1,2**32]:
            with self.assertRaises(ValueError):steam.arguments(Path('/server'),app_id,{})

    def test_secret_redaction_at_every_pipe_boundary(self):
        values=['private credential','private','short','user$literal']
        text=b'prefix private credential middle short user$literal end'
        for width in range(1,len(text)+1):
            redactor=steam.Redactor(values)
            output=b''.join(redactor.feed(text[offset:offset+width]) for offset in range(0,len(text),width))+redactor.feed(b'',True)
            self.assertEqual(output,b'prefix [redacted] middle [redacted] [redacted] end')

    def test_manifest_requires_complete_correct_application(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);folder=root/'steamapps';folder.mkdir();path=folder/'appmanifest_380870.acf'
            good='"appid" "380870"\n"StateFlags" "4"\n"buildid" "123456"'
            path.write_text(good)
            self.assertEqual(steam.manifest(root,380870)['buildid'],123456)
            for value in [good.replace('380870','111'),good.replace('"4"','"6"'),good.replace('123456','0'),good+'\n"appid" "380870"',good.replace('"buildid" "123456"','')]:
                path.write_text(value)
                with self.assertRaises(ValueError):steam.manifest(root,380870)


unittest.main()
