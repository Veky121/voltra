$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
$archivePath = Join-Path $projectRoot '.local/php-8.5.4.tar.gz'
if (-not (Test-Path -LiteralPath $archivePath)) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $archivePath) | Out-Null
    Invoke-WebRequest -Uri 'https://www.php.net/distributions/php-8.5.4.tar.gz' -OutFile $archivePath
}
if ((Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne '4fef7f44eff3c18e329504cb0d3eb30b41cf54e2db05cb4ebe8b78fc37d38ce1') { throw 'PHP source archive checksum mismatch.' }
$sdkImage = 'ghcr.io/webassembly/wasi-sdk:sha-06d2eb4@sha256:9009101eb1fe918d9d840120cf15915bfa1c4743d90f0c6b4de2e84bab8cc841'
docker run --rm --mount "type=bind,source=$projectRoot,target=/src" -w /src $sdkImage /bin/sh tools/runtime/timelib/build.sh
if ($LASTEXITCODE -ne 0) { throw 'Timelib Wasm build failed.' }
