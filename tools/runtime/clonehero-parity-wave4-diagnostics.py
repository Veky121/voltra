"""Clone-only raw-exit diagnostic; no exit remapping or shared-helper edits."""
import importlib.util
import json
from pathlib import Path
import signal
import sys


def main():
    root = Path.cwd()
    sys.path.insert(0, str(root / '.voltra'))
    spec = importlib.util.spec_from_file_location('clone_original_runtime', root / '.voltra/small_games_family_runtime.py')
    runtime = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runtime)
    cwd, argv, environment, stop, credentials, marker = runtime.configure(root, 'clone', dict(__import__('os').environ))
    observed = {'ready': False, 'stop_requested': False}
    tail = b''

    def output(data):
        nonlocal tail
        tail = (tail + data)[-4096:]
        if marker.encode() in tail:
            observed['ready'] = True

    original_signal = signal.signal

    def register(number, handler):
        if number in (signal.SIGINT, signal.SIGTERM) and callable(handler):
            def stopping(*args):
                observed['stop_requested'] = True
                return handler(*args)
            return original_signal(number, stopping)
        return original_signal(number, handler)

    signal.signal = register
    try:
        result = runtime.run(cwd, argv, environment, stop, credentials,
                             ready_marker=marker.encode(), terminal_input=True,
                             terminal_query_reply=True, output_observer=output)
    finally:
        signal.signal = original_signal
    print('VOLTRA_CLONE_RAW_EXIT ' + json.dumps({**observed, 'raw_child_returncode': result}), flush=True)
    return result


if __name__ == '__main__':
    raise SystemExit(main())
