"""MIT wrapper. Official DMP payload / explicitly patched official LMP source."""
import hashlib,json,os,re,shutil,stat,subprocess,sys,tempfile,urllib.request,zipfile
from pathlib import Path,PurePosixPath
DMP_URL='https://d-mp.org/builds/release/v0.3.8.5/DMPServer.zip'
DMP_SHA='c1dbc89502fbd7837b80f6c1d5d5c08b87cc8c4063756f97b3f70d9b9177f28b'
LMP_COMMIT='60a2ed5dbfdddc08536a98b999c781e3c12b0649'
def sha(path):
    value=hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda:source.read(1048576),b''):value.update(block)
    return value.hexdigest()
def download(root,url,digest,target):
    cached=root/'.voltra/public-cache'/digest
    if cached.is_file():
        if not cached.resolve().is_relative_to(root) or sha(cached)!=digest:raise ValueError('Invalid public archive cache copy')
        shutil.copyfile(cached,target);return True
    with urllib.request.urlopen(url,timeout=60) as source,target.open('wb') as output:
        total=0
        for block in iter(lambda:source.read(1048576),b''):
            total+=len(block)
            if total>32*1024**2:raise ValueError('Server archive exceeds bounded release size')
            output.write(block)
    if sha(target)!=digest:raise ValueError('Official server archive checksum mismatch')
    return False
def unpack(archive,stage,prefix):
    seen=set();total=0
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            name=PurePosixPath(entry.filename)
            if name.is_absolute() or '..' in name.parts or '\\' in entry.filename or not name.parts or name.parts[0]!=prefix or stat.S_ISLNK(entry.external_attr>>16):raise ValueError('Unsafe server release archive')
            relative=PurePosixPath(*name.parts[1:])
            if str(relative)=='.':continue
            if str(relative).casefold() in seen:raise ValueError('Duplicate server archive path')
            seen.add(str(relative).casefold());total+=entry.file_size
            if len(seen)>20000 or total>256*1024**2:raise ValueError('Server archive expansion exceeds bound')
            target=stage.joinpath(*relative.parts)
            if entry.is_dir():target.mkdir(parents=True,exist_ok=True)
            else:
                target.parent.mkdir(parents=True,exist_ok=True)
                with source.open(entry) as inp,target.open('xb') as output:shutil.copyfileobj(inp,output)
                target.chmod(0o644)
def patch_source(source):
    project=source/'Server/Server.csproj'
    if not project.is_file() or '<Project Sdk=' not in project.read_text(encoding='utf-8-sig'):raise ValueError('This LMP release has no supported SDK server source project')
    changed=[]
    for path in source.rglob('*.csproj'):
        if not path.resolve().is_relative_to(source.resolve()):raise ValueError('Source project escapes pinned checkout')
        text=path.read_text(encoding='utf-8-sig');updated=text.replace('>net6.0<','>net10.0<').replace('>net5.0<','>net10.0<')
        updated=updated.replace('Include="DotNetZip" Version="1.15.0"','Include="ProDotNetZip" Version="1.19.0"').replace('Include="Newtonsoft.Json" Version="12.0.3"','Include="Newtonsoft.Json" Version="13.0.4"').replace('Include="log4net" Version="2.0.12"','Include="log4net" Version="3.3.0"')
        if path.name=='LmpUpdater.csproj':updated=re.sub(r'<Target Name="CopyCustomContent".*?</Target>','',updated,flags=re.S)
        if updated!=text:path.write_text(updated);changed.append(str(path.relative_to(source)))
    if '<TargetFramework>net10.0</TargetFramework>' not in project.read_text():raise ValueError('This LMP release needs a separately reviewed runtime adaptation')
    checker=source/'Server/Utilities/DotNetRuntimeChecker.cs'
    if checker.exists():
        text=checker.read_text(encoding='utf-8-sig')
        if not any('private const int RequiredMajorVersion = '+value+';' in text for value in ['6','10']):raise ValueError('Unexpected LMP runtime checker; review this version explicitly')
        checker.write_text(text.replace('private const int RequiredMajorVersion = 6;','private const int RequiredMajorVersion = 10;').replace('.NET 6','.NET 10').replace('/dotnet/6.0','/dotnet/10.0'))
        changed.append(str(checker.relative_to(source)))
    http=source/'uhttpsharp/HttpClient.cs'
    if http.exists():
        text=http.read_text();updated=text.replace('new StreamWriter(limitedStream) { AutoFlush = false }','new StreamWriter(limitedStream) { AutoFlush = false, NewLine = "\\r\\n" }')
        if updated!=text:http.write_text(updated);changed.append(str(http.relative_to(source)))
    main=source/'Server/MainServer.cs'
    if main.exists():
        text=main.read_text();updated=text.replace('Console.CancelKeyPress += (sender, args) => Exit();','Console.CancelKeyPress += (sender, args) => { args.Cancel = true; Exit(); };')
        if updated!=text:main.write_text(updated);changed.append(str(main.relative_to(source)))
    return changed

def dmp_patch(source):
    for project in source.rglob('*.csproj'):
        if not project.resolve().is_relative_to(source.resolve()):raise ValueError('DMP project escapes checkout')
        text=project.read_text(encoding='utf-8-sig')
        text=re.sub(r'<TargetFrameworks>[^<]+</TargetFrameworks>','<TargetFramework>net10.0</TargetFramework>',text)
        project.write_text(text)
    client=source/'Server/ClientHandler.cs';text=client.read_text()
    text=text.replace('TCPServer.Server.DualMode = true;','if (TCPServer.Server.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6) TCPServer.Server.DualMode = true;') if 'if (TCPServer.Server.AddressFamily ==' not in text else text
    client.write_text(text)
    main=source/'Server/Main.cs';text=main.read_text().replace('commandThread.Abort();','// Console input is a background thread; native shutdown joins the client thread.')
    if 'commandThread.IsBackground = true;' not in text:text=text.replace('commandThread.Start();','commandThread.IsBackground = true;\n                commandThread.Start();')
    main.write_text(text)

def owned_git_environment(environment,paths):
    # Wings changes installed files to the native game UID. Reinstallation runs
    # as root; trust only these exact already-confined private source checkouts.
    environment['GIT_CONFIG_COUNT']=str(len(paths))
    for index,path in enumerate(paths):
        environment['GIT_CONFIG_KEY_'+str(index)]='safe.directory'
        environment['GIT_CONFIG_VALUE_'+str(index)]=str(path)
def install(root,game,env):
    root=Path(root).resolve();private=root/'.voltra/ksp';private.mkdir(parents=True,exist_ok=True)
    if not private.resolve().is_relative_to(root):raise ValueError('KSP installer state escapes volume')
    if game=='dmp':
        commit='8253dc8e4f40e4519c085c3ee223abecd1a52954';source=private/'dmp-sources'/commit
        if not source.resolve().is_relative_to(root):raise ValueError('DMP source escapes volume')
        buildenv={'PATH':os.environ['PATH'],'HOME':str(private/'build-home'),'DOTNET_CLI_HOME':str(private/'build-home'),'DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_GCHeapHardLimit':'0x10000000','GIT_TERMINAL_PROMPT':'0'}
        source.parent.mkdir(parents=True,exist_ok=True)
        owned_git_environment(buildenv,[source,*[source/name for name in ['External/UDPMeshLib','External/SettingsParser','External/MessageStream2']]])
        if not source.exists():subprocess.run(['git','clone','--filter=blob:none','--depth','1','--branch','v0.3.8.5','--sparse','https://github.com/godarklight/DarkMultiPlayer.git',str(source)],check=True,env=buildenv)
        subprocess.run(['git','-C',str(source),'sparse-checkout','set','Server','Common','External'],check=True,env=buildenv)
        if subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],env=buildenv,text=True).strip()!=commit:raise ValueError('DMP source pin mismatch')
        modules={'External/UDPMeshLib':'b422f43df58b366300c142b1c4d3a3375565781f','External/SettingsParser':'0a1c1e1666bf94a9069acf1967e64d2679dc27a2','External/MessageStream2':'d2d4b3062e8a42752d801d770a54e97cdd9e5bfc'}
        subprocess.run(['git','-C',str(source),'submodule','update','--init','--depth','1',*modules],check=True,env=buildenv)
        for path,digest in modules.items():
            if subprocess.check_output(['git','-C',str(source/path),'rev-parse','HEAD'],env=buildenv,text=True).strip()!=digest:raise ValueError('DMP dependency pin mismatch')
        dmp_patch(source);output=private/'dmp-output';subprocess.run(['dotnet','publish',str(source/'Server/Server.csproj'),'-c','Release','--self-contained','false','-o',str(output),'-m:1','-p:UseSharedCompilation=false'],check=True,env=buildenv)
        for path in output.rglob('*'):
            if not path.is_file():continue
            destination=root/path.relative_to(output)
            if not destination.resolve().is_relative_to(root):raise ValueError('DMP output escapes volume')
            destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,destination)
        shutil.copyfile(source/'LICENCE.txt',private/'DMP-LICENCE.txt')
        patches={str(path):subprocess.check_output(['git','-C',str(path),'diff'],env=buildenv,text=True) for path in [source,*[source/name for name in modules]]}
        (private/'dmp-source.patch.json').write_text(json.dumps(patches))
        receipt={'game':game,'version':'0.3.8.5','source_commit':commit,'dependency_commits':modules,'modified_binary':True,'patch':'Retarget net472/net6 projects to net10; set DualMode only on IPv6; background console reader replaces unsupported Thread.Abort during shutdown','runtime':'Microsoft.NETCore.App10','binary_sha256':sha(root/'DMPServer.dll')}
    elif game=='lmp':
        version=env.get('LMP_VERSION','') or '0.29.2'
        if not re.fullmatch('[A-Za-z0-9][A-Za-z0-9_.-]{0,19}',version):raise ValueError('Choose an exact public LMP release tag')
        if version=='0.29.2':commit=LMP_COMMIT
        else:
            def api(path):
                with urllib.request.urlopen(urllib.request.Request('https://api.github.com/repos/LunaMultiplayer/LunaMultiplayer/'+path,headers={'User-Agent':'Voltra-public-server-installer'}),timeout=30) as reply:return json.load(reply)
            release=api('releases/tags/'+version)
            if release.get('draft') or release.get('tag_name')!=version:raise ValueError('Choose a published LMP release')
            ref=api('git/ref/tags/'+version)['object']
            if ref['type']=='tag':ref=api('git/tags/'+ref['sha'])['object']
            if ref['type']!='commit' or not re.fullmatch('[a-f0-9]{40}',ref['sha']):raise ValueError('Unresolvable public release commit')
            commit=ref['sha']
        source=private/'sources'/commit
        if not source.resolve().is_relative_to(root):raise ValueError('LMP source checkout escapes volume')
        buildenv={'PATH':os.environ['PATH'],'HOME':str(private/'build-home'),'DOTNET_CLI_HOME':str(private/'build-home'),'NUGET_PACKAGES':str(private/'nuget-packages'),'DOTNET_CLI_TELEMETRY_OPTOUT':'1','DOTNET_SKIP_FIRST_TIME_EXPERIENCE':'1','DOTNET_NOLOGO':'1','DOTNET_GCHeapHardLimit':'0x10000000','GIT_TERMINAL_PROMPT':'0','LANG':'C.UTF-8'}
        source.parent.mkdir(parents=True,exist_ok=True)
        owned_git_environment(buildenv,[source])
        if not source.exists():
            subprocess.run(['git','clone','--filter=blob:none','--depth','1','--branch',version,'--sparse','https://github.com/LunaMultiplayer/LunaMultiplayer.git',str(source)],check=True,env=buildenv)
        subprocess.run(['git','-C',str(source),'sparse-checkout','set','Server','LmpCommon','LmpGlobal','Lidgren','Lidgren.Core','LmpUpdater','uhttpsharp'],check=True,env=buildenv)
        actual=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],env=buildenv,text=True).strip()
        if actual!=commit:raise ValueError('Official LMP tag moved; source commit pin mismatch')
        # Reinstalls reuse only our previously patched exact source checkout.
        marker=source/'voltra-net10-patch.json'
        patch_source(source)
        changed=subprocess.check_output(['git','-C',str(source),'diff','--name-only'],env=buildenv,text=True).splitlines()
        marker.write_text(json.dumps(changed))
        nuget=private/'nuget.config';nuget.write_text('<configuration><packageSources><clear/><add key="nuget.org" value="https://api.nuget.org/v3/index.json"/></packageSources></configuration>')
        output=private/'build-output'/commit
        if not output.resolve().is_relative_to(root):raise ValueError('LMP build output escapes volume')
        subprocess.run(['dotnet','publish',str(source/'Server/Server.csproj'),'-c','Release','--self-contained','false','-o',str(output),'-m:1','-p:UseSharedCompilation=false','--configfile',str(nuget)],env=buildenv,check=True)
        target=root/'LMPServer'
        if not target.resolve().is_relative_to(root):raise ValueError('LMP output escapes server volume')
        target.mkdir(exist_ok=True)
        for path in output.rglob('*'):
            if path.is_file():
                destination=target/path.relative_to(output)
                if not destination.resolve().is_relative_to(root):raise ValueError('Published LMP file escapes volume')
                if destination.exists() and (path.relative_to(output).parts[0] in ('Config','Universe','Plugins','Backups','Logs') or path.name=='LMPModControl.txt'):continue
                destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,destination)
        (private/'lmp-source.patch').write_bytes(subprocess.check_output(['git','-C',str(source),'diff','--','*.csproj','Server/Utilities/DotNetRuntimeChecker.cs','uhttpsharp/HttpClient.cs','Server/MainServer.cs'],env=buildenv))
        receipt={'game':game,'version':version,'source_commit':commit,'source_repository':'https://github.com/LunaMultiplayer/LunaMultiplayer','modified_binary':True,'patch':'Retarget server/dependencies net5/net6 to net10; runtime guard10; ProDotNetZip1.19.0 replaces DotNetZip1.15.0; Newtonsoft.Json13.0.4; log4net3.3.0; remove obsolete Framework serialization copy target; HTTP status response uses RFC CRLF headers; CancelKeyPress suppresses default SIGINT after native shutdown','changed_source_files':changed,'runtime':'Microsoft.NETCore.App10','binary_sha256':sha(target/'Server.dll')}
    else:raise ValueError('Unknown KSP family')
    (private/(game+'-release.json')).write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt));return receipt
if __name__=='__main__':install(Path.cwd(),sys.argv[1],dict(os.environ))
