import importlib.machinery,importlib.util,json,os,subprocess,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2];candidate=ROOT/'artifacts/game-parity-20261029/empyrion-console-proposal.py.pending'
loader=importlib.machinery.SourceFileLoader('empyrion_console_candidate',str(candidate));spec=importlib.util.spec_from_loader(loader.name,loader);proxy=importlib.util.module_from_spec(spec);loader.exec_module(proxy)
class ConsoleInputTests(unittest.TestCase):
 def parse(self,blocks):
  with patch.object(proxy.os,'read',side_effect=[*blocks,b'']):return list(proxy.raw_commands(0))
 def test_split_crlf_commands_and_partial_eof(self):
  self.assertEqual(self.parse([b'he',b'lp\r',b'\nstatus\n',b'saveandexit 0']),[b'help\r\n',b'status\r\n',b'saveandexit 0\r\n'])
 def test_whole_oversized_line_rejected_not_tail_command(self):
  self.assertEqual(self.parse([b'x'*8193,b'saveandexit 0\nhelp\n']),[b'help\r\n'])
 def test_nul_line_rejected_and_following_command_retained(self):
  self.assertEqual(self.parse([b'bad\0value\nhelp\n']),[b'help\r\n'])
 @unittest.skipUnless(os.name=='posix','Linux subprocess/owned-group regression')
 def test_real_proxy_exit0_while_wings_input_pipe_remains_open(self):
  process=subprocess.run([sys.executable,'-B',str(ROOT/'artifacts/game-parity-20261029/empyrion-console-held-stdin-test.py.pending'),str(candidate)],text=True,capture_output=True,timeout=12)
  self.assertEqual(process.returncode,0,process.stderr);receipt=json.loads(process.stdout)
  self.assertEqual(receipt['proxy_raw_exit'],0,receipt);self.assertFalse(receipt['buffered_stdin_fatal']);self.assertTrue(receipt['native_fixture_exit0_message'])
if __name__=='__main__':unittest.main()
