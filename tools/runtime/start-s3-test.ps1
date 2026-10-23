$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '../..')
$path = '.local/s3-test.env'
if (-not (Test-Path $path)) {
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    $rng.Dispose()
    @('TEST_S3_ENDPOINT=http://127.0.0.1:19000', 'TEST_S3_ACCESS_KEY=pteroclone', "TEST_S3_SECRET_KEY=$secret", 'TEST_S3_BUCKET=pteroclone-test', 'TEST_S3_REGION=us-east-1') | Set-Content $path -Encoding utf8
}
foreach ($line in Get-Content $path) { if ($line -match '^([A-Z0-9_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') } }
$existing = docker ps -a --filter 'name=^pteroclone-s3-test$' --format '{{.Names}}'
if (-not $existing) {
    docker run -d --name pteroclone-s3-test -p 127.0.0.1:19000:9000 -e "RUSTFS_ACCESS_KEY=$env:TEST_S3_ACCESS_KEY" -e "RUSTFS_SECRET_KEY=$env:TEST_S3_SECRET_KEY" -v pteroclone-s3-test-data:/data rustfs/rustfs:1.0.3 /data | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'S3 test container failed to start.' }
} else { docker start pteroclone-s3-test | Out-Null }
Write-Host 'Isolated S3-compatible test storage starting on localhost:19000; private settings .local/s3-test.env.'

