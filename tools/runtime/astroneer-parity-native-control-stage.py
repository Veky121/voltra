from pathlib import Path
root=Path('.')
source=root/'internal/panel/game_library/scripts/native-console.py'
text=source.read_text()
text=text.replace('stop_signal_timeout=60):','stop_signal_timeout=60, control_transport=None):',1)
text=text.replace('    if output_observer is not None and not callable(output_observer):',"    if control_transport is not None and not all(callable(getattr(control_transport, name, None)) for name in ('start', 'command', 'stop', 'close')):raise ValueError('Invalid native control transport')\n    if control_transport is not None and stop_sequence:raise ValueError('Transport shutdown and stdin sequence are exclusive')\n    if output_observer is not None and not callable(output_observer):",1)
text=text.replace("    def forward():\n        pending=b''", "    def forward():\n        if control_transport is not None:\n            pending=b'';overflow=False\n            try:\n                for block in iter(lambda:os.read(sys.stdin.fileno(),65536),b''):\n                    for byte in block:\n                        if byte in (10,13):\n                            if pending and not overflow:\n                                try:line=pending.decode('utf-8',errors='strict')\n                                except UnicodeError:line=''\n                                if line==stop_command:stop()\n                                elif line:\n                                    try:control_transport.command(line)\n                                    except Exception:emit_control('[ERROR] Native control command failed')\n                            elif overflow:emit_control('[WARN] Native control input exceeds limit')\n                            pending=b'';overflow=False\n                        elif not overflow:\n                            pending+=bytes([byte])\n                            if len(pending)>4096:pending=b'';overflow=True\n            except OSError:pass\n            return\n        pending=b''",1)
text=text.replace('        deliver(stop_signal)\n','        deliver(stop_signal if stop_signal is not None else signal.SIGINT)\n',1)
text=text.replace('    def stop(*_):\n        requested_stop.set()',"    def transport_stop():\n        try:control_transport.stop()\n        except Exception:emit_control('[ERROR] Native control shutdown failed')\n        if finished.wait(stop_signal_timeout)or child.poll()is not None:return\n        emit_control('[WARN] Native protocol shutdown grace expired; using existing signal fallback; save completion unconfirmed')\n        native_signal_stop()\n    def stop(*_):\n        requested_stop.set()\n        if control_transport is not None:\n            if not stopping.is_set():\n                stopping.set();threading.Thread(target=transport_stop,daemon=True).start()\n            return",1)
text=text.replace('    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)',"    def emit_control(message):\n        if not isinstance(message,str)or len(message)>8192:raise ValueError('Invalid transport message')\n        # A separate redactor avoids racing the streamed native output state.\n        safe=''.join(c for c in message if c=='\\t'or 32<=ord(c)<127)\n        print(Redactor(credentials).feed((safe+'\\n').encode('utf-8'),final=True).decode('utf-8'),end='',flush=True)\n    signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)\n    if control_transport is not None:\n        try:control_transport.start(child,emit_control)\n        except Exception:\n            child.terminate();child.wait(timeout=10);output.close()\n            if master is not None:os.close(master)\n            raise RuntimeError('Native control startup failed')from None",1)
text=text.replace('        finished.set(); ready.set()\n','        finished.set(); ready.set()\n        if control_transport is not None:control_transport.close()\n',1)
cleanup = '''def _close_control_transport(transport):
    try:transport.close()
    except BaseException:
        # Cleanup hooks must not replace an already-observed native exit/error.
        try:print('[ERROR] Native control cleanup failed; original exit retained',flush=True)
        except OSError:pass


def _abort_control_start(child, output, master, transport):
    # Only the Popen created by run(start_new_session=True) is accepted here.
    # Kill the group even if its leader exits first and leaves descendants.
    try:
        if os.name == 'posix':
            try:os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError:pass
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:pass
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        else:
            try:child.terminate()
            except OSError:pass
            try:child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                try:child.kill()
                except OSError:pass
        try:child.wait(timeout=2)
        except subprocess.TimeoutExpired:pass
    finally:
        try:_close_control_transport(transport)
        finally:
            try:output.close()
            finally:
                if master is not None:
                    try:os.close(master)
                    except OSError:pass


'''
text=text.replace('def run(root, argv,',cleanup+'def run(root, argv,',1)
text=text.replace("        except Exception:\n            child.terminate();child.wait(timeout=10);output.close()\n            if master is not None:os.close(master)\n            raise RuntimeError('Native control startup failed')from None", "        except BaseException:\n            try:_abort_control_start(child,output,master,control_transport)\n            except BaseException:pass\n            raise RuntimeError('Native control startup failed')from None",1)
text=text.replace('        if control_transport is not None:control_transport.close()', '        if control_transport is not None:_close_control_transport(control_transport)',1)
text=text.replace('                            if pending and not overflow:', '                            if pending and not overflow and child.poll() is None:',1)
out=root/'artifacts/game-parity-20261029/astroneer-native-console.py.pending'
out.write_text(text)
compile(text,str(out),'exec')
print('Staged opt-in shared transport hook; canonical supervisor unchanged')
