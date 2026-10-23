param([switch]$SetupOnly)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$runtimeDirectory = Join-Path $PSScriptRoot '.local'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$runtimeFile = Join-Path $runtimeDirectory 'runtime.env'
if (-not (Test-Path -LiteralPath $runtimeFile)) {
    $randomSource = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $randomBytes = New-Object byte[] 32
    $randomSource.GetBytes($randomBytes)
    $databaseSecret = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    $randomSource.GetBytes($randomBytes)
    $encryptionSecret = [BitConverter]::ToString($randomBytes).Replace('-', '').ToLowerInvariant()
    $randomSource.Dispose()
    @("DATABASE_URL=postgres://pteroclone:$databaseSecret@127.0.0.1:55432/pteroclone?sslmode=disable", "ENCRYPTION_KEY=$encryptionSecret", 'DEV_MODE=true', 'LISTEN=127.0.0.1:8088', 'PUBLIC_URL=http://127.0.0.1:8088', 'DAEMON_URL=http://host.docker.internal:8088', 'WEB_DIR=web/dist') | Set-Content -LiteralPath $runtimeFile -Encoding utf8
}
foreach ($line in Get-Content -LiteralPath $runtimeFile) {
    if ($line -match '^([A-Z0-9_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
$existing = docker ps -a --filter 'name=^pteroclone-postgres$' --format '{{.Names}}'
if (-not $existing) {
    $connection = [Uri]$env:DATABASE_URL
    $databaseSecret = ($connection.UserInfo -split ':', 2)[1]
    docker run -d --name pteroclone-postgres -p 127.0.0.1:55432:5432 -e POSTGRES_USER=pteroclone -e POSTGRES_DB=pteroclone -e "POSTGRES_PASSWORD=$databaseSecret" -v pteroclone-postgres-data:/var/lib/postgresql postgres:18-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL container creation failed.' }
} else {
    docker start pteroclone-postgres | Out-Null
}
$ready = $false
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    docker exec pteroclone-postgres pg_isready -U pteroclone -d pteroclone 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 250
}
if (-not $ready) { throw 'PostgreSQL did not become ready.' }
Write-Host 'PostgreSQL ready on localhost:55432. Development identity is loopback-only.'
if (-not $env:DAEMON_URL) { $env:DAEMON_URL = 'http://host.docker.internal:8088' }
if ($SetupOnly) { return }
go run ./cmd/panel
exit $LASTEXITCODE
