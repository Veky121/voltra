#!/usr/bin/env python3
"""MIT. Preserve the native OpenRCT2 TTY JavaScript console and save/quit."""
import importlib.util
import os
from pathlib import Path
import sys

def load(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def main(root,environment):
    settings=load('settings','small-native-runtime.py')
    argv,cwd=settings.configure_openrct2(root,environment)
    child_environment=dict(os.environ)
    child_environment.pop('PYTHONHOME',None);child_environment.pop('PYTHONPATH',None)
    child_environment.pop('OPENRCT2_NO_REPL',None)
    # Upstream explicitly supports TERM=dumb through its line-input fallback.
    # Avoid stale multiline-editor state during native plugin shutdown logs.
    child_environment['TERM']='dumb'
    console=load('console','native-console.py')
    return console.run(cwd,argv,child_environment,'console.executeLegacy("save_park"); console.executeLegacy("quit");',
                       credentials=[environment.get('SERVER_PASSWORD','')],ready_marker=b'Listening for clients on',
                       terminal_input=True)

if __name__=='__main__':
    try:raise SystemExit(main(Path.cwd().resolve(),dict(os.environ)))
    except (ValueError,OSError):
        print('OpenRCT2 settings or operator files are invalid. Check the saved park, game data path and recipe requirements; private values were not printed.',file=sys.stderr)
        raise SystemExit(1)
