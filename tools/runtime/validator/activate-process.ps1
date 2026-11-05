param([Parameter(Mandatory=$true)][ValidateSet('inspect','activate','rollback')][string]$Mode,
 [Parameter(Mandatory=$true)][string]$Backup,[Parameter(Mandatory=$true)][string]$CampaignRoot,
 [Parameter(Mandatory=$true)][string]$ReviewPath)
$ErrorActionPreference='Stop'
function Digest($p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Process-Identity($panelId) {
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$panelId"
 if (!$p -or !$p.ExecutablePath) {throw 'Process identity unavailable'}
 @{pid=[int]$p.ProcessId;executable=$p.ExecutablePath;sha256=(Digest $p.ExecutablePath);start_time=(Get-Process -Id $panelId).StartTime.ToUniversalTime().ToString('o')}
}
if ($Mode -eq 'inspect') {
 $review=Get-Content -LiteralPath $ReviewPath -Raw
 if (!$review) {throw 'Private inspection review absent'}
 $r=$review|ConvertFrom-Json
 $ids=@($r.runtime_identity.pid)+@($r.protected_processes|ForEach-Object {$_.pid})
 $listeners=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -in @(18099,8088,5180)} | Sort-Object LocalPort,LocalAddress | ForEach-Object {@{port=[int]$_.LocalPort;address=$_.LocalAddress;pid=[int]$_.OwningProcess}})
 $ids+=@($listeners|ForEach-Object {$_.pid})
 foreach($name in @('pending-process.json','restored-process.json')) { $p=Join-Path $Backup $name; if(Test-Path -LiteralPath $p) {$ids+=((Get-Content -LiteralPath $p -Raw|ConvertFrom-Json).pid)} }
 $processes=@($ids|Sort-Object -Unique|ForEach-Object {if(Get-Process -Id $_ -ErrorAction SilentlyContinue){Process-Identity $_}})
 $jobs=@(Get-CimInstance Win32_Process | Where-Object {$_.ProcessId -ne $PID -and $_.CommandLine -match '(?i)(validator[\\/](campaign|runner|shared-suite)\.mjs|campaign-native-20261029\.mjs\s)'} | ForEach-Object {[int]$_.ProcessId})
 @{processes=$processes;listeners=$listeners;jobs=$jobs}|ConvertTo-Json -Depth 10 -Compress
 exit
}
$CampaignRoot=[IO.Path]::GetFullPath($CampaignRoot)
$Backup=[IO.Path]::GetFullPath($Backup)
if (!$Backup.StartsWith($CampaignRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {throw 'Backup outside campaign root'}
$old=Get-Content -LiteralPath (Join-Path $Backup 'root.json') -Raw|ConvertFrom-Json
$candidate=Get-Content -LiteralPath (Join-Path $Backup 'candidate.json') -Raw|ConvertFrom-Json
$envObject=Get-Content -LiteralPath (Join-Path $Backup 'env.json') -Raw|ConvertFrom-Json
$envFile=Join-Path $CampaignRoot '.local/game-parity-20261029/runtime/panel-private-env.json'
if ((Digest $envFile) -ne (Digest (Join-Path $Backup 'env.json'))) {throw 'Private environment changed'}
$db=[Uri]$envObject.DATABASE_URL
if ($envObject.LISTEN -ne '127.0.0.1:18099' -or $db.Host -ne '127.0.0.1' -or $db.Port -ne 55439 -or $db.AbsolutePath -ne '/campaign') {throw 'Environment scope mismatch'}
function Exact($record) {
 $p=Process-Identity $record.pid
 if ($p.executable -ne $record.executable -or $p.sha256 -ne $record.binary_sha256 -or $p.start_time -ne $record.start_time) {throw 'Exact process identity changed'}
}
function Health($panelId) {
 for($i=0;$i -lt 40;$i++) {
  try {$l=@(Get-NetTCPConnection -LocalPort 18099 -State Listen);if($l.Count -eq 1 -and $l[0].LocalAddress -eq '127.0.0.1' -and $l[0].OwningProcess -eq $panelId -and (Invoke-WebRequest 'http://127.0.0.1:18099/healthz' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200){return}}catch{}
  Start-Sleep -Milliseconds 250
 };throw 'Health/listener failed'
}
function Start-Panel($exe,$environment,$prefix) {
 $environment.psobject.Properties|ForEach-Object {[Environment]::SetEnvironmentVariable($_.Name,[string]$_.Value,'Process')}
 Start-Process -FilePath $exe -WorkingDirectory $CampaignRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $Backup "$prefix.stdout.log") -RedirectStandardError (Join-Path $Backup "$prefix.stderr.log")
}
function Record($panelId,$template,$file) {
 $p=Process-Identity $panelId
 $r=$template|ConvertTo-Json -Depth 30|ConvertFrom-Json
 $r|Add-Member -Force NoteProperty pid $panelId
 $r|Add-Member -Force NoteProperty start_time $p.start_time
 $r|ConvertTo-Json -Depth 30|Set-Content -LiteralPath (Join-Path $Backup $file) -Encoding UTF8
}
if($Mode -eq 'activate') {
 Exact $old
 $l=@(Get-NetTCPConnection -LocalPort 18099 -State Listen)
 if($l.Count -ne 1 -or $l[0].OwningProcess -ne $old.pid -or $l[0].LocalAddress -ne '127.0.0.1'){throw 'Old listener mismatch'}
 if([IO.Path]::IsPathRooted($candidate.backend.binary)){$exe=[IO.Path]::GetFullPath($candidate.backend.binary)}else{$exe=[IO.Path]::GetFullPath((Join-Path $CampaignRoot $candidate.backend.binary))}
 if((Digest $exe) -ne $candidate.backend.binary_sha256){throw 'Candidate hash drift'}
 if([IO.Path]::IsPathRooted($candidate.frontend.output)){$web=[IO.Path]::GetFullPath($candidate.frontend.output)}else{$web=[IO.Path]::GetFullPath((Join-Path $CampaignRoot $candidate.frontend.output))}
 $envObject|Add-Member -Force NoteProperty WEB_DIR $web
 Stop-Process -Id $old.pid
 $p=Start-Panel $exe $envObject 'new'
 $r=@{pid=$p.Id;executable=$exe;binary_sha256=$candidate.backend.binary_sha256;source_fingerprint=$candidate.backend.fingerprint;frontend=$web;start_time=(Process-Identity $p.Id).start_time}
 $r|ConvertTo-Json -Depth 10|Set-Content -LiteralPath (Join-Path $Backup 'replacement.json') -Encoding UTF8
 Health $p.Id
 Record $p.Id $r 'pending-process.json'
}else {
 $replacement=Join-Path $Backup 'replacement.json'
 if(Test-Path -LiteralPath $replacement) {
  $r=Get-Content -LiteralPath $replacement -Raw|ConvertFrom-Json
  if(Get-Process -Id $r.pid -ErrorAction SilentlyContinue){Exact $r;Stop-Process -Id $r.pid}
 }
 if((Digest $old.executable) -ne $old.binary_sha256){throw 'Rollback binary changed'}
 if(Get-Process -Id $old.pid -ErrorAction SilentlyContinue){Exact $old;$restoredId=$old.pid}else{
  # Restore the old process-only WEB_DIR from the recorded runtime, never edit private env.
  if(!$old.frontend){throw 'Exact rollback WEB_DIR missing'}
  $envObject|Add-Member -Force NoteProperty WEB_DIR $old.frontend
  $p=Start-Panel $old.executable $envObject 'restored';$restoredId=$p.Id
 }
 Health $restoredId
 Record $restoredId $old 'restored-process.json'
}
