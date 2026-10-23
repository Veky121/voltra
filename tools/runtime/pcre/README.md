# Embedded PCRE2 engine

The panel embeds `internal/panel/pcre.wasm`, built from the actual PCRE2 10.46 C library. This matches the PCRE2 version in the local PHP 8.5.4 reference. Production uses wazero, with no PHP process, C compiler, cgo, network request, filesystem mount, or external Wasm runtime.

The Go wrapper implements PHP's delimiter scanning and modifier flags. PCRE2 receives the original pattern body bytes. It supports PHP 8.5.4 modifiers `i m s x n A D U J u r S X`, including PHP's UTF/UCP behavior. `S` and `X` are native no-ops. The installed PHP 8.5.4 permits `\C` with `u`; later upstream PHP branch changes are deliberately not substituted for the tested reference.

The C shim only exports memory allocation, compile, match, release, and error reporting. PCRE2 JIT is disabled because the library runs inside Wasm. Matching uses PHP's default backtrack limit of 1,000,000 and depth limit of 100,000, plus a 32 MiB heap limit. Each Wasm module has a 64 MiB maximum memory. The pool contains at most eight instances, and each instance caches at most 128 compiled patterns. The Go validation cache holds at most 512 patterns and 8 MiB of pattern text. Instance cache keys are fixed-size SHA-256 digests, so instances do not retain the original pattern text.

Compile and match calls have 250 ms context deadlines, including waiting for an available instance. wazero closes an interrupted instance synchronously; that instance is discarded. Cold compilation of the embedded module happens once with a separate ten-second startup bound. Pattern and subject inputs are capped at 4 MiB, matching the API request limit.

## Rebuild

From the project root on Windows:

```powershell
.\tools\runtime\pcre\build.ps1
```

The script downloads the official release archive and rejects a checksum mismatch, then builds in this pinned official WASI SDK image:

- Source: https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.46/pcre2-10.46.tar.gz
- Source SHA-256: `8d28d7f2c3b970c3a4bf3776bcbb5adfc923183ce74bc8df1ebaad8c1985bd07`
- SDK: `ghcr.io/webassembly/wasi-sdk:sha-06d2eb4@sha256:9009101eb1fe918d9d840120cf15915bfa1c4743d90f0c6b4de2e84bab8cc841`
- Wasm SHA-256: `caf7a29382b67e70b228c169b393f4d16d785181ea8dd4213a5ecbab22fda226`
- Wasm size: 326,213 bytes.

The container mounts the project at `/src`; all intermediate source/build files live in a temporary directory inside the container. No source patch is applied to PCRE2. `bridge.c` is the panel-owned shim. `build.sh` disables CLI-only callout process support and builds only the 8-bit static library, then links a WASI reactor. `SOURCE_DATE_EPOCH` and stripped output keep rebuilds reproducible.

On Linux, download the same archive to `.local/pcre2-10.46.tar.gz`, verify the hash above, and run the same image with the project mounted at `/src` and command `/bin/sh tools/runtime/pcre/build.sh`.

## Native compatibility oracle

`oracle-cases.json` covers recursion, backreferences, branch resets, duplicate names, ungreedy atomic groups, subroutine definitions, control verbs, variable lookbehind, paired delimiters, modifiers, Unicode properties/case folding, raw bytes and invalid UTF-8. `oracle-results.json` contains actual PHP 8.5.4 / PCRE2 10.46 results and is consumed by `TestPCRENativePHPOracle` without requiring PHP during Go tests.

To refresh the development oracle using the reference PHP installation:

```sh
php tools/runtime/pcre/oracle.php > tools/runtime/pcre/oracle-results.json
go test ./internal/panel -run PCRE -count=1
```

Save redirected output as UTF-8 without a byte-order mark. This development script is not called by production code. Additional tests cover bounded backtracking, concurrent instance use, deadline termination, closed-instance recovery, and goroutine stability.

## License and sources

PCRE2's BSD-3-Clause WITH PCRE2-exception license and copyright notices are preserved verbatim in [PCRE2-LICENSE](PCRE2-LICENSE), copied from the release archive. The public API and compiler options come from the official [PCRE2 source](https://github.com/PCRE2Project/pcre2/tree/pcre2-10.46). PHP delimiter/modifier semantics are checked against [PHP 8.5.4's PCRE extension](https://github.com/php/php-src/blob/php-8.5.4/ext/pcre/php_pcre.c). The wrapper and shim do not incorporate PHP source code.
