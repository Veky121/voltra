# Exercises only the designated dev app. Does not restart Wings, DB or games.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$state=Join-Path $root '.local/dev'
$evidence=Join-Path $state 'evidence'
[void][IO.Directory]::CreateDirectory($evidence)
$controller=Join-Path $root 'dev.ps1'
function Child([string]$Name,[string[]]$Arguments) {
    $process=Start-Process powershell.exe -ArgumentList (@('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$controller+'"'))+$Arguments) -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $evidence "$Name.out.log") -RedirectStandardError (Join-Path $evidence "$Name.err.log")
    $null=$process.Handle
    return $process
}
function Finish($Process,[bool]$Success=$true) {
    if(-not $Process.WaitForExit(180000)){throw 'Controller check timed out.'}
    $Process.Refresh()
    if(($Process.ExitCode -eq 0) -ne $Success){throw "Unexpected controller exit code $($Process.ExitCode). Inspect evidence logs."}
}
function Record([string]$Name){Get-Content (Join-Path $state "$Name.json") -Raw | ConvertFrom-Json}
function Assert($Condition,[string]$Message){if(-not $Condition){throw $Message}}
Finish (Child 'runtime-initial-start' @('start'))
$backend=Record 'backend';$frontend=Record 'frontend'
$wingsBefore=docker inspect voltra-dev-wings --format '{{.Id}} {{.State.StartedAt}}'
$dbBefore=docker inspect voltra-dev-postgres --format '{{.Id}} {{.State.StartedAt}}'
Finish (Child 'runtime-idempotent-start' @('start'))
Assert ((Record 'backend').pid -eq $backend.pid) 'Repeated start replaced the backend.'
Assert ((Record 'frontend').pid -eq $frontend.pid) 'Repeated start replaced Vite.'
$first=Child 'runtime-concurrent-one' @('restart','backend')
$second=Child 'runtime-concurrent-two' @('restart','backend')
Finish $first;Finish $second
Assert ((Record 'backend').pid -ne $backend.pid) 'Backend was not rebuilt/restarted.'
Assert ((Record 'frontend').pid -eq $frontend.pid) 'Backend restart replaced Vite.'
Assert ((docker inspect voltra-dev-wings --format '{{.Id}} {{.State.StartedAt}}') -eq $wingsBefore) 'Backend restart touched Wings.'
Assert ((docker inspect voltra-dev-postgres --format '{{.Id}} {{.State.StartedAt}}') -eq $dbBefore) 'Backend restart touched PostgreSQL.'

# A live but mismatched process record must never authorize termination.
$recordPath=Join-Path $state 'frontend.json'
$original=[IO.File]::ReadAllText($recordPath)
try {
    $wrong=$original | ConvertFrom-Json
    $wrong.started_ticks='0'
    [IO.File]::WriteAllText($recordPath,($wrong|ConvertTo-Json))
    Finish (Child 'runtime-pid-guard' @('stop','frontend')) $false
    Assert ($null -ne (Get-Process -Id $frontend.pid -ErrorAction SilentlyContinue)) 'Mismatched process record killed Vite.'
} finally {[IO.File]::WriteAllText($recordPath,$original)}

Finish (Child 'runtime-stop-frontend' @('stop','frontend'))
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,5181)
try {
    $listener.Start()
    Finish (Child 'runtime-port-guard' @('start','frontend')) $false
    Assert ($listener.Server.IsBound) 'Controller interfered with unrelated listener.'
} finally {
    $listener.Stop()
    Finish (Child 'runtime-restore-frontend' @('start','frontend'))
}

# Simulate a terminated agent holding the operation lock. OS handle release
# must suffice: do not delete or forcibly unlock the shared file.
$lockScript=Join-Path $evidence 'hold-operation-lock.ps1'
$ready=Join-Path $evidence 'lock-held.txt'
if(Test-Path -LiteralPath $ready){Remove-Item -LiteralPath $ready}
$escapedState=$state.Replace("'","''")
$escapedReady=$ready.Replace("'","''")
[IO.File]::WriteAllText($lockScript, "`$lock=[IO.File]::Open('$escapedState/operation.lock','OpenOrCreate','ReadWrite','None');[IO.File]::WriteAllText('$escapedReady','ready');Start-Sleep -Seconds 30")
$holder=Start-Process powershell.exe -ArgumentList @('-NoProfile','-File',('"'+$lockScript+'"')) -WindowStyle Hidden -PassThru
try {
    $deadline=[DateTime]::UtcNow.AddSeconds(10)
    while(-not(Test-Path -LiteralPath $ready)) {if($holder.HasExited -or [DateTime]::UtcNow -gt $deadline){throw 'Lock fixture failed.'};Start-Sleep -Milliseconds 100}
    $holder.Kill();$holder.WaitForExit()
    Finish (Child 'runtime-crashed-lock-recovery' @('restart','backend'))
} finally {if(-not $holder.HasExited){$holder.Kill();$holder.WaitForExit()}}
$result=@{at=[DateTime]::UtcNow.ToString('o');idempotent_start=$true;concurrent_restarts=$true;process_identity_guard=$true;port_conflict_guard=$true;crashed_lock_recovery=$true;wings_and_database_preserved=$true;url='http://127.0.0.1:5181'}
$result | ConvertTo-Json | Set-Content (Join-Path $evidence 'runtime-verification.json') -Encoding utf8
$result | ConvertTo-Json
