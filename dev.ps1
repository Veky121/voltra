param(
    [ValidateSet('start','stop','restart','status','logs','doctor','refresh')][string]$Action = 'start',
    [ValidateSet('app','backend','frontend','wings','database','all')][string]$Service = 'app',
    [int]$Tail = 60
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
$stateDir = Join-Path $root '.local/dev'
$logsDir = Join-Path $stateDir 'logs'
$binDir = Join-Path $stateDir 'bin'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$hash = [System.Security.Cryptography.SHA256]::Create()
$workspace = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-','').Substring(0,16).ToLowerInvariant()
$hash.Dispose()
$label = "voltra.dev.workspace=$workspace"
$containers = @{ database='voltra-dev-postgres'; wings='voltra-dev-wings' }
$ports = @{ backend=18089; frontend=5181; database=55440; wings=18085 }
foreach ($directory in @($stateDir,$logsDir,$binDir)) { [void][IO.Directory]::CreateDirectory($directory) }
Set-Location -LiteralPath $root
# An agent may have a remote Docker context in its shell. Never inherit it.
$env:DOCKER_CONTEXT='desktop-linux'
foreach($name in @('DOCKER_HOST','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')) { [Environment]::SetEnvironmentVariable($name,$null,'Process') }
$dockerEndpoint=& docker context inspect desktop-linux --format '{{.Endpoints.docker.Host}}'
if($LASTEXITCODE -ne 0 -or $dockerEndpoint -ne 'npipe:////./pipe/dockerDesktopLinuxEngine') { throw 'Development requires the local Docker Desktop Linux named pipe.' }
if($Action -eq 'restart' -and $Service -eq 'all') { throw 'Restart app, wings or database explicitly. App restarts preserve games and database connections.' }

function Write-Json($Path, $Value) {
    $temp = "$Path.$PID.tmp"
    [IO.File]::WriteAllText($temp, ($Value | ConvertTo-Json -Depth 15), $utf8)
    Move-Item -LiteralPath $temp -Destination $Path -Force
}
function Invoke-Docker([string[]]$Arguments) {
    $priorPreference=$ErrorActionPreference
    try { $ErrorActionPreference='Continue'; $result = & docker @Arguments 2>&1; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference=$priorPreference }
    if ($code -ne 0) { throw "Docker command failed: $($Arguments[0]). $($result -join ' ')" }
    return ($result -join "`n")
}
function Get-Container([string]$Name) {
    $found = Invoke-Docker @('ps','-a','--filter',"name=^${Name}$",'--format','{{.Names}}')
    if (-not $found) { return $null }
    $data = @( (Invoke-Docker @('inspect',$Name) | ConvertFrom-Json) )[0]
    if ($data.Config.Labels.'voltra.dev.workspace' -ne $workspace) { throw "Container $Name belongs to another workspace. Refusing to adopt it." }
    return $data
}
function Assert-PortFree([int]$Port) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    if ($listener) { throw "Port $Port is occupied. No process was stopped. Use dev.ps1 status to inspect this environment." }
}
function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes); $rng.Dispose()
    return ([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()
}
function Set-DevEnvironment {
    $configPath = Join-Path $stateDir 'environment.json'
    if (-not (Test-Path -LiteralPath $configPath)) {
        Write-Json $configPath @{workspace=$workspace; database_password=(New-Secret); encryption_key=(New-Secret); admin_password='admin'; member_password='memeber'; wings_token_id=(New-Secret).Substring(0,16); wings_token=(New-Secret)}
    }
    $script:config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($config.workspace -ne $workspace) { throw 'Development environment belongs to a different workspace.' }
    # Do not inherit production configuration from an agent shell.
    foreach ($variable in @(Get-ChildItem Env: | Where-Object { $_.Name.StartsWith('PG') })) { [Environment]::SetEnvironmentVariable($variable.Name,$null,'Process') }
    foreach ($key in @('CLOUDFLARE_ACCESS_TEAM_DOMAIN','CLOUDFLARE_ACCESS_AUDIENCE','CLOUDFLARE_ACCESS_LINK_ADMIN_EMAILS','NODE_RELEASE_VERSION','NODE_RELEASE_CHANNEL','ARTWORK_DIRECTORY','LOCALES_DIR','SMTP_HOST','SMTP_PASSWORD','VITE_DESKTOP','GOOS','GOARCH')) {
        [Environment]::SetEnvironmentVariable($key,$null,'Process')
    }
    $env:VOLTRA_LOCAL_DEV='true'
    $env:DEV_MODE='false'
    $env:DATABASE_URL="postgres://voltra_dev:$($config.database_password)@127.0.0.1:55440/voltra_dev?sslmode=disable"
    $env:ENCRYPTION_KEY=$config.encryption_key
    $env:VOLTRA_DEV_ADMIN_PASSWORD=$config.admin_password
    $env:VOLTRA_DEV_MEMBER_PASSWORD=$config.member_password
    $env:VOLTRA_DEV_WINGS_TOKEN_ID=$config.wings_token_id
    $env:VOLTRA_DEV_WINGS_TOKEN=$config.wings_token
    $env:LISTEN='127.0.0.1:18089'
    $env:PUBLIC_URL='http://127.0.0.1:5181'
    $env:DAEMON_URL='http://host.docker.internal:18089'
    $env:WEB_DIR=(Join-Path $root 'web/dist')
    $env:APP_TIMEZONE='UTC'
    $env:VOLTRA_UPLOAD_DIR=(Join-Path $stateDir 'uploads')
    $env:VOLTRA_DEV_API_URL='http://127.0.0.1:18089'
    $env:VOLTRA_DEV_WEB_PORT='5181'
    [IO.File]::WriteAllText((Join-Path $stateDir 'login.txt'), "Local development only`r`nURL: http://127.0.0.1:5181`r`nAdmin: admin`r`nPassword: $($config.admin_password)`r`nMember: member`r`nPassword: $($config.member_password)`r`n", $utf8)
}
function Get-OwnedProcess([string]$Name) {
    $path = Join-Path $stateDir "$Name.json"
    if (-not (Test-Path -LiteralPath $path)) { return $null }
    $record = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($record.workspace -ne $workspace) { throw "$Name process record belongs to a different workspace." }
    $process = Get-Process -Id $record.pid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne $record.started_ticks -or $process.Path -ne $record.executable) {
        throw "$Name PID has been reused or its executable changed. Refusing to stop or adopt it."
    }
    return $process
}
function Stop-DevProcess([string]$Name) {
    $process = Get-OwnedProcess $Name
    if ($process) { Stop-Process -Id $process.Id; $process.WaitForExit(15000) | Out-Null }
    $path = Join-Path $stateDir "$Name.json"
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
}
function Wait-HTTP([string]$Name,[string]$URL) {
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        if (-not (Get-OwnedProcess $Name)) { throw "$Name exited. Read dev.ps1 logs $Name." }
        try {
            $response=Invoke-WebRequest -UseBasicParsing -Uri $URL -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name did not become ready at $URL. Read dev.ps1 logs $Name."
}
function Build-Program([string]$Name,[string]$Package) {
    $output = Join-Path $binDir "$Name-$([DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff')).exe"
    Write-Host "Building $Name from this checkout..."
    & go build -o $output $Package
    if ($LASTEXITCODE -ne 0) { throw "$Name build failed. Existing processes were not stopped." }
    return $output
}
function Start-DevProcess([string]$Name,[string]$Executable,[string[]]$Arguments) {
    Assert-PortFree $ports[$Name]
    $start = @{FilePath=$Executable; WorkingDirectory=$root; WindowStyle='Hidden'; PassThru=$true; RedirectStandardOutput=(Join-Path $logsDir "$Name.out.log"); RedirectStandardError=(Join-Path $logsDir "$Name.err.log")}
    if ($Arguments.Count) { $start.ArgumentList=$Arguments }
    $process = Start-Process @start
    Write-Json (Join-Path $stateDir "$Name.json") @{workspace=$workspace;pid=$process.Id;started_ticks=$process.StartTime.ToUniversalTime().Ticks.ToString();executable=$process.Path;started_at=[DateTime]::UtcNow.ToString('o')}
}
function Start-Database {
    $existing = Get-Container $containers.database
    if (-not $existing) {
        Assert-PortFree 55440
        $volume='voltra-dev-postgres-data'
        $found=Invoke-Docker @('volume','ls','--filter',"name=^${volume}$",'--format','{{.Name}}')
        if ($found) {
            $info=@((Invoke-Docker @('volume','inspect',$volume) | ConvertFrom-Json))[0]
            if ($info.Labels.'voltra.dev.workspace' -ne $workspace) { throw 'Development database volume has a different owner.' }
        } else { Invoke-Docker @('volume','create','--label',$label,$volume) | Out-Null }
        # Supply secrets through a private env file, not process arguments.
        $dbEnv=Join-Path $stateDir 'postgres.env'
        [IO.File]::WriteAllText($dbEnv,"POSTGRES_USER=voltra_dev`nPOSTGRES_DB=voltra_dev`nPOSTGRES_PASSWORD=$($config.database_password)`n",$utf8)
        Invoke-Docker @('run','-d','--name',$containers.database,'--label',$label,'--restart','unless-stopped','-p','127.0.0.1:55440:5432','--env-file',$dbEnv,'-v',"${volume}:/var/lib/postgresql",'postgres:18-alpine') | Out-Null
    } elseif (-not $existing.State.Running) { Invoke-Docker @('start',$containers.database) | Out-Null }
    for ($attempt=0;$attempt -lt 60;$attempt++) {
        & docker exec $containers.database pg_isready -U voltra_dev -d voltra_dev *> $null
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Milliseconds 500
    }
    throw 'Local PostgreSQL did not become ready.'
}
function Seed-Database {
    $seed = Build-Program 'devseed' './cmd/devseed'
    & $seed | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Local seed failed. See error above.' }
    Write-Host 'Local records ready; existing edits preserved.'
}
function Start-Wings {
    $existing=Get-Container $containers.wings
    if ($existing) {
        Assert-WingsData
        if (-not $existing.State.Running) { Invoke-Docker @('start',$containers.wings) | Out-Null }
        return
    }
    Assert-PortFree 18085
    Assert-PortFree 12025
    & (Join-Path $root 'tools/dev/prepare-wings.ps1')
    Assert-WingsData
    $network='voltra_dev'
    $found=Invoke-Docker @('network','ls','--filter',"name=^${network}$",'--format','{{.Name}}')
    if ($found) {
        $info=@((Invoke-Docker @('network','inspect',$network) | ConvertFrom-Json))[0]
        if ($info.Labels.'voltra.dev.workspace' -ne $workspace) { throw 'Development Wings network has a different owner.' }
    } else { Invoke-Docker @('network','create','--label',$label,'--subnet','172.30.95.0/24','--gateway','172.30.95.1',$network) | Out-Null }
    $wingsConfig=Join-Path $stateDir 'wings.json'
    if (-not (Test-Path -LiteralPath $wingsConfig)) { throw 'Missing local Wings configuration. Run dev.ps1 start first.' }
    Invoke-Docker @('run','-d','--name',$containers.wings,'--label',$label,'--restart','unless-stopped','--memory','512m','--cpus','1',
        '-p','127.0.0.1:18085:18085','-p','127.0.0.1:12025:12025',
        '--mount',"type=bind,source=$wingsConfig,target=/etc/pterodactyl/config.yml,readonly",
        '-v','/var/run/docker.sock:/var/run/docker.sock','-v','/var/lib/voltra-dev:/var/lib/voltra-dev',
        'voltra-dev-wings:local','--config','/etc/pterodactyl/config.yml') | Out-Null
}
function Assert-WingsData {
    $check=Join-Path $root 'tools/dev/check-data-root.sh'
    Invoke-Docker @('run','--rm','--network','none','--read-only','--entrypoint','/bin/sh',
        '-v','/var/lib/voltra-dev:/state','--mount',"type=bind,source=$check,target=/check.sh,readonly",
        'voltra-dev-wings:local','/check.sh',$workspace) | Out-Null
}
function Start-Backend([bool]$Rebuild=$false) {
    $existing=Get-OwnedProcess 'backend'
    if ($existing -and -not $Rebuild) { Wait-HTTP 'backend' 'http://127.0.0.1:18089/healthz'; return }
    $binary=Build-Program 'panel' './cmd/panel'
    Stop-DevProcess 'backend'
    Start-DevProcess 'backend' $binary @()
    Wait-HTTP 'backend' 'http://127.0.0.1:18089/healthz'
}
function Wait-Wings {
    for ($attempt=0; $attempt -lt 90; $attempt++) {
        $container=Get-Container $containers.wings
        if (-not $container -or (-not $container.State.Running -and -not $container.State.Restarting)) { throw 'Local Wings exited. Read dev.ps1 logs wings.' }
        try {
            $response=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:18085/api/system' -Headers @{Authorization="Bearer $($config.wings_token)"} -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw 'Local Wings did not pass its authenticated system probe. Read dev.ps1 logs wings.'
}
function Start-Frontend([bool]$Restart=$false) {
    $existing=Get-OwnedProcess 'frontend'
    if ($existing -and -not $Restart) { Wait-HTTP 'frontend' 'http://127.0.0.1:5181'; return }
    $vite=Join-Path $root 'web/node_modules/vite/bin/vite.js'
    if (-not (Test-Path -LiteralPath $vite)) {
        & npm.cmd ci --prefix web
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency install failed.' }
    }
    Stop-DevProcess 'frontend'
    $node=(Get-Command node.exe).Source
    $frontendArgs=@(('"'+$vite+'"'),('"'+(Join-Path $root 'web')+'"'),'--host','127.0.0.1','--port','5181','--strictPort')
    Start-DevProcess 'frontend' $node $frontendArgs
    Wait-HTTP 'frontend' 'http://127.0.0.1:5181'
}
function Show-Status {
    Write-Host "Workspace dev environment: $root"
    foreach ($name in @('backend','frontend')) {
        $process=Get-OwnedProcess $name
        $detail=if($process){"running PID $($process.Id)"}else{'stopped'}
        Write-Host "$name`: $detail (127.0.0.1:$($ports[$name]))"
    }
    foreach ($name in @('database','wings')) {
        $container=Get-Container $containers[$name]
        $detail=if($container){$container.State.Status}else{'not created'}
        Write-Host "$name`: $detail ($($containers[$name]))"
    }
    Write-Host 'App: http://127.0.0.1:5181'
    Write-Host "Local account credentials: $stateDir\login.txt"
    if (Test-Path (Join-Path $stateDir 'seed.json')) {
        $seed=Get-Content (Join-Path $stateDir 'seed.json') -Raw | ConvertFrom-Json
        Write-Host "Seed: $(@($seed.servers).Count) local server records. Check the app for current installation and power state."
    }
    if (Test-Path (Join-Path $stateDir 'production-snapshot.json')) {
        $snapshot=Get-Content (Join-Path $stateDir 'production-snapshot.json') -Raw | ConvertFrom-Json
        Write-Host "Production inventory reference: $($snapshot.captured_at). Local data is independent."
    }
}

if ($Action -eq 'logs') {
    if ($Service -in @('database','wings')) { $container=Get-Container $containers[$Service]; if(-not $container){throw 'Development container has not been created.'}; Invoke-Docker @('logs','--tail',"$Tail",$containers[$Service]); exit 0 }
    $names=if($Service -in @('app','all')){@('backend','frontend')}else{@($Service)}
    foreach($name in $names) { foreach($stream in @('out','err')) { $file=Join-Path $logsDir "$name.$stream.log"; if(Test-Path -LiteralPath $file){Write-Host "$name $stream";Get-Content -LiteralPath $file -Tail $Tail} } }
    exit 0
}
if ($Action -eq 'status') { Show-Status; exit 0 }
if ($Action -eq 'doctor') {
    foreach ($tool in @('go','node','npm.cmd','docker','git')) { $command=Get-Command $tool -ErrorAction Stop; Write-Host "$tool`: $($command.Source)" }
    Invoke-Docker @('info','--format','Docker {{.ServerVersion}} ({{.OSType}})')
    Show-Status
    exit 0
}

# A kernel-backed exclusive file handle serializes mutations across all agents.
# The OS releases it on exit/crash; nobody owns the runtime after this command.
$lock=$null
$deadline=[DateTime]::UtcNow.AddSeconds(60)
while (-not $lock) {
    try { $lock=[IO.File]::Open((Join-Path $stateDir 'operation.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None) }
    catch [IO.IOException] { if([DateTime]::UtcNow -ge $deadline){throw 'Another dev operation is still running. Retry after it finishes.'}; Start-Sleep -Milliseconds 500 }
}
try {
    Set-DevEnvironment
    if ($Action -eq 'refresh') {
        & node (Join-Path $root 'tools/dev/snapshot.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Production inventory refresh failed; existing local data was preserved.' }
        Write-Host 'Sanitized production inventory refreshed. Local database, accounts and games were preserved.'
        exit 0
    }
    if ($Action -eq 'stop') {
        if ($Service -in @('app','all','frontend')) { Stop-DevProcess 'frontend' }
        if ($Service -in @('app','all','backend')) { Stop-DevProcess 'backend' }
        foreach($name in @('wings','database')) { if($Service -in @('all',$name)) { $container=Get-Container $containers[$name]; if($container -and $container.State.Running){Invoke-Docker @('stop',$containers[$name])|Out-Null} } }
    } elseif ($Action -eq 'restart' -and $Service -in @('database','wings')) {
        $container=Get-Container $containers[$Service]
        if (-not $container) { throw 'Run dev.ps1 start to initialize the environment first.' }
        if ($Service -eq 'wings') {
            & (Join-Path $root 'tools/dev/prepare-wings.ps1')
            Assert-WingsData
            $image=Invoke-Docker @('image','inspect','voltra-dev-wings:local','--format','{{.Id}}')
            if ($container.Image -ne $image) {
                Invoke-Docker @('stop',$containers.wings) | Out-Null
                Invoke-Docker @('rm',$containers.wings) | Out-Null
                Start-Wings
            } else { Invoke-Docker @('restart',$containers.wings) | Out-Null }
            Wait-Wings
        } else { Invoke-Docker @('restart',$containers.database) | Out-Null; Start-Database }
    } else {
        Start-Database
        if ($Action -eq 'start' -or -not (Test-Path (Join-Path $stateDir 'seed.json'))) { Seed-Database }
        if ($Service -in @('app','all','backend','wings')) { Start-Backend ($Action -eq 'restart') }
        if ($Service -in @('app','all','wings')) { Start-Wings; Wait-Wings }
        if ($Service -in @('app','all','frontend')) { Start-Frontend ($Action -eq 'restart') }
    }
    Show-Status
} finally { $lock.Dispose() }
