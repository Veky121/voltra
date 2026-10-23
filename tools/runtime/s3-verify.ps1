$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '../..')
foreach ($path in @('.local/runtime.env', '.local/s3-test.env')) {
    foreach ($line in Get-Content -LiteralPath $path) {
        if ($line -match '^([A-Z0-9_]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}
$env:TEST_DATABASE_URL = $env:DATABASE_URL
$env:TEST_REAL_PANEL_URL = 'http://127.0.0.1:8088'
$env:TEST_REAL_FIXTURES = '../../.local/s3-fixtures.json'
node tools/runtime/s3-setup.mjs
if ($LASTEXITCODE -ne 0) { throw 'Dedicated S3 Wings setup failed.' }
go test ./internal/panel -run '^TestOperationsRealS3Wings$' -count=1 -v
if ($LASTEXITCODE -ne 0) { throw 'Real Wings and S3 acceptance failed.' }
New-Item -ItemType Directory -Path artifacts -Force | Out-Null
Copy-Item -LiteralPath '.local/s3-real-result.json' -Destination 'artifacts/runtime-s3.json'
Write-Host 'Verified real Wings multipart S3 backup, signed archive download, restore and deletion. Settings restored; test server and bucket removed.'
