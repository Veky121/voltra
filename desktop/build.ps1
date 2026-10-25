param(
    [string]$Version = '0.1.0-dev',
    [string]$UpdateManifestURL = '',
    [string]$UpdatePublicKey = '',
    [switch]$DisableUpdates
)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$') { throw 'Use a semantic version such as 0.1.0 or 0.1.0-dev.' }
    if ([bool]$UpdateManifestURL -ne [bool]$UpdatePublicKey) { throw 'Supply both UpdateManifestURL and UpdatePublicKey, or leave both empty.' }
    if ($DisableUpdates -and ($UpdateManifestURL -or $UpdatePublicKey)) { throw 'DisableUpdates cannot be combined with an update feed.' }
    if ($UpdateManifestURL -and $UpdateManifestURL -notmatch '^https://[^\s''"]+\{\{channel\}\}[^\s''"]*$') { throw 'The update manifest must use HTTPS and contain {{channel}}.' }
    if ($UpdatePublicKey -and $UpdatePublicKey -notmatch '^[A-Za-z0-9+/=]+$') { throw 'Pass standard base64 of the raw 32-byte Ed25519 public key.' }
    $previousDesktop = $env:VITE_DESKTOP
    try {
        $env:VITE_DESKTOP = 'true'
        npm.cmd run check --prefix ../web
        if ($LASTEXITCODE -ne 0) { throw 'Desktop TypeScript check failed.' }
        Push-Location ../web
        try {
            node node_modules/vite/bin/vite.js build --outDir ../desktop/frontend --emptyOutDir
            if ($LASTEXITCODE -ne 0) { throw 'Desktop frontend build failed.' }
        } finally { Pop-Location }
    } finally { $env:VITE_DESKTOP = $previousDesktop }
    Set-Content -LiteralPath frontend/.gitkeep -Value '' -Encoding ascii
    New-Item -ItemType Directory -Path bin -Force | Out-Null
    $iconArch = go env GOARCH
    if ($LASTEXITCODE -ne 0) { throw 'Could not determine target architecture.' }
    go -C ../tools/branding/resource run . -icon "$PSScriptRoot/assets/app.ico" -out "$PSScriptRoot/rsrc_windows_$iconArch.syso" -arch $iconArch
    if ($LASTEXITCODE -ne 0) { throw 'Desktop icon resource generation failed.' }
    $linker = "-s -w -H windowsgui -X main.version=$Version"
    if ($DisableUpdates) { $linker += ' -X main.updateManifestURL= -X main.updatePublicKey=' }
    if ($UpdateManifestURL) { $linker += " -X main.updateManifestURL=$UpdateManifestURL -X main.updatePublicKey=$UpdatePublicKey" }
    go build -trimpath -ldflags $linker -o bin/Voltra.exe .
    if ($LASTEXITCODE -ne 0) { throw 'Desktop executable build failed.' }
    Write-Host "Built $PSScriptRoot\bin\Voltra.exe"
} finally { Pop-Location }
