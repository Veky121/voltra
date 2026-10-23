param([switch]$Race, [switch]$Json)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
foreach ($line in Get-Content .local/runtime.env) { if ($line -match '^([A-Z0-9_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') } }
$env:TEST_DATABASE_URL=$env:DATABASE_URL
if ($Race) {
    $ErrorActionPreference='Continue'
    docker build -t pteroclone-go-tests -f tools/runtime/Dockerfile.tests .
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $containerDatabaseURL=$env:DATABASE_URL.Replace('127.0.0.1:55432','host.docker.internal:55432')
    @("TEST_DATABASE_URL=$containerDatabaseURL", "ENCRYPTION_KEY=$env:ENCRYPTION_KEY") | Set-Content .local/race.env -Encoding ascii
    $sourcePath=$PSScriptRoot.Replace('\','/')
    $referencePath=(Join-Path (Split-Path $PSScriptRoot -Parent) 'pterodactyl-vite/upstream').Replace('\','/')
    $dockerArguments = @('run','--rm','--env-file','.local/race.env','-v',"${sourcePath}:/app:ro",'-v',"${referencePath}:/pterodactyl-vite/upstream:ro",'-v','pteroclone-go-test-cache:/root/.cache/go-build','pteroclone-go-tests')
    if ($Json) {
        New-Item -ItemType Directory -Path artifacts -Force | Out-Null
        $dockerArguments += @('go','test','-json','-race','./...','-count=1','-timeout=180s')
        docker @dockerArguments | Out-File -FilePath artifacts/go-race.jsonl -Encoding utf8
    } else {
        docker @dockerArguments
    }
    exit $LASTEXITCODE
}
if ($Json) {
    New-Item -ItemType Directory -Path artifacts -Force | Out-Null
    go test ./... -json -count=1 | Out-File -FilePath artifacts/go-tests.jsonl -Encoding utf8
} else {
    go test ./... -count=1
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
go vet ./...
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run build --prefix web
exit $LASTEXITCODE
