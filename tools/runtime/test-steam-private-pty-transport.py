import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest

spec=importlib.util.spec_from_file_location('transport',Path(__file__).with_name('steam-private-pty-transport.py'))
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)


class PromptTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.exe=self.root/'fake-steam';self.receipt=self.root/'received.json'

    def tearDown(self):self.tmp.cleanup()

    def engine(self,body):
        self.exe.write_text('#!/usr/local/bin/python3\nimport os,sys,time,json,termios\n'+body)
        self.exe.chmod(0o700)

    def test_fragmented_prompts_preserve_utf8_quotes_prefix_and_edge_spaces(self):
        password='  +literal "quote" \\ λé  '
        guard='-literal "guard" \\ λé'
        self.engine("""assert not any(k in os.environ for k in ['STEAM_PASS','STEAM_AUTH','SRCDS_BETAPASS'])
assert not termios.tcgetattr(0)[3] & (termios.ECHO|termios.ECHONL)
for part in [b'Pass',b'word: ']:os.write(1,part);time.sleep(.03)
p=sys.stdin.buffer.readline().rstrip(b'\\n')
os.write(1,p+b'\\n') # deliberate bad publisher echo must never escape transport
for part in [b'Enter Steam ',b'Guard code: ']:os.write(1,part);time.sleep(.03)
g=sys.stdin.buffer.readline().rstrip(b'\\n')
open("""+repr(str(self.receipt))+""",'w').write(json.dumps({'password':p.hex(),'guard':g.hex()}))
""")
        result=t.run(self.exe,'voltra_fixture',parent=self.root,password=password,guard=guard)
        self.assertEqual(result['sent_fields'],['password','guard'])
        self.assertEqual(json.loads(self.receipt.read_text()),{'password':password.encode().hex(),'guard':guard.encode().hex()})
        self.assertNotIn('literal',repr(result))

    def test_native_probe_stops_before_any_input(self):
        self.engine("os.write(1,b'Password: ');sys.stdin.buffer.readline();open("+repr(str(self.receipt))+",'w').write('unexpected input')\n")
        result=t.run(self.exe,'fixture',parent=self.root,abort_at_password=True)
        self.assertTrue(result['aborted_before_secret']);self.assertEqual(result['sent_fields'],[])
        self.assertFalse(self.receipt.exists())

    def test_wrong_order_repeated_prompt_and_echo_reenable_fail_closed(self):
        bodies=["os.write(1,b'Steam Guard code: ');time.sleep(10)",
            "os.write(1,b'Password: ');sys.stdin.buffer.readline();os.write(1,b'Password: ');time.sleep(10)",
            "a=termios.tcgetattr(0);a[3]|=termios.ECHO;termios.tcsetattr(0,termios.TCSANOW,a);os.write(1,b'Password: ');time.sleep(10)"]
        for body in bodies:
            self.engine(body)
            with self.assertRaises(t.PromptError) as error:
                t.run(self.exe,'fixture',parent=self.root,password='private-password',guard='private-guard',timeout=2)
            self.assertNotIn('private-password',str(error.exception))

    def test_timeout_cancel_and_controls(self):
        self.engine('time.sleep(10)')
        for kwargs in [{'timeout':.1},{'cancel':lambda:True}]:
            start=time.monotonic()
            with self.assertRaises(t.PromptError):t.run(self.exe,'fixture',parent=self.root,password='private',**kwargs)
            self.assertLess(time.monotonic()-start,2)
        for password in ['a\nb','a\rb','a\tb','a\0b','a\x7fb']:
            with self.assertRaises(t.PromptError):t.run(self.exe,'fixture',parent=self.root,password=password)

    def test_unrecognized_prompt_gets_no_secret(self):
        self.engine("os.write(1,b'not a password: ');time.sleep(10)")
        with self.assertRaisesRegex(t.PromptError,'timed out'):
            t.run(self.exe,'fixture',parent=self.root,password='private',timeout=.15)

    def test_beta_password_is_separate_and_fails_before_side_effects(self):
        with self.assertRaisesRegex(t.PromptError,'beta password prompt'):
            t.beta_password_transport(self.exe,'fixture-private-beta')
        self.assertEqual(list(self.root.iterdir()),[])

    def test_multibyte_maximum_literal_is_not_truncated_by_terminal(self):
        password='λ'*1024
        self.engine("os.write(1,b'Password: ');p=sys.stdin.buffer.readline().rstrip(b'\\n');open("+repr(str(self.receipt))+",'w').write(json.dumps({'bytes':len(p),'hex':p.hex()}))")
        result=t.run(self.exe,'fixture',parent=self.root,password=password)
        self.assertEqual(result['sent_fields'],['password'])
        self.assertEqual(json.loads(self.receipt.read_text())['hex'],password.encode().hex())


unittest.main()
