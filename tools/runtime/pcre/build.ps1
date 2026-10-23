$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$archivePath = Join-Path $projectRoot '.local/pcre2-10.46.tar.gz'
if (-not (Test-Path -LiteralPath $archivePath)) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $archivePath) | Out-Null
    Invoke-WebRequest -Uri 'https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.46/pcre2-10.46.tar.gz' -OutFile $archivePath
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '8d28d7f2c3b970c3a4bf3776bcbb5adfc923183ce74bc8df1ebaad8c1985bd07') { throw 'PCRE2 source archive checksum mismatch.' }
$sdkImage = 'ghcr.io/webassembly/wasi-sdk:sha-06d2eb4@sha256:9009101eb1fe918d9d840120cf15915bfa1c4743d90f0c6b4de2e84bab8cc841'
docker run --rm --mount "type=bind,source=$projectRoot,target=/src" -w /src $sdkImage /bin/sh tools/runtime/pcre/build.sh
if ($LASTEXITCODE -ne 0) { throw 'PCRE2 Wasm build failed.' }
