#!/usr/bin/env python3
"""MIT. Run inherited real transaction cases against the classified derivative."""
import importlib.util
from pathlib import Path
import unittest
HERE=Path(__file__).resolve().parent
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,HERE/file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
driver=load('classified_driver_test','classified-once.py')
tests=load('trace_tests_reused','test-trace-driver.py')
tests.tests.driver=driver;tests.trace=driver

class ClassifiedTests(tests.TraceTransactionTests):
    def test_policy(self):
        code=(HERE/'classified-once.py').read_text()
        self.assertIn("probe=(HERE/'classified-main.lua').read_bytes()",code)
        self.assertIn('timeout=90,stop_after=75',code)
        self.assertIn('fixture.protected_input(0)',code)
        self.assertNotIn('print(raw',code)
        controller=(HERE/'classified-controller.mjs').read_text()
        self.assertIn("state.container+'-trace'",controller)
        self.assertIn("'-i','--entrypoint'",controller)
        self.assertIn('input:packet',controller)
        self.assertNotIn("'--publish'",controller)

if __name__=='__main__':unittest.main()
