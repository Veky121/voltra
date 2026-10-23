#!/bin/sh
set -eu
export SOURCE_DATE_EPOCH=1770336000
archive=/src/.local/php-8.5.4.tar.gz
printf '%s  %s\n' '4fef7f44eff3c18e329504cb0d3eb30b41cf54e2db05cb4ebe8b78fc37d38ce1' "$archive" | sha256sum -c -
build=$(mktemp -d /tmp/pteroclone-encoding.XXXXXX)
trap 'rm -rf "$build"' EXIT
tar -xzf "$archive" -C "$build" php-8.5.4/ext/mbstring/libmbfl
lib="$build/php-8.5.4/ext/mbstring/libmbfl"
find "$lib" -name '*.c' -exec perl -0777 -i -pe 's{(const mbfl_encoding \w+\s*=\s*\{)(.*?)(\};)}{my ($a,$b,$c)=($1,$2,$3); my @fields=split(/,/,$b,-1); die "Unexpected encoding initializer" unless (@fields==12 || @fields==13); $fields[$_]="\n\tNULL" for (6,7,9,11); $a.join(",",@fields).$c}gse' {} +
perl -0777 -i -pe 's/&vtbl_##id##_wchar,/NULL,/g; s/&vtbl_wchar_##id,/NULL,/g; s/^\s*mb_wchar_to_##id, /\t\tNULL, /mg' "$lib/filters/mbfilter_singlebyte.c"
printf '#define HAVE_STRINGS_H 1\n' > "$lib/config.h"
cd "$build"
/opt/wasi-sdk/bin/clang -O2 -ffunction-sections -fdata-sections -mexec-model=reactor \
 -I/src/tools/runtime/encoding -I"$lib/.." -I"$lib" -I"$lib/mbfl" -I"$lib/filters" \
 /src/tools/runtime/encoding/bridge.c "$lib/mbfl/mbfl_encoding.c" "$lib/mbfl/mbfilter_8bit.c" "$lib/mbfl/mbfilter_pass.c" "$lib"/filters/*.c \
 -Wl,--export=malloc -Wl,--export=free -Wl,--export=egg_encoding_check \
 -Wl,--initial-memory=2097152 -Wl,--max-memory=67108864 -Wl,-z,stack-size=262144 \
 -Wl,--strip-all -o /src/internal/panel/encoding.wasm
cp "$lib/LICENSE" /src/tools/runtime/encoding/LIBMBFL-LICENSE
sha256sum /src/internal/panel/encoding.wasm
