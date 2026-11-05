[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# This helper only builds an image. It never starts or replaces a Wings daemon.
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$cacheRoot = Join-Path $projectRoot '.local/dev/wings-build'
$upstream = '6987d5e6f0612133e031255a99655e822d30579a'
$repository = 'https://github.com/pterodactyl/wings.git'
$imageName = 'voltra-dev-wings:local'
$dockerfile = Join-Path $PSScriptRoot 'Dockerfile.wings'
$inputs = @(
    'go.mod',
    'tools/dev/prepare-wings.ps1', 'tools/dev/Dockerfile.wings',
    'tools/wings/apply-release.mjs', 'tools/runtime/wings-failed-install-logs.patch',
    'tools/wings/install_wait_test.go.txt', 'tools/wings/remote-download-headers.patch',
    'tools/wings/remote_headers.go.txt', 'tools/wings/remote_headers_test.go.txt',
    'tools/wings/remote_transfers.go.txt', 'tools/wings/remote_transfers_test.go.txt'
)
foreach ($command in @('git', 'node', 'go', 'docker')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) { throw "Required command is unavailable: $command" }
}

function Assert-Exit([string]$Operation) {
    if ($LASTEXITCODE -ne 0) { throw "$Operation failed with exit code $LASTEXITCODE." }
}
function Hash-Text([string]$Value) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value)))).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
function Write-JSON([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 12) + "`n", [Text.UTF8Encoding]::new($false))
}

New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
$lockPath = Join-Path $cacheRoot 'build.lock'
$buildLock = $null
$deadline = [DateTime]::UtcNow.AddSeconds(45)
while ($null -eq $buildLock) {
    try { $buildLock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] {
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Another local Wings image build is still running. Retry after it finishes.' }
        Start-Sleep -Milliseconds 250
    }
}

$savedEnvironment = @{}
foreach ($key in @('GOOS', 'GOARCH', 'CGO_ENABLED', 'GOTOOLCHAIN', 'GOFLAGS', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')) {
    $savedEnvironment[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
}
try {
    foreach ($key in @('DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')) {
        [Environment]::SetEnvironmentVariable($key, $null, 'Process')
    }
    $env:DOCKER_CONTEXT = 'desktop-linux'
    $dockerEndpoint = (& docker context inspect desktop-linux --format '{{.Endpoints.docker.Host}}' | Out-String).Trim()
    Assert-Exit 'Inspect local Docker Desktop context'
    if ($dockerEndpoint -cne 'npipe:////./pipe/dockerDesktopLinuxEngine') {
        throw 'Local Wings builds require the Docker Desktop Linux named-pipe endpoint. No image was changed.'
    }
    $dockerOS = (& docker info --format '{{.OSType}}' | Out-String).Trim()
    Assert-Exit 'Check Docker Desktop Linux engine'
    if ($dockerOS -ne 'linux') { throw 'Local Wings builds require Docker Desktop Linux containers.' }
    $goDirective = [regex]::Match((Get-Content -LiteralPath (Join-Path $projectRoot 'go.mod') -Raw), '(?m)^go\s+(\d+\.\d+\.\d+)\s*$')
    if (-not $goDirective.Success) { throw 'Expected an exact Go toolchain version in the panel go.mod.' }
    $env:GOTOOLCHAIN = 'go' + $goDirective.Groups[1].Value
    $env:GOFLAGS = ''
    $toolchain = (& go version | Out-String).Trim()
    Assert-Exit 'Go version check'
    $inputHashes = @($inputs | ForEach-Object {
        [ordered]@{path = $_; sha256 = (Get-FileHash -LiteralPath (Join-Path $projectRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant()}
    })
    $fingerprint = Hash-Text ([ordered]@{upstream = $upstream; toolchain = $toolchain; inputs = $inputHashes} | ConvertTo-Json -Depth 8 -Compress)
    $receiptPath = Join-Path $cacheRoot 'build.json'
    $dist = Join-Path $cacheRoot 'dist'
    $binary = Join-Path $dist 'wings'
    $cached = $null
    if (Test-Path -LiteralPath $receiptPath) {
        try {
            $cached = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
            foreach ($field in @('fingerprint', 'binary_sha256', 'image_id')) {
                if ($null -eq $cached.PSObject.Properties[$field]) { $cached = $null; break }
            }
        } catch { $cached = $null }
    }
    if ($null -ne $cached -and $cached.fingerprint -eq $fingerprint -and (Test-Path -LiteralPath $binary)) {
        $binaryHash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
        $imageID = & docker image ls --no-trunc --quiet --filter "reference=$imageName"
        if ($LASTEXITCODE -eq 0 -and $binaryHash -eq $cached.binary_sha256 -and $imageID -eq $cached.image_id) {
            Write-Host "Local patched Wings image is current: $imageName"
            return
        }
    }

    # A unique source tree avoids resetting someone else's work and permits retry after failure.
    $source = Join-Path $cacheRoot ('source-' + $fingerprint.Substring(0, 12) + '-' + [Guid]::NewGuid().ToString('N'))
    & git init --quiet $source
    Assert-Exit 'Initialize isolated Wings source'
    & git -C $source config core.autocrlf false
    Assert-Exit 'Configure source line endings'
    & git -C $source remote add origin $repository
    Assert-Exit 'Configure pinned upstream remote'
    & git -C $source fetch --quiet --depth=1 origin $upstream
    Assert-Exit 'Fetch pinned Wings source'
    & git -C $source checkout --quiet --detach FETCH_HEAD
    Assert-Exit 'Checkout pinned Wings source'
    & node (Join-Path $projectRoot 'tools/wings/apply-release.mjs') $source
    Assert-Exit 'Apply complete current Wings patches'

    New-Item -ItemType Directory -Path $dist -Force | Out-Null
    $env:GOOS = 'linux'
    $env:GOARCH = 'amd64'
    $env:CGO_ENABLED = '0'
    Push-Location -LiteralPath $source
    try {
        & go build -mod=readonly -trimpath -buildvcs=false '-ldflags=-s -w -buildid= -X github.com/pterodactyl/wings/system.Version=dev-voltra-upstream1.13.3' -o $binary .
        Assert-Exit 'Compile local patched Wings'
    } finally { Pop-Location }

    Copy-Item -LiteralPath (Join-Path $source 'LICENSE') -Destination (Join-Path $dist 'WINGS-LICENSE')
    $provenance = Get-Content -LiteralPath (Join-Path $source 'voltra-provenance.json') -Raw | ConvertFrom-Json
    $provenance | Add-Member -NotePropertyName toolchain -NotePropertyValue $toolchain
    $provenance | Add-Member -NotePropertyName dev_input_fingerprint -NotePropertyValue $fingerprint
    $binaryHash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
    $provenance | Add-Member -NotePropertyName binary_sha256 -NotePropertyValue $binaryHash
    Write-JSON (Join-Path $dist 'wings-provenance.json') $provenance
    & docker build --file $dockerfile --tag $imageName --label "com.voltra.dev.wings.fingerprint=$fingerprint" --label "com.voltra.dev.wings.binary-sha256=$binaryHash" $dist
    Assert-Exit 'Build local Wings image'
    # The version subcommand exits without reading node credentials or starting a daemon.
    & docker run --rm --network none --read-only $imageName version
    Assert-Exit 'Verify local Wings executable'
    $imageID = & docker image inspect $imageName --format '{{.Id}}'
    Assert-Exit 'Read local image identity'
    Write-JSON $receiptPath ([ordered]@{
        fingerprint = $fingerprint; upstream_commit = $upstream; toolchain = $toolchain
        image = $imageName; image_id = $imageID; binary_sha256 = $binaryHash
        source_directory = $source; inputs = $inputHashes; built_at = [DateTime]::UtcNow.ToString('o')
    })
    Write-Host "Prepared $imageName. No daemon was started."
} finally {
    foreach ($key in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnvironment[$key], 'Process') }
    if ($null -ne $buildLock) { $buildLock.Dispose() }
}
