# Managed console client fork

The pinned public sources are gorcon/rcon-cli v0.10.3, commit
0835f305382e708991842f376aaf82615a738fd1, and gorcon/telnet v1.2.2,
commit40b503333f1c81a2f1947f32fdb516963e43f404. upstream.json records
SHA256 of every original source, module file and upstream MIT license.
The original licenses remain unchanged and ship alongside the binary.

Voltra changes only the local telnet replacement and focused regressions:

* Login accepts up to1024 UTF8 bytes independently of the existing1000-byte
  command limit. CR/LF/NUL and invalid UTF8 fail with fixed diagnostics.
* Login waits for the complete authenticated publisher greeting before
  commands, including when the peer fragments its response. Rejection,
  timeout, unexpected response and premature EOF fail without response or
  password contents in errors.
* Interactive mode performs the same authenticated handshake before reading
  commands; no fixed sleep substitutes for authentication.
* Background response buffering is synchronized. Closing joins the reader,
  including interactive output, so callers cannot race a finished client.
* The upstream oversized-password fixture now asserts the separate1024-byte
  bound. The test peer treats ordinary disconnected-client read errors as
  connection closure instead of panicking across unrelated tests.
* New loopback fixtures cover byte-preserving1024-byte ASCII/UTF8 login,
  fragmented greetings, command ordering, rejection, EOF and the unchanged
  command bound. These fixtures do not prove native game behavior.

From the repository root:

    node tools/runtime/managed-console-test.mjs
    node tools/runtime/managed-console-build.mjs
    node tools/runtime/managed-console-build.mjs --repro
    node tools/runtime/managed-console-build.mjs --verify

Tests are cross-compiled to static Linux binaries and run in existing
python:3.13-slim utility containers with no external network. This avoids
upstream Linux-specific error-string assertions on Windows. Build uses the
local pinned-in-manifest Go compiler, readonly module resolution, CGO0,
trimpath, disabled VCS stamping, an empty build ID and explicit architecture
baselines. No runtime compiler, host PATH modification or image replacement
is required. Both architecture ELF artifacts, compiler, module sums, source
file hashes and dependency licenses are recorded in the embedded manifest.

Native acceptance must additionally prove actual publisher login and shutdown
with the reviewed artifact, including1024 bytes. Generic fixture success is
not promotion. Private Steam beta/account authentication is unrelated and
remains explicitly unsupported.
