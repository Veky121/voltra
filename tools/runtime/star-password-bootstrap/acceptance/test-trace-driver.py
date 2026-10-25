#!/usr/bin/env python3
"""MIT. Offline trace transaction and secret-audit regression checks."""
import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('trace_driver_test',HERE/'trace-once.py')
trace=importlib.util.module_from_spec(spec);spec.loader.exec_module(trace)
spec=importlib.util.spec_from_file_location('readonly_test_reuse',HERE/'test-readonly-driver.py')
tests=importlib.util.module_from_spec(spec);spec.loader.exec_module(tests)
# Execute the same real transaction success/failure/boundary fixtures against
# the derivative rather than silently trusting its copied implementation.
tests.driver=trace


class TraceTransactionTests(tests.TransactionTests):
    def test_policy(self):
        code=(HERE/'trace-once.py').read_text()
        self.assertIn('timeout=90,stop_after=75',code)
        self.assertIn("'START_NEW':'false','LOAD_SAVE':'false'",code)
        self.assertIn('fixture.protected_input(0)',code)
        self.assertIn('request.unlink(missing_ok=True)',code)
        self.assertNotIn('print(raw',code)
        controller=(HERE/'trace-controller.mjs').read_text()
        self.assertIn('input:packet',controller)
        self.assertIn('packet.fill(0)',controller)
        self.assertIn("'-i','--entrypoint'",controller)
        self.assertNotIn("'--publish'",controller)

    def test_all_known_secrets_audited(self):
        secrets=[b'FIRST_SENTINEL',b'SECOND_SENTINEL']
        self.assertFalse(trace.audit(b'constant stage only',secrets))
        for value in secrets:
            self.assertTrue(trace.audit(b'prefix'+value+b'suffix',secrets))
        self.assertFalse(trace.audit(b'nonempty',[b'']))


if __name__=='__main__':unittest.main()
