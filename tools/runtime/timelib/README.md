# Native PHP date rules without a PHP runtime

The Go application embeds `internal/panel/timelib.wasm`. This module contains
PHP 8.5.4's timelib C library, its built-in IANA timezone database (2025.3), and
the `date_format` function from `ext/date/php_date.c`. It does not contain a PHP
interpreter, web server, Zend executor, filesystem access, or network access.
The Go binary does not launch PHP and does not require cgo.

`eggDateRule` implements the reference Laravel validation flow: `date` combines
parsing with the original calendar fields' validity; `date_format` parses with
an epoch reset and checks PHP's formatted result; comparison rules follow
Carbon's timestamp handling, literal-before-field resolution, optional field
formats, and PHP null comparison behavior. Unformatted comparisons discard
microseconds as Laravel's `getTimestamp()` does. Formatted comparisons preserve
them. The application injects its configured timezone; format validation itself
uses UTC, as in Laravel. Relative parsing uses a single clock snapshot per rule.

The small C adapter supplies bounded string allocation for PHP's formatter. The
formatter body is extracted during the build, rather than reimplemented. Two
mechanical adaptations preserve 64-bit reference behavior on Wasm's 32-bit C
ABI: timelib's platform-dependent `long` typedef selects its 64-bit branch, and
the formatter's Swatch-time `long` casts use `int64_t`. `HAVE_STRTOLL` selects
the real 64-bit parser, including dates after 2038. All date grammar, calendar,
format parsing, timezone transitions, overflow normalization, and formatting
remain native C code.

## Rebuild

From the project root on Windows, with Docker running:

```powershell
powershell -NoProfile -File tools/runtime/timelib/build.ps1
```

The script downloads the official archive when absent and verifies its hash:

- Source: <https://www.php.net/distributions/php-8.5.4.tar.gz>
- Source SHA256: `4fef7f44eff3c18e329504cb0d3eb30b41cf54e2db05cb4ebe8b78fc37d38ce1`
- WASI SDK image: `ghcr.io/webassembly/wasi-sdk:sha-06d2eb4@sha256:9009101eb1fe918d9d840120cf15915bfa1c4743d90f0c6b4de2e84bab8cc841`
- Result: 637,121 bytes
- Result SHA256: `623d1fc6b6f06c893d95985348df8998fc0cbc5bb1f01518ab20295e2a4eab1b`

Two consecutive builds produced this identical hash. The build uses a temporary
container directory and leaves the downloaded source archive intact. Upstream
licenses are copied to `TIMELIB-LICENSE` (MIT) and `PHP-LICENSE` (PHP 3.01).

## Bounds and concurrency

Wazero compiles the module once with a ten-second cold-start deadline. The pool
creates at most `min(GOMAXPROCS, 8)` instances. Each instance has a 64 MiB linear
memory limit and receives no WASI filesystem, environment, or network grants.
Each public parse has a 250 ms deadline, including pool acquisition. Wazero
interrupts and closes an instance when its execution context expires; closed
instances are discarded. No background match or parse goroutine is spawned.
Timezone objects are freed after each parse, avoiding an unbounded zone cache.
Input is limited to 4 MiB, a format to 64 KiB, and formatted output to 8 MiB.

## Validation

```powershell
go test ./internal/panel -run Timelib -count=1
```

`oracle-cases.json` defines 118 validation cases. `oracle-results.json` is the
recorded output of the actual reference vendor Laravel/Carbon running under
PHP 8.5.4. It also records parsed timestamps and microseconds for scalar inputs.
The tests read this checked-in fixture; they never invoke PHP. Cases cover valid
and invalid calendars, overflow normalization, textual and relative expressions,
format tokens and escapes, alternative formats, numeric timestamps and Carbon's
numeric-chunk behavior, fields and missing fields, fractional seconds, named
timezones, and Berlin/Lord Howe daylight saving transitions. The reference PHP
uses its system timezone database (`0.system`); this module embeds the pinned
PHP source's timezone database, so future database updates need a new pinned
build and oracle review.

Additional tests verify application timezone injection, 32 concurrent parses,
input and format limits, recovery after a closed instance, canceled pool waits
without goroutine growth, and interruption of an executing native parser by a
one-millisecond deadline. `artifacts/timelib-compatibility.json` records the test
result and reproducibility hashes.

To refresh the development oracle in this checkout:

```powershell
wsl -d Ubuntu -- bash -lc 'php /mnt/c/Users/Veky/.t3/projects/pteroclone/ptero-go/tools/runtime/timelib/oracle.php > /mnt/c/Users/Veky/.t3/projects/pteroclone/ptero-go/tools/runtime/timelib/oracle-results.json'
```

Review any changed expectation against the reference implementation before
updating the golden fixture.
