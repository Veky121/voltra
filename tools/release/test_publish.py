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
                Path("out/manifest.json").write_text('{"version":"1.0.0","channel":"release"}')
                with patch.dict(os.environ, RELEASE_TAG="v1.0.0", RELEASE_CHANNEL="release", RELEASE_SHA="a" * 40, CREATE_NIGHTLY_TAG="false"), patch.object(publish, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
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

    def test_release_and_legacy_feeds_advance_independently(self):
        for version, legacy in [("1.0.0-beta.12", "beta"), ("1.0.0", "stable")]:
            for blocked in ["release", legacy]:
                with self.subTest(version=version, blocked=blocked):
                    uploads = {}
                    calls = []
                    artifact = {"url": "immutable/version.exe", "digest": "digest", "signature": "signature"}
                    def gh(*args, **kwargs):
                        calls.append(args)
                        output = '{"assets":[]}'
                        if args[:2] == ("release", "view") and args[2].startswith("update-"):
                            output = '{"assets":[{"name":"manifest.json"}]}'
                        if args[:2] == ("release", "download"):
                            carrier = args[2].removeprefix("update-")
                            previous = ("2.0.0-beta.1" if carrier == "beta" else "2.0.0") if carrier == blocked else "0.9.0" if carrier != "beta" else "0.9.0-beta.1"
                            Path(args[args.index("--dir") + 1], "manifest.json").write_text(json.dumps({"version": previous, "channel": carrier}))
                        if args[:2] == ("release", "upload") and args[2].startswith("update-"):
                            uploads[args[2]] = json.loads(Path(args[3]).read_text())
                        if args[:2] == ("api", "repos/Veky121/voltra/releases/latest"):
                            output = '{"tag_name":"v0.9.0"}'
                        return subprocess.CompletedProcess(args, 0, output, "")
                    cwd = os.getcwd()
                    with tempfile.TemporaryDirectory() as folder:
                        try:
                            os.chdir(folder)
                            Path("out").mkdir()
                            Path("out/manifest.json").write_text(json.dumps({"version": version, "channel": "release", "artifacts": [artifact]}))
                            with patch.dict(os.environ, RELEASE_TAG="v" + version, RELEASE_CHANNEL="release", RELEASE_SHA="a" * 40, CREATE_NIGHTLY_TAG="false"), patch.object(publish, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
                                publish.main()
                        finally:
                            os.chdir(cwd)
                    target = legacy if blocked == "release" else "release"
                    self.assertEqual(set(uploads), {"update-" + target})
                    self.assertEqual(uploads["update-" + target]["channel"], target)
                    self.assertEqual(uploads["update-" + target]["artifacts"], [artifact])
                    self.assertEqual(any("--latest" in c for c in calls), legacy == "stable")

    def test_creation_flags_follow_tag_maturity(self):
        for tag, channel, prerelease in [("v1.0.0", "release", False), ("v1.0.0-beta.12", "release", True), ("v1.0.0-nightly.20261028.1", "nightly", True)]:
            calls = []
            def gh(*args, **kwargs):
                calls.append(args)
                if args[:2] == ("release", "view") and "--json" not in args:
                    return subprocess.CompletedProcess(args, 1, "", "missing")
                return subprocess.CompletedProcess(args, 0, '{"assets":[],"tag_name":"v0.9.0"}', "")
            cwd = os.getcwd()
            with tempfile.TemporaryDirectory() as folder:
                try:
                    os.chdir(folder)
                    Path("out").mkdir()
                    Path("out/manifest.json").write_text(json.dumps({"version": tag[1:], "channel": channel}))
                    with patch.dict(os.environ, RELEASE_TAG=tag, RELEASE_CHANNEL=channel, RELEASE_SHA="a" * 40, CREATE_NIGHTLY_TAG="false"), patch.object(publish, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
                        publish.main()
                finally:
                    os.chdir(cwd)
            creation = next(c for c in calls if c[:3] == ("release", "create", tag))
            self.assertEqual("--prerelease" in creation, prerelease)
            self.assertFalse(any(c[:2] == ("release", "upload") and c[2] == tag and "--clobber" in c for c in calls))

    def test_precedence(self):
        self.assertLess(publish.precedence("1.0.0-beta.2"), publish.precedence("1.0.0-beta.10"))
        self.assertLess(publish.precedence("1.0.0-beta.10"), publish.precedence("1.0.0"))
        self.assertLess(publish.precedence("1.0.0-nightly.20261023.2"), publish.precedence("1.0.0-nightly.20261024.1"))
        for invalid in ["update-stable", "v01.0.0", "v1.0.0-beta.0", "v1.0.0-nightly.20260230.1", "v1.0.0-nightly.20261028.01", "vv1.0.0", "v1.0.0-rc.1"]:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                publish.precedence(invalid)

    def test_beta_does_not_promote_latest_or_move_feed_backward(self):
        calls = []
        current = {"version": "1.0.0-beta.1", "channel": "beta"}

        def gh(*args, **kwargs):
            calls.append(args)
            output = '{"assets":[]}'
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
                with patch.dict(os.environ, RELEASE_TAG="v1.0.0-beta.1", RELEASE_CHANNEL="release", RELEASE_SHA="a" * 40), patch.object(publish, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
                    publish.main()
            finally:
                os.chdir(cwd)
        self.assertFalse(any(args[:3] == ("release", "upload", "update-beta") for args in calls))
        self.assertFalse(any("--latest" in args for args in calls))

    def test_existing_legacy_manifest_is_preserved_and_seeds_release(self):
        for legacy, version in [("beta", "1.0.0-beta.12"), ("stable", "1.0.0")]:
            old = {"version": version, "channel": legacy, "artifacts": [{"digest": "same", "signature": "same"}]}
            uploads = {}
            def gh(*args, **kwargs):
                if args[:3] == ("release", "view", "v" + version):
                    return subprocess.CompletedProcess(args, 0, '{"assets":[{"name":"manifest.json"}]}', "")
                if args[:3] == ("release", "download", "v" + version):
                    Path(args[args.index("--dir") + 1], "manifest.json").write_text(json.dumps(old))
                if args[:2] == ("release", "upload"):
                    uploads[args[2]] = json.loads(Path(args[3]).read_text())
                return subprocess.CompletedProcess(args, 0, '{"assets":[],"tag_name":"v0.9.0"}', "")
            cwd = os.getcwd()
            with tempfile.TemporaryDirectory() as folder:
                try:
                    os.chdir(folder)
                    Path("out").mkdir()
                    Path("out/manifest.json").write_text(json.dumps(dict(old, channel="release")))
                    with patch.dict(os.environ, RELEASE_TAG="v" + version, RELEASE_CHANNEL="release", RELEASE_SHA="a" * 40, CREATE_NIGHTLY_TAG="false"), patch.object(publish, "gh", gh), contextlib.redirect_stdout(io.StringIO()):
                        publish.main()
                    self.assertEqual(json.loads(Path("out/manifest.json").read_text()), old)
                finally:
                    os.chdir(cwd)
            self.assertNotIn("v" + version, uploads)
            self.assertEqual(uploads["update-release"], dict(old, channel="release"))
            self.assertEqual(uploads["update-" + legacy], old)

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
                with patch.dict(os.environ, RELEASE_TAG="v1.0.0", RELEASE_CHANNEL="release", RELEASE_SHA="a" * 40), patch.object(publish, "gh", gh), self.assertRaisesRegex(ValueError, "immutable asset differs"):
                    publish.main()
            finally:
                os.chdir(cwd)


if __name__ == "__main__":
    unittest.main()
