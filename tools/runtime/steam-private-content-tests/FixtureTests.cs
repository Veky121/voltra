// MIT. Actual frozen coordinator/storage/validator with deterministic offline bytes.
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using SteamKit2.Authentication;
namespace Voltra.SteamPrivate;

internal static class FixtureTests
{
    private static readonly List<string> Passed = [];
    private static readonly EntitledPlan Multi = new(42, 99, [new(42, 43, 1, "preview"), new(42, 44, 2, "preview")], 1);
    private static readonly ContentSelection Selected = new(42, "preview", "linux", "64", "english", new HashSet<uint>());
    private static readonly byte[] Old = "original fixture publisher bytes"u8.ToArray(), Updated = "updated fixture publisher bytes"u8.ToArray();
    private static PublicationScope Scope(char nonce) => new(new('a', 64), new('b', 64), new('c', 64), new(nonce, 64), new('d', 64));
    private static void Check(bool value, string name) { if (!value) throw new InvalidOperationException("fixture assertion: " + name); }
    private static void Error(Action action, string code)
    { try { action(); throw new InvalidOperationException("expected fixed error: " + code); } catch (WorkerError e) { Check(e.Code == code, code + " actual " + e.Code); } }
    private static async Task Error(Func<Task> action, string code)
    { try { await action(); throw new InvalidOperationException("expected fixed error: " + code); } catch (WorkerError e) { Check(e.Code == code, code + " actual " + e.Code); } }
    private sealed class Guard : IAuthenticator
    {
        public Task<string> GetDeviceCodeAsync(bool previous) => Task.FromResult("fixture-code");
        public Task<string> GetEmailCodeAsync(string email, bool previous) => throw new NotSupportedException();
        public Task<bool> AcceptDeviceConfirmationAsync() => throw new NotSupportedException();
    }
    private static PrivateRequest Request(StorageTests.Fixture f, char nonce = '1') => new("private_content", "fixture-account", "fixture-password", null, "preview", null, 42, true,
        new(Scope(nonce), f.Target.Descriptor, f.Work.Descriptor, f.Cache.Descriptor, "linux", "64", "english", [], [], 1048576UL, 4096UL, 1048576UL, 30));
    private static PrivateRequest Validation(PrivateRequest request, ReceiptReference reference) => request with
    { Operation = "validate_private_receipt", Username = null, Password = null, Guard = null, Content = request.Content! with { Previous = null, ValidationReceipt = reference, ExpectedPublisherPlan = reference.PublisherPlan } };
    private static StagedPublication Publisher(PrivateDirectory target, PrivateDirectory work, char nonce)
    { var p = new StagedPublication(target, work, Scope(nonce), ["saves", "config", "mods"], AccessProofKind.Fixture); p.Admit(); return p; }
    private static Task<PrivateReceipt> Publish(PrivateDirectory target, PrivateDirectory work, char nonce, byte[] bytes, PrivateReceipt? previous = null, Action<int>? mutation = null, bool corruptSecond = false)
        => GameContentCoordinator.Run(Multi, Selected, depot => new GameContentTests.Transport(depot, depot.Depot == 43 ? "bin/server" : "data/shared", bytes, corruptSecond && depot.Depot == 44),
            Publisher(target, work, nonce), 1048576, 4096, previous, default, mutation);
    private static void NoReceipt(StorageTests.Fixture f, PublicationScope scope)
        => Check(!File.Exists(Path.Combine(f.Root, "work", scope.Server, scope.Owner, scope.Nonce, "receipt.json")), "no committed receipt");
    private static PrivateReceipt Validate(StorageTests.Fixture f, ReceiptReference reference, ContentSelection? selection = null)
        => ParentReceiptBoundary.Validate(f.Work, f.Target, reference, reference.Scope, selection ?? Selected, expectedProof: AccessProofKind.Fixture);

    internal static async Task Run()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        await RuntimeOwnershipTests.Run(); Passed.Add("fd-derived-runtime-owner-988-private-work-cache-update-rollback-confinement");
        await Success(); Passed.Add("real-files-private-cache-fixture-receipt-independent-validator-production-rejection");
        await ScopeReplayTamper(); Passed.Add("scope-owner-nonce-selection-replay-file-and-receipt-tamper");
        await PreviousGeneration(); Passed.Add("fixture-composition-two-generations-prior-scope-and-operator-preflight");
        await UnchangedOperationNegatives(); Passed.Add("unchanged-contentoperation-negative-no-commit-before-or-after-session");
        await StageAndRollback(); Passed.Add("second-depot-corruption-stage-all-before-publish-and-four-mutation-rollback");
        await CrashRecovery(); Passed.Add("four-actual-child-process-interruptions-durable-recovery-idempotence");
        await CommitBoundaries(); Passed.Add("five-receipt-commit-boundaries-and-directory-fsync-uncertainty");
        SameFilesystem(); Passed.Add("real-different-device-publication-rejection");
        Console.WriteLine(JsonSerializer.Serialize(new { provider = AccessProof.FixtureProvider, passed = Passed, entitlement_verified = false, account_entitlement_verified = false,
            anonymous_access_verified = false, native_acceptance_verified = false, network_used = false }));
    }
    private static async Task Success()
    {
        using var f = new StorageTests.Fixture(); var request = Request(f); var guard = new Guard(); var session = new FixtureSession(guard);
        var reference = await FixtureComposition.Run(request, guard, [200, 201, 202], () => session, default);
        Check(session.Disposed, "session disposed"); var receipt = Validate(f, reference);
        Check(receipt.Provider == AccessProof.FixtureProvider && !receipt.EntitlementVerified && !receipt.AccountEntitlementVerified && !receipt.AnonymousAccessVerified
            && receipt.PublicationCommitted && !receipt.NativeAcceptanceVerified, "honest persisted flags");
        Check(File.ReadAllText(f.Root + "/target/bin/server") == "offline real coordinator payload", "actual publisher file");
        Check(FixtureComposition.ValidateReceipt(Validation(request, reference), [200, 201, 202]) == reference, "credential-free validator");
        Error(() => ContentOperation.ValidateReceipt(Validation(request, reference), [200, 201, 202]), "invalid_provider_receipt");
        Error(() => ParentReceiptBoundary.Validate(f.Work, f.Target, reference, reference.Scope, Selected), "invalid_provider_receipt");
        Error(() => PublicationPolicy.Validate(new(receipt.Provider, receipt.App, receipt.Build.Value,
            [new(43, ulong.MaxValue, "preview", "linux")], [new("bin/server", receipt.Files[0].Sha1, receipt.Files[0].Sha256, (long)receipt.Files[0].Bytes.Value)],
            true, true, false)), "incomplete_provider_receipt"); // Reject provider even with forged positive entitlement.
        foreach (var file in Directory.GetFiles(f.Root, "*", SearchOption.AllDirectories))
            Check(!file.Contains("fixture-password") && !File.ReadAllText(file).Contains("fixture-password"), "no credential in target/work/cache or filename");
    }
    private static async Task PreviousGeneration()
    {
        using var f = new StorageTests.Fixture(); var guard = new Guard(); var first = Request(f);
        var initial = await FixtureComposition.Run(first,guard,[200,201,202],()=>new FixtureSession(guard),default);
        var request = Request(f,'2') with { Content = Request(f,'2').Content! with { Previous = initial } };
        var session = new FixtureSession(guard,payload:Updated);
        var updated = await FixtureComposition.Run(request,guard,[200,201,202],()=>session,default);
        Check(session.Disposed && updated.Scope.Nonce != initial.Scope.Nonce && File.ReadAllBytes(f.Root+"/target/bin/server").SequenceEqual(Updated),"real prior-owned replacement");
        _=Validate(f,updated); var created=false;
        var wrong = Request(f,'3') with { Content=Request(f,'3').Content! with { Previous=updated with { Scope=updated.Scope with { Owner=new('e',64) } } } };
        await Error(async()=>{_=await FixtureComposition.Run(wrong,guard,[200,201,202],()=>{created=true;return new FixtureSession(guard);},default);},"prior_receipt_scope_mismatch");
        Check(!created,"wrong prior owner before injected session");NoReceipt(f,Scope('3'));
        var bytes=(byte[])Updated.Clone();bytes[0]^=1;File.WriteAllBytes(f.Root+"/target/bin/server",bytes);
        var modified=Request(f,'4')with{Content=Request(f,'4').Content!with{Previous=updated}};
        await Error(async()=>{_=await FixtureComposition.Run(modified,guard,[200,201,202],()=>{created=true;return new FixtureSession(guard);},default);},"receipt_file_hash_mismatch");
        Check(!created&&File.ReadAllBytes(f.Root+"/target/bin/server").SequenceEqual(bytes),"operator edit preserved before session");NoReceipt(f,Scope('4'));
    }
    private static async Task ScopeReplayTamper()
    {
        using var f = new StorageTests.Fixture(); var request = Request(f); var guard = new Guard();
        var reference = await FixtureComposition.Run(request, guard, [200, 201, 202], () => new FixtureSession(guard), default);
        foreach (var scope in new[] { reference.Scope with { Owner = new('e',64) }, reference.Scope with { Nonce = new('e',64) }, reference.Scope with { RequestDigest = new('e',64) } })
            Error(() => ParentReceiptBoundary.Validate(f.Work, f.Target, reference, scope, Selected, expectedProof: AccessProofKind.Fixture), "receipt_scope_mismatch");
        Error(() => Validate(f, reference, Selected with { Language = "german" }), "invalid_provider_receipt");
        var made = false;
        await Error(async () => { _ = await FixtureComposition.Run(request, guard, [200,201,202], () => { made=true; return new FixtureSession(guard); }, default); }, "storage_create_conflict");
        Check(!made, "replay before session");
        var path = f.Root + "/target/bin/server"; var bytes = File.ReadAllBytes(path); var changed = (byte[])bytes.Clone(); changed[0] ^= 1; File.WriteAllBytes(path, changed);
        Error(() => Validate(f, reference), "receipt_file_hash_mismatch"); File.WriteAllBytes(path, bytes);
        var receiptPath = f.Root + "/work/" + reference.Path; var original = File.ReadAllBytes(receiptPath); File.AppendAllText(receiptPath, " ");
        Error(() => Validate(f, reference), "receipt_digest_mismatch"); File.WriteAllBytes(receiptPath, original); _ = Validate(f, reference);
    }
    private static async Task UnchangedOperationNegatives()
    {
        using (var f = new StorageTests.Fixture())
        {
            var request = Request(f); var made = false;
            await Error(async () => { _ = await ContentOperation.Run(request with { Content = request.Content! with { Scope = Scope('1') with { Owner = "bad" } } }, new Guard(), [200,201,202], () => { made=true; return new FixtureSession(new Guard()); }, default); }, "invalid_publication_scope");
            Check(!made, "invalid scope before session");
            await Error(async () => { _ = await ContentOperation.Run(request with { Content = request.Content! with { WorkFd = f.Target.Descriptor } }, new Guard(), [200,201,202], () => { made=true; return new FixtureSession(new Guard()); }, default); }, "invalid_storage_descriptor");
            Check(!made, "descriptor conflict before session");
        }
        using (var f = new StorageTests.Fixture())
        {
            var request=Request(f); var session=new FixtureSession(new Guard(), corrupt:true);
            await Error(async () => { _=await ContentOperation.Run(request,new Guard(),[200,201,202],()=>session,default); },"chunk_hash_mismatch");
            Check(session.Disposed && !File.Exists(f.Root+"/target/bin/server"),"corruption no publication");NoReceipt(f,request.Content!.Scope);
        }
        using (var f = new StorageTests.Fixture())
        {
            Directory.CreateDirectory(f.Root+"/target/bin");File.WriteAllText(f.Root+"/target/bin/server","operator");var request=Request(f);
            await Error(async () => { _=await ContentOperation.Run(request,new Guard(),[200,201,202],()=>new FixtureSession(new Guard()),default); },"operator_file_conflict");
            Check(File.ReadAllText(f.Root+"/target/bin/server")=="operator","operator unchanged");NoReceipt(f,request.Content!.Scope);
        }
    }
    private static async Task StageAndRollback()
    {
        using(var f=new StorageTests.Fixture())
        {
            await Error(async()=>{_=await Publish(f.Target,f.Work,'1',Old,corruptSecond:true);},"chunk_hash_mismatch");
            Check(!File.Exists(f.Root+"/target/bin/server")&&!File.Exists(f.Root+"/target/data/shared"),"stage all before any publish");NoReceipt(f,Scope('1'));
        }
        for(var fault=1;fault<=4;fault++)
        {
            using var f=new StorageTests.Fixture();var prior=await Publish(f.Target,f.Work,'1',Old);var point=fault;
            await Error(async()=>{_=await Publish(f.Target,f.Work,'2',Updated,prior,n=>{if(n==point)throw new IOException("fixture mutation failure");});},"game_content_failed");
            Check(File.ReadAllBytes(f.Root+"/target/bin/server").SequenceEqual(Old)&&File.ReadAllBytes(f.Root+"/target/data/shared").SequenceEqual(Old),"whole-game rollback");NoReceipt(f,Scope('2'));
            _=Validate(f,ParentReceiptBoundary.Reference(f.Work,prior));
        }
    }
    [DllImport("libc", SetLastError=true)]private static extern int open(string path,int flags);
    [DllImport("libc")]private static extern int close(int fd);
    private static PrivateDirectory Open(string path,bool privateModes=true)
    {var fd=open(path,0xb0000);if(fd<0)throw new InvalidOperationException("fixture open");try{return new(fd,privateModes);}finally{_=close(fd);}}
    internal static async Task<int> CrashChild(string root,int fault)
    {
        if(!OperatingSystem.IsLinux()||!Path.GetFullPath(root).StartsWith(Path.GetTempPath()+"voltra-content-fixture-",StringComparison.Ordinal)||fault is <1 or >4)return 2;
        using var target=Open(root+"/target",false);using var work=Open(root+"/work");
        var prior=await Publish(target,work,'1',Old);
        _=await Publish(target,work,'2',Updated,prior,n=>{if(n==fault)Environment.Exit(71);});return 72;
    }
    private static async Task CrashRecovery()
    {
        for(var fault=1;fault<=4;fault++)
        {
            using var f=new StorageTests.Fixture();var start=new ProcessStartInfo(Environment.ProcessPath!){RedirectStandardOutput=true,RedirectStandardError=true,UseShellExecute=false};
            if(Path.GetFileNameWithoutExtension(Environment.ProcessPath!)=="dotnet")start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
            foreach(var value in new[]{"--crash-fixture",f.Root,fault.ToString(System.Globalization.CultureInfo.InvariantCulture)})start.ArgumentList.Add(value);
            using var child=Process.Start(start)??throw new InvalidOperationException("fixture child");
            using var deadline=new CancellationTokenSource(TimeSpan.FromSeconds(30));
            try{await child.WaitForExitAsync(deadline.Token);}catch{child.Kill(entireProcessTree:true);throw;}
            Check(child.ExitCode==71,"actual interruption point");
            var publisher=new StagedPublication(f.Target,f.Work,Scope('2'),["saves","mods","config"],AccessProofKind.Fixture);publisher.Recover();publisher.Recover();
            Check(File.ReadAllBytes(f.Root+"/target/bin/server").SequenceEqual(Old)&&File.ReadAllBytes(f.Root+"/target/data/shared").SequenceEqual(Old),"fresh process durable recovery");NoReceipt(f,Scope('2'));
        }
    }
    private static VerifiedFile Verified(byte[] bytes)=>new("bin/server",Convert.ToHexString(SHA1.HashData(bytes)).ToLowerInvariant(),Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),bytes.Length);
    private static StagedPublication Stage(StorageTests.Fixture f)
    {var p=Publisher(f.Target,f.Work,'1');using var stream=p.CreateStage(new(){FileName="bin/server"}).GetAwaiter().GetResult();stream.Write(Old);stream.Flush();return p;}
    private static Task CommitBoundaries()
    {
        foreach(var point in new[]{"before_write","after_write","after_flush","before_rename","after_rename"})
        {
            using var f=new StorageTests.Fixture();var p=Stage(f);PrivateReceipt? receipt=null;
            try{receipt=p.Publish(Multi.Depots[0],99,"linux","64","english",[Verified(Old)],null,receiptCheckpoint:step=>{if(step==point)throw new IOException("fixture receipt interruption");});}catch(IOException){}
            if(point=="after_rename"){Check(receipt is not null,"durable renamed commit");_=Validate(f,ParentReceiptBoundary.Reference(f.Work,receipt!));}
            else{Check(receipt is null&&!File.Exists(f.Root+"/target/bin/server"),"no partial commit");NoReceipt(f,Scope('1'));}
            p.Recover();
        }
        using(var f=new StorageTests.Fixture())
        {
            var p=Stage(f);Error(()=>p.Publish(Multi.Depots[0],99,"linux","64","english",[Verified(Old)],null,receiptCheckpoint:step=>{if(step=="after_rename_before_sync")f.Work.FailDirectorySync=()=>true;}),"publication_commit_uncertain");
            f.Work.FailDirectorySync=null;p.Recover();
            using var file=f.Work.ReadFile(p.Prefix+"/receipt.json")!;var receipt=JsonSerializer.Deserialize<PrivateReceipt>(file,ParentReceiptBoundary.Json)!;_=Validate(f,ParentReceiptBoundary.Reference(f.Work,receipt));
        }
        return Task.CompletedTask;
    }
    private static void SameFilesystem()
    {
        if(!OperatingSystem.IsLinux())throw new WorkerError("descriptor_storage_unsupported");
        using var f=new StorageTests.Fixture();var external="/dev/shm/voltra-fixture-"+Guid.NewGuid().ToString("N");Directory.CreateDirectory(external,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);
        try{using var work=Open(external);Check(work.Device!=f.Target.Device,"actual distinct devices");Error(()=>new StagedPublication(f.Target,work,Scope('1'),[],AccessProofKind.Fixture),"publication_filesystem_mismatch");}
        finally{Directory.Delete(external);}
    }
}
