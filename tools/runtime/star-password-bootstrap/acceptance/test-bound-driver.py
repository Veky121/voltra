#!/usr/bin/env python3
"""MIT. Run inherited real transaction cases against the classified derivative."""
import importlib.util
from pathlib import Path
import unittest
HERE=Path(__file__).resolve().parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
driver=load('bound_driver_test','bound-once.py')
tests=load('trace_tests_reused','test-trace-driver.py')
tests.tests.driver=driver;tests.trace=driver

class BoundTests(tests.TraceTransactionTests):
    def test_policy(self):
        code=(HERE/'bound-once.py').read_text()
        self.assertIn("probe=(HERE/'bound-main.lua').read_bytes()",code)
        self.assertIn('timeout=90,stop_after=75',code)
        self.assertIn('fixture.protected_input(0)',code)
        self.assertNotIn('print(raw',code)
        controller=(HERE/'bound-controller.mjs').read_text()
        self.assertIn("state.container+'-trace'",controller)
        self.assertIn("'-i','--entrypoint'",controller)
        self.assertIn('input:packet',controller)
        self.assertNotIn("'--publish'",controller)

if __name__=='__main__':unittest.main()
