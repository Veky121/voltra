param([switch]$Race, [switch]$Json, [string]$Run='.')
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$configuration=Join-Path $PSScriptRoot '.local/dev/environment.json'
if (-not (Test-Path -LiteralPath $configuration)) { throw 'Run ./dev.ps1 start first.' }
$local=Get-Content -LiteralPath $configuration -Raw | ConvertFrom-Json
foreach ($variable in @(Get-ChildItem Env: | Where-Object { $_.Name.StartsWith('PG') })) { [Environment]::SetEnvironmentVariable($variable.Name,$null,'Process') }
$env:TEST_DATABASE_URL="postgres://voltra_dev:$($local.database_password)@127.0.0.1:55440/voltra_dev?sslmode=disable"
$env:ENCRYPTION_KEY=$local.encryption_key
# Existing package fixtures create and clean separate schemas, preserving public.
# Explicit paths exclude generated acceptance overlays under artifacts/.
$arguments=@('test','./cmd/...','./internal/...','-count=1','-run',$Run)
if ($Race) { $arguments+='-race' }
if ($Json) { $arguments+='-json' }
& go @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& npm.cmd run check --prefix web
exit $LASTEXITCODE
