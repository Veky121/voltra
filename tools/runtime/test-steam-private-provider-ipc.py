"""Actual compiled .NET worker, anonymous FDs only; public fake literals, no auth."""
import fcntl
import json
import os
from pathlib import Path
import resource
import signal
import struct
import subprocess
import tempfile
import time
import unittest

SDK='/work/sdk/dotnet';WORKER='/work/build/Worker.dll'


class WorkerIPC(unittest.TestCase):
    def test_metadata_uint64_strings_actual_process_fd(self):
        incoming,outgoing=os.pipe()
        env={'HOME':'/work/home','DOTNET_ROOT':'/work/sdk','DOTNET_SYSTEM_GLOBALIZATION_INVARIANT':'1','DOTNET_EnableDiagnostics':'0','LD_LIBRARY_PATH':'/work/fixture-libs'}
        child=subprocess.Popen([SDK,WORKER,'--self-test-metadata-fd',str(outgoing)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,pass_fds=(outgoing,),start_new_session=True)
        os.close(outgoing)
        try:
            stdout,stderr=child.communicate(timeout=5);self.assertEqual((child.returncode,stdout,stderr),(0,b'',b''))
            with os.fdopen(incoming,'rb',closefd=False) as stream:
                size=struct.unpack('<I',stream.read(4))[0];self.assertLess(size,4096);raw=stream.read(size);self.assertEqual(len(raw),size)
            data=json.loads(raw);manifest=data['metadata']['depots'][0]['manifests'][0]
            self.assertEqual(manifest['manifest_id'],'3659990775896995763')
            self.assertEqual(manifest['disk_bytes'],'21349240119');self.assertEqual(manifest['download_bytes'],'2653127216')
            self.assertEqual(data['metadata']['branches'][0]['build_id'],'25642172')
            # Public synthetic fixture, archived for executed JS JSON.parse check.
            Path('/work/metadata-abi-fixture.json').write_bytes(raw)
        finally:
            if child.poll() is None:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)
            os.close(incoming)

    def exercise(self,*,beta='  +literal "quote" \\ λé\t\x01\x7f  ',sealed=True,invalid=False,cancel=False,operation='prepare_only'):
        literal='  +PRIVATE_PROTOCOL_FIXTURE "quotes" \\ λé\t\x7f  '
        request={'operation':operation,'username':literal,'password':literal,'guard':literal,'branch':'preview','beta_password':beta,'app_id':42,'parent_fields_validated':True}
        raw=json.dumps(request,ensure_ascii=False).encode();frame=struct.pack('<I',len(raw))+raw
        if invalid:frame=struct.pack('<I',1000000)
        events,event_write=os.pipe();replies,reply_write=os.pipe()
        if sealed:
            incoming=os.memfd_create('public-request',os.MFD_ALLOW_SEALING);os.write(incoming,frame);os.lseek(incoming,0,os.SEEK_SET)
            fcntl.fcntl(incoming,fcntl.F_ADD_SEALS,fcntl.F_SEAL_WRITE|fcntl.F_SEAL_GROW|fcntl.F_SEAL_SHRINK|fcntl.F_SEAL_SEAL);input_write=None
        else:incoming,input_write=os.pipe()
        with tempfile.TemporaryDirectory(prefix='private-ipc-',dir='/work')as scratch:
            environment={'HOME':scratch,'DOTNET_ROOT':'/work/sdk','DOTNET_CLI_HOME':scratch,'LD_LIBRARY_PATH':'/work/fixture-libs','DOTNET_SYSTEM_GLOBALIZATION_INVARIANT':'1','DOTNET_EnableDiagnostics':'0','DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_NOLOGO':'1'}
            def setup():os.umask(0o077);resource.setrlimit(resource.RLIMIT_CORE,(0,0))
            child=subprocess.Popen([SDK,WORKER,'--request-fd',str(incoming),'--event-fd',str(event_write),'--reply-fd',str(replies)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=environment,cwd=scratch,pass_fds=(incoming,event_write,replies),start_new_session=True,preexec_fn=setup)
            os.close(incoming);os.close(event_write);os.close(replies)
            try:
                if not sealed:
                    time.sleep(.1)
                    for name in ('cmdline','environ'):
                        actual=Path('/proc/'+str(child.pid)+'/'+name).read_bytes();self.assertNotIn(literal.encode(),actual);self.assertNotIn(beta.encode(),actual)
                    if cancel:child.send_signal(signal.SIGTERM)
                    else:
                        # Fragmented frame proves ReadExact state, not one-write luck.
                        for index in range(0,len(frame),3):os.write(input_write,frame[index:index+3])
                stdout,stderr=child.communicate(timeout=5);self.assertEqual(stdout,b'');self.assertEqual(stderr,b'')
                with os.fdopen(events,'rb',closefd=False)as stream:
                    size=stream.read(4);self.assertEqual(len(size),4);response=json.loads(stream.read(struct.unpack('<I',size)[0]))
                self.assertNotIn(literal,json.dumps(response));self.assertNotIn(beta,json.dumps(response))
                if invalid:self.assertEqual((child.returncode,response['code']),(3,'invalid_frame'))
                elif cancel:self.assertEqual((child.returncode,response['code']),(4,'cancelled'))
                elif operation=='anonymous_metadata':self.assertEqual((child.returncode,response['code']),(3,'metadata_credentials_not_allowed'))
                elif operation!='prepare_only':self.assertEqual((child.returncode,response['code']),(3,'invalid_request'))
                elif len(beta.encode())>1024:self.assertEqual((child.returncode,response['code']),(3,'invalid_beta_field'))
                else:self.assertEqual((child.returncode,response['status']),(0,'provider_not_enabled'))
                self.assertEqual(list(Path(scratch).rglob('*')),[])
            finally:
                if child.poll()is None:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)
                if input_write is not None:os.close(input_write)
                os.close(events);os.close(reply_write)

    def test_unknown_operation_cannot_enable_transport(self):self.exercise(operation='authenticate')
    def test_metadata_rejects_credentials_before_transport(self):self.exercise(operation='anonymous_metadata')

    def test_sealed_memfd_literal_fields_no_secret_output_or_files(self):self.exercise()
    def test_fragmented_private_pipe_no_argv_or_environment_credentials(self):self.exercise(sealed=False)
    def test_original_beta1024_utf8_byte_boundary(self):self.exercise(beta='λ'*512)
    def test_original_beta1026_utf8_bytes_fixed_error(self):self.exercise(beta='λ'*513)
    def test_bad_frame_fixed_error(self):self.exercise(invalid=True)
    def test_real_process_sigterm_cancels_partial_input(self):self.exercise(sealed=False,cancel=True)


if __name__=='__main__':unittest.main()
