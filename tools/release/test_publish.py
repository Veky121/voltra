import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import publish


class PublicationTests(unittest.TestCase):
    def test_stable_receipt_promotes_only_version_and_keeps_carrier_prerelease(self):
        calls = []
        def gh(*args, **kwargs):
            calls.append(args)
            if args[:3] == ("release", "view", "update-stable"):
                return subprocess.CompletedProcess(args, 1, "", "not found")
            if args[:2] == ("api", "repos/Veky121/voltra/releases/latest"):
                return subprocess.CompletedProcess(args, 0, '{"tag_name":"v0.9.0"}', "")
            return subprocess.CompletedProcess(args, 0, '{"assets":[]}', "")
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as folder:
            try:
                os.chdir(folder)
                Path("out").mkdir()
                Path("out/manifest.json").write_text('{"version":"1.0.0","channel":"stable"}')
                with patch.dict(os.environ, RELEASE_TAG="v1.0.0", RELEASE_CHANNEL="stable", RELEASE_SHA="a" * 40, CREATE_NIGHTLY_TAG="false"), patch.object(publish, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
                    publish.main()
            finally:
                os.chdir(cwd)
        self.assertIn(("release", "edit", "v1.0.0", "--latest"), calls)
        self.assertIn(("release", "edit", "update-stable", "--prerelease", "--latest=false"), calls)
        self.assertTrue(any(args[:3] == ("release", "upload", "update-stable") for args in calls))
        self.assertFalse(any(args[:3] == ("release", "edit", "update-stable") and "--latest" in args for args in calls))

    def test_scheduled_tag_mismatch_fails_before_release(self):
        calls = []
        def gh(*args, **kwargs):
            calls.append(args)
            return subprocess.CompletedProcess(args, 0, '{"object":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}', "")
        with patch.dict(os.environ, RELEASE_TAG="v1.0.0-nightly.20261023.1", RELEASE_CHANNEL="nightly", RELEASE_SHA="a" * 40, CREATE_NIGHTLY_TAG="true"), patch.object(publish, "gh", gh), self.assertRaisesRegex(ValueError, "another commit"):
            publish.main()
        self.assertFalse(any(args[0] == "release" for args in calls))

    def test_precedence(self):
        self.assertLess(publish.precedence("1.0.0-beta.2"), publish.precedence("1.0.0-beta.10"))
        self.assertLess(publish.precedence("1.0.0-beta.10"), publish.precedence("1.0.0"))
        self.assertLess(publish.precedence("1.0.0-nightly.20261023.2"), publish.precedence("1.0.0-nightly.20261024.1"))
        with self.assertRaises(ValueError):
            publish.precedence("update-stable")

    def test_beta_does_not_promote_latest_or_move_feed_backward(self):
        calls = []
        current = {"version": "1.0.0-beta.1", "channel": "beta"}

        def gh(*args, **kwargs):
            calls.append(args)
            output = "{}"
            if args[:3] == ("release", "view", "v1.0.0-beta.1") and "--json" in args:
                output = '{"assets":[]}'
            if args[:3] == ("release", "view", "update-beta"):
                output = '{"assets":[{"name":"manifest.json"}]}'
            if args[:3] == ("release", "download", "update-beta"):
                folder = args[args.index("--dir") + 1]
                Path(folder, "manifest.json").write_text(json.dumps({"version": "1.0.0-beta.2", "channel": "beta"}))
            return subprocess.CompletedProcess(args, 0, output, "")

        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as folder:
            try:
                os.chdir(folder)
                Path("out").mkdir()
                Path("out/manifest.json").write_text(json.dumps(current))
                with patch.dict(os.environ, RELEASE_TAG="v1.0.0-beta.1", RELEASE_CHANNEL="beta", RELEASE_SHA="a" * 40), patch.object(publish, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
                    publish.main()
            finally:
                os.chdir(cwd)
        self.assertFalse(any(args[:3] == ("release", "upload", "update-beta") for args in calls))
        self.assertFalse(any("--latest" in args for args in calls))

    def test_different_existing_version_asset_fails_closed(self):
        def gh(*args, **kwargs):
            if args[:2] == ("release", "download"):
                Path(args[args.index("--dir") + 1], "Voltra-windows-amd64.exe").write_bytes(b"old")
            return subprocess.CompletedProcess(args, 0, '{"assets":[{"name":"Voltra-windows-amd64.exe"}]}', "")
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as folder:
            try:
                os.chdir(folder)
                Path("out").mkdir()
                Path("out/Voltra-windows-amd64.exe").write_bytes(b"new")
                with patch.dict(os.environ, RELEASE_TAG="v1.0.0", RELEASE_CHANNEL="stable", RELEASE_SHA="a" * 40), patch.object(publish, "gh", gh), self.assertRaisesRegex(ValueError, "immutable asset differs"):
                    publish.main()
            finally:
                os.chdir(cwd)


if __name__ == "__main__":
    unittest.main()
