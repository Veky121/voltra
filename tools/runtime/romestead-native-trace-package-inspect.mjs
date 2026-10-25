import path from 'node:path';import {spawnSync} from 'node:child_process';
const code=`import zipfile,json
with zipfile.ZipFile('/package.nupkg')as z:
 print(json.dumps([{'name':i.filename,'bytes':i.file_size,'namespace':b'Microsoft.Diagnostics.Tracing'in z.read(i),'eventpipe':b'EventPipeEventSource'in z.read(i)}for i in z.infolist()if'TraceEvent.dll'in i.filename or'FastSerialization.dll'in i.filename]))`;
const r=spawnSync('docker',['run','--rm','-i','--pull','never','--network','none','--memory','256m','--mount',`type=bind,source=${path.resolve('.local/romestead-native/diagnostic-public-source/dotnet-trace.nupkg')},target=/package.nupkg,readonly`,'python:3.13-slim','python3','-B','-'],{windowsHide:true,input:code,encoding:'utf8'});console.log(r.stdout+r.stderr);if(r.status)process.exitCode=r.status;
