import importlib.util,unittest,io
from types import SimpleNamespace
from unittest.mock import Mock,patch
from pathlib import Path
p=Path(__file__).resolve().parents[2]/'internal/panel/game_library/scripts/empyrion-console.py'
spec=importlib.util.spec_from_file_location('empyrion_console',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NativeLogSourceTests(unittest.TestCase):
 def drive(self,chunks,child_exit=False):
  output=io.BytesIO();alive=[True]
  process=Mock(pid=12345)
  process.poll.side_effect=lambda:None if alive[0] else 7
  def wait(**kwargs):alive[0]=False;return 7
  process.wait.side_effect=wait
  connection=Mock();iterator=iter(chunks)
  def receive(_):
   value=next(iterator)
   if isinstance(value,Exception):raise value
   if child_exit:alive[0]=False
   return value
  connection.recv.side_effect=receive
  with patch.object(m.subprocess,'Popen',return_value=process),patch.object(m.socket,'create_connection',return_value=connection),patch.object(m.threading,'Thread'),patch.object(m.signal,'signal'),patch.object(m.os,'killpg',create=True),patch.object(m.sys,'stdout',SimpleNamespace(buffer=output)):
   if child_exit:self.assertEqual(m.run(1030,['mock-child'],{}),7)
   else:
    with self.assertRaises((ValueError,ConnectionResetError)):m.run(1030,['mock-child'],{})
  connection.close.assert_called_once()
  return output.getvalue()
 def test_unterminated_response_survives_eof(self):
  self.assertEqual(self.drive([b'command result without newline',b'']),b'command result without newline')
 def test_unterminated_response_survives_child_exit(self):
  self.assertEqual(self.drive([b'child final output'],child_exit=True),b'child final output')
 def test_tail_survives_reset_without_repeating_complete_rows(self):
  self.assertEqual(self.drive([b'complete\npartial',ConnectionResetError()]),b'complete\npartial')
 def test_duplicate_native_log_tail_is_still_filtered(self):
  self.assertEqual(self.drive([b'30-03:47:44.881 03_47 -LOG- repeated',b'']),b'')
 def test_oversized_tail_does_not_bypass_framing_bound(self):
  self.assertEqual(self.drive([b'x'*8193]),b'')
 def test_real_publisher_records_have_single_file_source(self):
  for severity in (b'LOG',b'WRN',b'ERR'):
   self.assertEqual(m.command_output(b'30-03:47:44.881 03_47 -'+severity+b'- Server started listening on port 29106\r\n'),b'')
 def test_help_ticks_and_errors_remain_visible(self):
  data=b' - saveandexit: Saves the game and exits\r\nTicks: 975\r\nError: unknown command\r\n'
  self.assertEqual(m.command_output(data),data)
 def test_mixed_native_record_and_command_response(self):
  self.assertEqual(m.command_output(b'30-03:47:44.881 03_47 -LOG- Start Game\r\nhelp response\r\n'),b'help response\r\n')
 def test_unrecognized_records_are_preserved(self):
  self.assertEqual(m.command_output(b'Operator message -LOG- useful\r\n'),b'Operator message -LOG- useful\r\n')
if __name__=='__main__':unittest.main()
