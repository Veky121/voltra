# Embedded libmbfl encoding validator

`internal/panel/encoding.wasm` contains the original PHP 8.5.4 libmbfl decoders and the `php_mb_check_encoding` checking loop. It supports every **79** canonical encoding names returned by that release's `mb_list_encodings()`. Laravel accepts these names case-insensitively; it rejects additional aliases such as `UTF8` even though mbstring itself can resolve them.

The Go wrapper checks raw bytes, including recursive array values and keys, without conversion through JSON. Production uses wazero and requires no PHP installation, C compiler, cgo, network request, or external Wasm runtime. Each validation has a 250 ms deadline, at most eight concurrent modules, a 64 MiB module memory cap, and a 1 MiB input cap. Interrupted modules are discarded. Cold module compilation has a separate ten-second limit.

## Rebuild

From the project root: `./tools/runtime/encoding/build.ps1`. On Linux, place the source archive at `.local/php-8.5.4.tar.gz` and run the same pinned image with the project mounted at `/src`, executing `/bin/sh tools/runtime/encoding/build.sh`.

- Source: https://www.php.net/distributions/php-8.5.4.tar.gz
- Source SHA-256: `4fef7f44eff3c18e329504cb0d3eb30b41cf54e2db05cb4ebe8b78fc37d38ce1`
- SDK: `ghcr.io/webassembly/wasi-sdk:sha-06d2eb4@sha256:9009101eb1fe918d9d840120cf15915bfa1c4743d90f0c6b4de2e84bab8cc841`
- Wasm SHA-256: `4d1f4fb9d093fd5fe4194ce473627329862c4568e590fe86b4d6d4f676585ac6`
- Wasm size: 322,875 bytes.

`build.sh` verifies the release hash and builds in a temporary directory. Its only libmbfl source changes set unused streaming-filter, encoder, and string-cut function pointers to NULL, allowing the linker to remove those APIs. Original decoding functions and mapping tables remain unchanged. `zend.h` supplies compile-time types/macros for unreachable encoder functions; it is not a Zend runtime. The bridge exports only memory allocation and encoding validation.

## Verification

`go test ./internal/panel -run EggEncoding -count=1 -v` compares 333 raw-byte vectors for each of 79 codecs against the locally installed PHP mbstring extension: **26,307 comparisons**. Vectors include every single byte, valid and invalid multibyte sequences, embedded escape/state changes, buffer boundaries, and deterministic random inputs. The oracle uses base64 transport to preserve invalid UTF-8 bytes. Additional tests cover recursive array keys, canonical-name rejection, cancellation, input limits, and concurrent pooling.

## License and replacement

libmbfl's LGPL 2.1 text is included in [LIBMBFL-LICENSE](LIBMBFL-LICENSE). PHP's license and notices are included in [PHP-LICENSE](PHP-LICENSE), covering newer mbstring source and the checking loop. The complete original source is the pinned archive above, with every applied modification recorded in `build.sh`. To modify or replace the library, rebuild `encoding.wasm` using the supplied source/build tools and rebuild the Go application; the application source and its separate Wasm module remain available for that purpose. No PHP interpreter is incorporated.
