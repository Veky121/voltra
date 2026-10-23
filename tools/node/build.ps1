$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$artifactPath = Join-Path $projectPath 'artifacts/node'
New-Item -ItemType Directory -Force -Path $artifactPath | Out-Null
$previousGOOS = $env:GOOS
$previousGOARCH = $env:GOARCH
$previousCGO = $env:CGO_ENABLED
Push-Location $projectPath
try {
    $env:GOOS = 'linux'
    $env:CGO_ENABLED = '0'
    foreach ($architecture in @('amd64', 'arm64')) {
        $env:GOARCH = $architecture
        $destination = Join-Path $artifactPath "voltra-node-linux-$architecture"
        & go build -trimpath -ldflags '-s -w' -o $destination ./cmd/node
        if ($LASTEXITCODE -ne 0) { throw "Node build failed for $architecture" }
    }
    Get-FileHash -Algorithm SHA256 (Join-Path $artifactPath 'voltra-node-linux-*') |
        ForEach-Object { '{0}  {1}' -f $_.Hash.ToLowerInvariant(), (Split-Path $_.Path -Leaf) } |
        Set-Content -Encoding ascii (Join-Path $artifactPath 'SHA256SUMS')
}
finally {
    $env:GOOS = $previousGOOS
    $env:GOARCH = $previousGOARCH
    $env:CGO_ENABLED = $previousCGO
    Pop-Location
}
