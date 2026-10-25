// MIT. Offline TEST assembly. No SteamClient construction or network transport.
using SteamKit2.Authentication;
namespace Voltra.SteamPrivate;

internal sealed class FixtureSession(IAuthenticator guard, bool corrupt = false, byte[]? payload = null) : IContentSession
{
    private bool authenticated;
    internal bool Disposed;
    public Task Connect(CancellationToken cancellation) { cancellation.ThrowIfCancellationRequested(); return Task.CompletedTask; }
    public async Task Authenticate(AuthSessionDetails details, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (details.Username != "fixture-account" || details.Password != "fixture-password") throw new WorkerError("fixture_credentials_required");
        if (await guard.GetDeviceCodeAsync(false) != "fixture-code") throw new WorkerError("fixture_guard_rejected");
        authenticated = true;
    }
    public Task<bool> CheckBeta(uint app, string password, string branch, CancellationToken cancellation) => throw new NotSupportedException();
    public Task<EntitledPlan> ReadEntitledPlan(ContentSelection selection, CancellationToken cancellation, string? betaPassword)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!authenticated || selection.App != 42 || selection.Branch != "preview" || selection.Platform != "linux"
            || selection.Architecture != "64" || selection.Language != "english" || selection.DlcApps.Count != 0 || betaPassword is not null)
            throw new WorkerError("fixture_selection_required");
        return Task.FromResult(FixtureComposition.Plan);
    }
    public IDepotTransport CreateDepotTransport(EntitledPlan plan, DepotRequest request)
        => new GameContentTests.Transport(request, "bin/server", payload ?? "offline real coordinator payload"u8.ToArray(), corrupt);
    public ValueTask DisposeAsync() { Disposed = true; return ValueTask.CompletedTask; }
}

internal static class FixtureComposition
{
    internal static readonly EntitledPlan Plan = new(42, ulong.MaxValue, [new(42, 43, ulong.MaxValue, "preview")], 1);
    internal static ContentSelection Selection(PrivateRequest request)
        => new(request.AppId, request.Branch, request.Content!.Platform, request.Content.Architecture, request.Content.Language, request.Content.DlcApps.ToHashSet());
    // Explicit TEST composition: unchanged ContentOperation.Run hardcodes PrivateAccount.
    internal static async Task<ReceiptReference> Run(PrivateRequest request, IAuthenticator guard, IReadOnlyList<int> descriptors,
        Func<IContentSession> factory, CancellationToken cancellation)
    {
        ContentOperation.Validate(request, descriptors);
        if (request.Operation != "private_content") throw new WorkerError("invalid_operation");
        var job = request.Content!;
        using var target = new PrivateDirectory(job.TargetFd, privateModes: false);
        using var work = new PrivateDirectory(job.WorkFd);
        using var cache = new PrivateDirectory(job.CacheFd);
        if (new[] { (target.Device, target.Inode), (work.Device, work.Inode), (cache.Device, cache.Inode) }.Distinct().Count() != 3)
            throw new WorkerError("storage_roots_overlap");
        var selection = Selection(request);
        var publication = new StagedPublication(target, work, job.Scope, job.ProtectedRoots.Concat(["saves", "mods", "config"]), AccessProofKind.Fixture);
        publication.Admit();
        PrivateReceipt? previous = null;
        if (job.Previous is not null)
        {
            if (job.Previous.Scope.Server != job.Scope.Server || job.Previous.Scope.Owner != job.Scope.Owner || job.Previous.Scope.Nonce == job.Scope.Nonce)
                throw new WorkerError("prior_receipt_scope_mismatch");
            previous = ParentReceiptBoundary.Validate(work, target, job.Previous, job.Previous.Scope, selection, expectedProof: AccessProofKind.Fixture);
        }
        await using var session = factory();
        await session.Connect(cancellation);
        await session.Authenticate(TypedFields.Authentication(request, guard), cancellation);
        var plan = await session.ReadEntitledPlan(selection, cancellation, request.BetaPassword);
        cache.LockExclusive();
        try
        {
            var receipt = await GameContentCoordinator.Run(plan, selection,
                depot => new PrivateChunkCache(session.CreateDepotTransport(plan, depot), cache, job.Scope.Server, job.Scope.Owner, job.CacheQuota.Value, externallyLocked: true),
                publication, job.ContentBudget.Value, job.RollbackReserve.Value, previous, cancellation);
            var reference = ParentReceiptBoundary.Reference(work, receipt);
            _ = ParentReceiptBoundary.Validate(work, target, reference, job.Scope, selection, plan, expectedProof: AccessProofKind.Fixture);
            return reference;
        }
        finally { cache.Unlock(); }
    }
    internal static ReceiptReference ValidateReceipt(PrivateRequest request, IReadOnlyList<int> descriptors)
    {
        ContentOperation.Validate(request, descriptors);
        if (request.Operation != "validate_private_receipt") throw new WorkerError("invalid_operation");
        var job = request.Content!;
        using var target = new PrivateDirectory(job.TargetFd, privateModes: false);
        using var work = new PrivateDirectory(job.WorkFd);
        if ((target.Device, target.Inode) == (work.Device, work.Inode)) throw new WorkerError("storage_roots_overlap");
        target.LockExclusive();
        try
        {
            var expected = job.ExpectedPublisherPlan!;
            var plan = new EntitledPlan(expected.App, expected.Build.Value, expected.Depots.Select(d => new DepotRequest(d.PublisherApp, d.Depot, d.Manifest.Value, request.Branch)).ToArray(), 0);
            var receipt = ParentReceiptBoundary.Validate(work, target, job.ValidationReceipt!, job.Scope, Selection(request), plan, job.ContentBudget.Value, AccessProofKind.Fixture);
            var protectedPaths = job.ProtectedRoots.Concat(["saves", "mods", "config"]);
            if (receipt.Files.Select(f => f.Path).Any(path => protectedPaths.Any(p => path.Equals(p, StringComparison.OrdinalIgnoreCase) || path.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase))))
                throw new WorkerError("receipt_protected_path_mismatch");
            return job.ValidationReceipt!;
        }
        finally { target.Unlock(); }
    }
}

internal static class OfflineFixture
{
    public static async Task<int> Main(string[] args)
    {
        if (args.Length == 3 && args[0] == "--crash-fixture" && int.TryParse(args[2], out var fault)) return await FixtureTests.CrashChild(args[1], fault);
        if (args.SequenceEqual(["--self-test"])) { await FixtureTests.Run(); return 0; }
        if (args.Length != 6 || args[0] != "--request-fd" || args[2] != "--event-fd" || args[4] != "--reply-fd"
            || !int.TryParse(args[1], out var read) || !int.TryParse(args[3], out var write) || !int.TryParse(args[5], out var reply)) return 2;
        using var messages = new FdMessages(read, write);
        using var replies = new FdMessages(reply, write);
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        try
        {
            var input = await messages.ReceiveAsync<PrivateRequest>(deadline.Token);
            deadline.CancelAfter(TimeSpan.FromSeconds(input.Content?.DeadlineSeconds ?? 30));
            ReceiptReference reference;
            if (input.Operation == "validate_private_receipt") reference = FixtureComposition.ValidateReceipt(input, [read, write, reply]);
            else
            {
                var guard = new FdAuthenticator(replies, TimeSpan.FromSeconds(20), deadline.Token, input.Guard);
                reference = await FixtureComposition.Run(input, guard, [read, write, reply], () => new FixtureSession(guard), deadline.Token);
            }
            await messages.SendAsync(new { Type = "terminal", Status = input.Operation == "validate_private_receipt" ? "receipt_validated" : "publication_committed",
                Receipt = new { reference.Scope, reference.Path, reference.Sha256, reference.Files, reference.PublisherPlan,
                    Provider = AccessProof.FixtureProvider, FixtureProvider = AccessProof.FixtureProvider }, NativeAcceptanceVerified = false }, deadline.Token);
            return 0;
        }
        catch (WorkerError error) { await messages.SendAsync(new { Type = "terminal", Status = "error", Code = error.Code }, CancellationToken.None); return 3; }
        catch (OperationCanceledException) { await messages.SendAsync(new { Type = "terminal", Status = "error", Code = "cancelled" }, CancellationToken.None); return 3; }
        catch { await messages.SendAsync(new { Type = "terminal", Status = "error", Code = "fixture_failed" }, CancellationToken.None); return 3; }
    }
}
