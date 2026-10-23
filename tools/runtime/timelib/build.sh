#!/bin/sh
set -eu
export SOURCE_DATE_EPOCH=1773273600
archive=/src/.local/php-8.5.4.tar.gz
printf '%s  %s\n' '4fef7f44eff3c18e329504cb0d3eb30b41cf54e2db05cb4ebe8b78fc37d38ce1' "$archive" | sha256sum -c -
build=$(mktemp -d /tmp/pteroclone-timelib.XXXXXX)
trap 'rm -rf "$build"' EXIT
tar -xzf "$archive" -C "$build" php-8.5.4/ext/date/lib php-8.5.4/ext/date/php_date.c php-8.5.4/LICENSE
cd "$build/php-8.5.4/ext/date/lib"
# Preserve PHP's date formatter verbatim, supplying only a small bounded string
# adapter instead of Zend allocation machinery. No PHP interpreter is built.
awk '/^static const char \* const mon_full_names\[\]/{copy=1} /^PHPAPI zend_string \*php_format_date_obj/{copy=0} copy{print}' ../php_date.c > php_format.inc
# The reference PHP is a 64-bit build; Wasm has 32-bit C long. Preserve its
# explicit long casts in Swatch time and timelib's platform-dependent typedef.
sed -i 's/(long)t->sse/(int64_t)t->sse/g' php_format.inc
sed -i '/^#if (defined(__x86_64__)/c\#if 1' timelib.h
/opt/wasi-sdk/bin/clang -O2 -mexec-model=reactor -I. \
 -DHAVE_STDINT_H=1 -DHAVE_INT32_T=1 -DHAVE_UINT32_T=1 -DHAVE_SYS_TYPES_H=1 -DHAVE_UNISTD_H=1 -DHAVE_DIRENT_H=1 -DHAVE_STRTOLL=1 \
 /src/tools/runtime/timelib/bridge.c timelib.c dow.c parse_date.c parse_tz.c parse_posix.c tm2unixtime.c unixtime2tm.c \
 -Wl,--export=malloc -Wl,--export=free -Wl,--export=egg_date_parse -Wl,--export=egg_date_seconds \
 -Wl,--export=egg_date_micros -Wl,--export=egg_date_valid_calendar -Wl,--export=egg_date_formatted \
 -Wl,--initial-memory=2097152 -Wl,--max-memory=67108864 -Wl,-z,stack-size=262144 \
 -Wl,--strip-all -o /src/internal/panel/timelib.wasm
cp LICENSE.rst /src/tools/runtime/timelib/TIMELIB-LICENSE
cp "$build/php-8.5.4/LICENSE" /src/tools/runtime/timelib/PHP-LICENSE
sha256sum /src/internal/panel/timelib.wasm
