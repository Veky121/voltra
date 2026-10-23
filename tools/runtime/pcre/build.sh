#!/bin/sh
set -eu
export SOURCE_DATE_EPOCH=1756252800
archive=/src/.local/pcre2-10.46.tar.gz
printf '%s  %s\n' '8d28d7f2c3b970c3a4bf3776bcbb5adfc923183ce74bc8df1ebaad8c1985bd07' "$archive" | sha256sum -c -
build=$(mktemp -d /tmp/pteroclone-pcre.XXXXXX)
trap 'rm -rf "$build"' EXIT
tar -xzf "$archive" -C "$build"
cd "$build/pcre2-10.46"
./configure --host=wasm32-wasi --disable-shared --enable-static --disable-jit --enable-unicode --disable-pcre2-16 --disable-pcre2-32 --disable-pcre2grep-callout CFLAGS='-O2' > configure.log 2>&1 || { cat configure.log; exit 1; }
make -j2 libpcre2-8.la > make.log 2>&1 || { cat make.log; exit 1; }
/opt/wasi-sdk/bin/clang -O2 -mexec-model=reactor -I. -Isrc \
 /src/tools/runtime/pcre/bridge.c .libs/libpcre2-8.a \
 -Wl,--export=malloc -Wl,--export=free \
 -Wl,--export=egg_pcre_compile -Wl,--export=egg_pcre_free \
 -Wl,--export=egg_pcre_match -Wl,--export=egg_pcre_error_message -Wl,--export=egg_pcre_error_offset \
 -Wl,--initial-memory=1048576 -Wl,--max-memory=67108864 -Wl,-z,stack-size=262144 \
 -Wl,--strip-all -o /src/internal/panel/pcre.wasm
cp LICENCE.md /src/tools/runtime/pcre/PCRE2-LICENSE
sha256sum /src/internal/panel/pcre.wasm
