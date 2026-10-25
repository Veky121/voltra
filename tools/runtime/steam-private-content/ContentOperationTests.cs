// MIT. Private request schema and real coordinator/receipt boundary, offline transport.
using System.Text.Json;
using SteamKit2.Authentication;

namespace Voltra.SteamPrivate;

internal static class ContentOperationTests
{
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("content operation fixture"); }
    private static readonly PublicationScope Scope = new(new('a', 64), new('b', 64), new('c', 64), new('1', 64), new('d', 64));
    private sealed class Session : IContentSession
    {
        internal bool Authenticated, Disposed;
        public Task Connect(CancellationToken cancellation) => Task.CompletedTask;
        public Task Authenticate(AuthSessionDetails details, CancellationToken cancellation) { Authenticated = true; return Task.CompletedTask; }
        public Task<bool> CheckBeta(uint app, string password, string branch, CancellationToken cancellation) => throw new NotSupportedException();
        public Task<EntitledPlan> ReadEntitledPlan(ContentSelection selection, CancellationToken cancellation, string? betaPassword)
        { Check(Authenticated); return Task.FromResult(new EntitledPlan(42, ulong.MaxValue, [new(42, 43, ulong.MaxValue, "preview")], 1)); }
        public IDepotTransport CreateDepotTransport(EntitledPlan plan, DepotRequest request)
            => new GameContentTests.Transport(request, "bin/server", "offline operation bytes"u8.ToArray());
        public ValueTask DisposeAsync() { Disposed = true; return ValueTask.CompletedTask; }
    }
    internal static async Task Run()
    {
        using var f = new StorageTests.Fixture();
        var job = new ContentJobRequest(Scope, f.Target.Descriptor, f.Work.Descriptor, f.Cache.Descriptor, "linux", "64", "english", [], [], 1048576UL, 4096UL, 1048576UL, 30);
        var request = new PrivateRequest("private_content", "fixture-account", "fixture-password", null, "preview", null, 42, true, job);
        var session = new Session();
        var reference = await ContentOperation.Run(request, new NullGuard(), [200, 201, 202], () => session, default);
        Check(session.Disposed && reference.Scope == Scope && reference.Files.Value == 1);
        var selection = new ContentSelection(42, "preview", "linux", "64", "english", new HashSet<uint>());
        var receipt = ParentReceiptBoundary.Validate(f.Work, f.Target, reference, Scope, selection);
        Check(receipt.Manifest.Value == ulong.MaxValue && receipt.Build.Value == ulong.MaxValue && !receipt.NativeAcceptanceVerified);
        var validation = request with { Operation = "validate_private_receipt", Username = null, Password = null,
            Content = job with { ValidationReceipt = reference, ExpectedPublisherPlan = reference.PublisherPlan } };
        Check(ContentOperation.ValidateReceipt(validation, [200, 201, 202]) == reference);
        try
        {
            ContentOperation.ValidateReceipt(validation with { Content = validation.Content! with {
                ExpectedPublisherPlan = reference.PublisherPlan! with { Build = 1UL } } }, [200, 201, 202]);
            throw new InvalidOperationException();
        }
        catch (WorkerError e) { Check(e.Code == "receipt_publisher_identity_mismatch"); }
        var json = JsonSerializer.Serialize(reference, ParentReceiptBoundary.Json);
        Check(json.Length < 2048 && !json.Contains("fixture-password") && json.Contains("\"files\":\"1\""));
        try { ParentReceiptBoundary.Validate(f.Work, f.Target, reference, Scope with { RequestDigest = new('e', 64) }, selection); throw new InvalidOperationException(); }
        catch (WorkerError e) { Check(e.Code == "receipt_scope_mismatch"); }
        File.WriteAllText(f.Root + "/target/bin/server", "operator changed");
        try { ParentReceiptBoundary.Validate(f.Work, f.Target, reference, Scope, selection); throw new InvalidOperationException(); }
        catch (WorkerError e) { Check(e.Code is "receipt_file_hash_mismatch" or "receipt_file_identity_mismatch"); }
        var created = false;
        try
        {
            await ContentOperation.Run(request with { Content = job with { TargetFd = 200 } }, new NullGuard(), [200, 201, 202], () => { created = true; return new Session(); }, default);
            throw new InvalidOperationException();
        }
        catch (WorkerError e) { Check(e.Code == "invalid_storage_descriptor" && !created); }
        try
        {
            await ContentOperation.Run(request, new NullGuard(), [200, 201, 202], () => { created = true; return new Session(); }, default);
            throw new InvalidOperationException();
        }
        catch (WorkerError e) { Check(e.Code == "storage_create_conflict" && !created); }
    }
    private sealed class NullGuard : IAuthenticator
    {
        public Task<string> GetDeviceCodeAsync(bool previousCodeWasIncorrect) => throw new NotSupportedException();
        public Task<string> GetEmailCodeAsync(string email, bool previousCodeWasIncorrect) => throw new NotSupportedException();
        public Task<bool> AcceptDeviceConfirmationAsync() => throw new NotSupportedException();
    }
}
