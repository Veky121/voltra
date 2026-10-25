// MIT. Linux-only offline ownership fixtures; no Steam authentication or network.
using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
namespace Voltra.SteamPrivate;

internal static class RuntimeOwnershipTests
{
    [DllImport("libc", SetLastError = true)] private static extern int chown(string path, uint uid, uint gid);
    [DllImport("libc", SetLastError = true)] private static extern int open(string path, int flags);
    [DllImport("libc")] private static extern int close(int fd);
    [DllImport("libc")] private static extern uint geteuid();
    [DllImport("libc", SetLastError = true)] private static extern int link(string oldPath, string newPath);
    private static void Check(bool ok, string label) { if (!ok) throw new InvalidOperationException("ownership fixture: " + label); }
    private static void Reject(Action action) { try { action(); } catch (WorkerError) { return; } throw new InvalidOperationException("ownership rejection missing"); }
    private static readonly PublicationScope Base = new(new('a',64),new('b',64),new('c',64),new('d',64),new('e',64));
    private static readonly DepotRequest Depot = new(42,43,44,"public");
    private static readonly ContentSelection Selection = new(42,"public","linux","64","english",new HashSet<uint>());
    private sealed class Fixture : IDisposable
    {
        internal readonly string Root = Path.Combine(Path.GetTempPath(),"voltra-owner-fixture-"+Guid.NewGuid().ToString("N"));
        internal readonly PrivateDirectory Target, Work, Cache;
        internal Fixture()
        {
            if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
            Directory.CreateDirectory(Root, (UnixFileMode)0x1c9); // Traverse only for the alternate-UID child.
            foreach(var name in new[]{"target","work","cache"}) Directory.CreateDirectory(Root+"/"+name,(UnixFileMode)0x1c0);
            Check(chown(Root+"/target",988,988)==0,"fixture target root chown");
            Target=Open(Root+"/target",false); Work=Open(Root+"/work",true); Cache=Open(Root+"/cache",true);
        }
        public void Dispose(){ Target.Dispose();Work.Dispose();Cache.Dispose();Directory.Delete(Root,true); }
    }
    private static PrivateDirectory Open(string path,bool privateModes)
    {var fd=open(path,0xb0000);Check(fd>=0,"fixture root FD");try{return new(fd,privateModes);}finally{close(fd);}}
    private static (StagedPublication Publisher,VerifiedFile File) Stage(Fixture f,char nonce,string payload="publisher payload")
    {
        var p=new StagedPublication(f.Target,f.Work,Base with { Nonce=new(nonce,64) },["config","saves",".voltra"],AccessProofKind.Fixture);p.Admit();
        var bytes=System.Text.Encoding.UTF8.GetBytes(payload);
        using(var stream=p.CreateStage(new(){FileName="bin/server"}).GetAwaiter().GetResult()){stream.Write(bytes);stream.Flush();}
        p.StageLinks([new("bin/current","server",0x1ff,0,0)]);
        return(p,new("bin/server",Convert.ToHexString(SHA1.HashData(bytes)).ToLowerInvariant(),Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),bytes.Length,nonce=='1'?0x1c0u:0x180u));
    }
    private static PrivateReceipt Publish(Fixture f,char nonce,PrivateReceipt? previous=null,Action<int>? fault=null)
    {
        var staged=Stage(f,nonce,nonce=='1'?"original publisher bytes":"updated publisher bytes");
        return staged.Publisher.Publish(Depot,55,"linux","64","english",[staged.File],previous,fault,
            directories:["empty"],links:[new("bin/current","server",0x1ff,0,0)]);
    }
    private static void Validate(Fixture f,PrivateReceipt receipt)
    {var reference=ParentReceiptBoundary.Reference(f.Work,receipt);_=ParentReceiptBoundary.Validate(f.Work,f.Target,reference,receipt.Scope,Selection,expectedProof:AccessProofKind.Fixture);}
    internal static Task Run()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        Check(geteuid()==0,"actual Linux root required, never skip");
        using(var f=new Fixture())
        {
            Check(f.Target.OwnerUid==988&&f.Target.OwnerGid==988&&f.Work.OwnerUid==0&&f.Cache.OwnerUid==0,"FD-derived target vs worker-private roots");
            Directory.CreateDirectory(f.Root+"/target/config",(UnixFileMode)0x1c0);Check(chown(f.Root+"/target/config",988,988)==0,"operator directory");
            File.WriteAllText(f.Root+"/target/config/operator","operator untouched");File.SetUnixFileMode(f.Root+"/target/config/operator",(UnixFileMode)0x180);Check(chown(f.Root+"/target/config/operator",988,988)==0,"operator file");
            Directory.CreateDirectory(f.Root+"/target/.voltra",(UnixFileMode)0x1ed);
            for(var helper=0;helper<5;helper++){File.WriteAllText(f.Root+"/target/.voltra/helper"+helper,"protected helper");File.SetUnixFileMode(f.Root+"/target/.voltra/helper"+helper,(UnixFileMode)0x1a4);}
            var first=Publish(f,'1'); Validate(f,first);
            Check(first.Files.All(x=>x.Uid==988&&x.Gid==988&&x.Mode==0x1c0)&&first.Directories!.All(x=>x.Uid==988&&x.Gid==988)&&first.Links!.All(x=>x.Uid==988&&x.Gid==988),"final receipt owns actual files directories links");
            using(var child=Process.Start(new ProcessStartInfo("/usr/bin/setpriv"){ArgumentList={"--reuid=988","--regid=988","--clear-groups","/bin/sh","-c","test -r \"$1/bin/current\" && test -x \"$1/bin/server\" && test -d \"$1/empty\" && ! test -r \"$2\" && ! test -r \"$3\"","fixture",f.Root+"/target",f.Root+"/work",f.Root+"/cache"},UseShellExecute=false})!)
            {Check(child.WaitForExit(10000)&&child.ExitCode==0,"actual UID988 runtime access; Work/Cache inaccessible");}
            var second=Publish(f,'2',first);Validate(f,second);
            Check(!first.Files.Any(x=>x.Path.StartsWith(".voltra/",StringComparison.Ordinal))&&!first.Directories!.Any(x=>x.Path==".voltra"),"mixed-owner helper subtree outside inventory");
            for(var helper=0;helper<5;helper++)
            {
                using var file=File.OpenRead(f.Root+"/target/.voltra/helper"+helper);
                Check(PrivateDirectory.Identity(file)==(16UL,0x1a4u,0u,0u)&&File.ReadAllText(f.Root+"/target/.voltra/helper"+helper)=="protected helper","root-owned0644 helper untouched");
            }
            using(var child=Process.Start(new ProcessStartInfo("/usr/bin/setpriv"){ArgumentList={"--reuid=988","--regid=988","--clear-groups","/bin/sh","-c","test -r \"$1/.voltra/helper0\" && test -r \"$1/.voltra/helper4\"","fixture",f.Root+"/target"},UseShellExecute=false})!)
            {Check(child.WaitForExit(10000)&&child.ExitCode==0,"UID988 reads root-owned0644 protected helpers");}
            Check(second.Files.Single().Mode==0x1c0,"previous reviewed executable mode preserved over new default0600");
            var executable=Stage(f,'3',"#!/bin/sh\nexit 37\n");
            var third=executable.Publisher.Publish(Depot,55,"linux","64","english",[executable.File],second,links:[new("bin/current","server",0x1ff,0,0)]);Validate(f,third);
            using(var child=Process.Start(new ProcessStartInfo("/usr/bin/setpriv"){ArgumentList={"--reuid=988","--regid=988","--clear-groups",f.Root+"/target/bin/current"},UseShellExecute=false})!)
            {Check(child.WaitForExit(10000)&&child.ExitCode==37,"actual UID988 exec through publisher symlink raw37");}
            using(var operatorFile=f.Target.ReadFile("config/operator")!)Check(PrivateDirectory.Identity(operatorFile)==(18UL,0x180u,988u,988u),"operator ownership/mode unchanged");
            Check(File.ReadAllText(f.Root+"/target/config/operator")=="operator untouched"&&File.GetUnixFileMode(f.Root+"/target/config/operator")== (UnixFileMode)0x180,"protected operator state unchanged");
            Reject(()=>Open(f.Root+"/target",true).Dispose()); // Worker-private roots cannot inherit target ownership.
            Check(chown(f.Root+"/target",987,987)==0,"root identity mutation fixture");Reject(()=>f.Target.ReadFile("bin/server")?.Dispose());
        }
        for(var fault=1;fault<=4;fault++)
        {
            using var f=new Fixture();var first=Publish(f,'1');var point=fault;
            try{Publish(f,'2',first,n=>{if(n==point)throw new IOException("injected ownership publication interruption");});throw new InvalidOperationException("fault point missing");}catch(IOException){}
            Validate(f,first);Check(File.ReadAllText(f.Root+"/target/bin/server")=="original publisher bytes","rollback bytes/owner/mode/link");
            new StagedPublication(f.Target,f.Work,Base with {Nonce=new('2',64)},["config","saves",".voltra"],AccessProofKind.Fixture).Recover();Validate(f,first);
        }
        for(var fault=1;fault<=4;fault++)
        {
            // Reuse the real child-process interruption fixture with an actual
            // alternate-owned target and fresh descriptor capture in this process.
            using var f=new StorageTests.Fixture();Check(chown(f.Root+"/target",988,988)==0,"crash target owner");
            using var target=Open(f.Root+"/target",false);
            var start=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false};
            if(Path.GetFileNameWithoutExtension(Environment.ProcessPath!)=="dotnet")start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
            foreach(var value in new[]{"--crash-fixture",f.Root,fault.ToString(System.Globalization.CultureInfo.InvariantCulture)})start.ArgumentList.Add(value);
            using var child=Process.Start(start)!;
            if(!child.WaitForExit(15000)){child.Kill(true);throw new InvalidOperationException("ownership crash child timeout");}
            Check(child.ExitCode==71,"actual alternate-owner child interruption");
            using var file=f.Work.ReadFile(new string('a',64)+"/"+new string('b',64)+"/"+new string('1',64)+"/receipt.json")!;
            var prior=JsonSerializer.Deserialize<PrivateReceipt>(file,ParentReceiptBoundary.Json)!;
            var recovery=new StagedPublication(target,f.Work,prior.Scope with {Nonce=new('2',64)},["saves","mods","config"],AccessProofKind.Fixture);
            recovery.Recover();recovery.Recover();
            var reference=ParentReceiptBoundary.Reference(f.Work,prior);
            _=ParentReceiptBoundary.Validate(f.Work,target,reference,prior.Scope,new(42,"preview","linux","64","english",new HashSet<uint>()),expectedProof:AccessProofKind.Fixture);
            Check(prior.Files.Count==2&&prior.Files.All(x=>x.Uid==988&&x.Gid==988),"crash recovery final receipt ownership");
        }
        using(var f=new Fixture())
        {
            f.Target.FailDirectorySync=()=>true;Reject(()=>Publish(f,'1'));f.Target.FailDirectorySync=null;
            Check(!Directory.Exists(f.Root+"/target/bin")&&!Directory.Exists(f.Root+"/target/empty"),"directory ownership durable before target visibility");
        }
        using(var f=new Fixture())
        {
            Directory.CreateDirectory(f.Root+"/target/bin",(UnixFileMode)0x1c0);Check(chown(f.Root+"/target/bin",988,988)==0,"fixture parent");
            File.WriteAllText(f.Root+"/outside","external");Check(chown(f.Root+"/outside",988,988)==0,"fixture external");
            Check(link(f.Root+"/outside",f.Root+"/target/bin/server")==0,"actual hardlink");Reject(()=>Publish(f,'1'));
            Check(File.ReadAllText(f.Root+"/outside")=="external","hardlinked operator unchanged");
        }
        using(var f=new Fixture())
        {
            Directory.CreateSymbolicLink(f.Root+"/target/bin",f.Root+"/work");Reject(()=>Publish(f,'1'));
            Check(!File.Exists(f.Root+"/work/server"),"symlink parent confinement");
        }
        Console.WriteLine("runtime ownership: root worker -> FD-owned UID988 publication, receipt, update, rollback, link and confinement fixtures PASS");
        return Task.CompletedTask;
    }
}
