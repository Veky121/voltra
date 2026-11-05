$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$credential=Get-Content (Join-Path $root '.local/dev/tooling-key.json') -Raw | ConvertFrom-Json
$seed=Get-Content (Join-Path $root '.local/dev/seed.json') -Raw | ConvertFrom-Json
$server=$seed.servers | Where-Object { $_.external_id -eq 'local-dev:mindustry/egg-mindustry.json' }
$origin='http://127.0.0.1:5181'
$socketData=Invoke-RestMethod -Uri "$origin/api/client/servers/$($server.uuid)/websocket" -Headers @{Authorization="Bearer $($credential.token)"}
$socket=[Net.WebSockets.ClientWebSocket]::new()
$socket.Options.SetRequestHeader('Authorization',"Bearer $($credential.token)")
$socket.Options.SetRequestHeader('Origin',$origin)
$timeout=[Threading.CancellationTokenSource]::new(15000)
try {
    $null=$socket.ConnectAsync([Uri]$socketData.data.socket,$timeout.Token).GetAwaiter().GetResult()
    $bytes=[Text.Encoding]::UTF8.GetBytes((@{event='auth';args=@($socketData.data.token)}|ConvertTo-Json -Compress))
    $null=$socket.SendAsync([ArraySegment[byte]]::new($bytes),[Net.WebSockets.WebSocketMessageType]::Text,$true,$timeout.Token).GetAwaiter().GetResult()
    $buffer=New-Object byte[] 65536
    $authenticated=$false
    for($attempt=0;$attempt -lt 12;$attempt++){
        $message=$socket.ReceiveAsync([ArraySegment[byte]]::new($buffer),$timeout.Token).GetAwaiter().GetResult()
        if($message.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close){throw 'Socket closed before authentication.'}
        $payload=[Text.Encoding]::UTF8.GetString($buffer,0,$message.Count)|ConvertFrom-Json
        if($payload.event -eq 'auth success'){$authenticated=$true;break}
    }
    if(-not $authenticated){throw 'No Wings authentication success received through Vite.'}
    $result=@{at=[DateTime]::UtcNow.ToString('o');vite_websocket_upgrade=$true;panel_proxy=$true;wings_authentication=$true;game_actions_sent=$false}
    $result|ConvertTo-Json|Set-Content (Join-Path $root '.local/dev/evidence/websocket-verification.json') -Encoding utf8
    $result|ConvertTo-Json
} finally {$socket.Abort();$socket.Dispose();$timeout.Dispose()}
