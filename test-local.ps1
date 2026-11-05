param([switch]$Race, [switch]$Json, [string]$Run='.')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$configuration=Join-Path $PSScriptRoot '.local/dev/environment.json'
if (-not (Test-Path -LiteralPath $configuration)) { throw 'Run ./dev.ps1 start first.' }
$local=Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
foreach ($variable in @(Get-ChildItem Env: | Where-Object { $_.Name.StartsWith('PG') })) { [Environment]::SetEnvironmentVariable($variable.Name,$null,'Process') }
$testDatabase='voltra_test_'+[guid]::NewGuid().ToString('N')
if($testDatabase -notmatch '^voltra_test_[a-f0-9]{32}$') { throw 'Invalid disposable test database name.' }
& docker exec voltra-dev-postgres createdb -U voltra_dev $testDatabase
if($LASTEXITCODE -ne 0) { throw 'Could not create the disposable test database.' }
$previousTestDatabaseURL=$env:TEST_DATABASE_URL
$env:TEST_DATABASE_URL="postgres://voltra_dev:$($local.database_password)@127.0.0.1:55440/${testDatabase}?sslmode=disable"
$env:ENCRYPTION_KEY=$local.encryption_key
# Tests own this disposable database, and each fixture still owns its own schema.
# Explicit paths exclude generated acceptance overlays under artifacts/.
$arguments=@('test','./cmd/...','./internal/...','-count=1','-timeout=20m','-run',$Run)
if ($Race) { $arguments+='-race' }
if ($Json) { $arguments+='-json' }
$testExit=0
try {
    & go @arguments
    $testExit=$LASTEXITCODE
    if($testExit -eq 0) {
        & npm.cmd run check --prefix web
        $testExit=$LASTEXITCODE
    }
} finally {
    $env:TEST_DATABASE_URL=$previousTestDatabaseURL
    & docker exec voltra-dev-postgres dropdb -U voltra_dev --if-exists --force $testDatabase
    if($LASTEXITCODE -ne 0) { throw "Could not remove disposable test database $testDatabase." }
}
exit $testExit
