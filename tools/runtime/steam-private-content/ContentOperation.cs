// MIT. Opt-in private-FD operation in the standalone worker. No production caller.
using SteamKit2.Authentication;

namespace Voltra.SteamPrivate;

internal sealed record ContentJobRequest(PublicationScope Scope, int TargetFd, int WorkFd, int CacheFd,
    string Platform, string Architecture, string Language, IReadOnlyList<uint> DlcApps, IReadOnlyList<string> ProtectedRoots,
    MetadataUInt64 ContentBudget, MetadataUInt64 RollbackReserve, MetadataUInt64 CacheQuota, uint DeadlineSeconds,
    ReceiptReference? Previous = null, ReceiptReference? ValidationReceipt = null, ExpectedPublisherPlan? ExpectedPublisherPlan = null,
    string? MutablePolicyId = null, string? MutablePolicyDigest = null);

internal interface IContentSession : ISteamSession
{
    Task<EntitledPlan> ReadEntitledPlan(ContentSelection selection, CancellationToken cancellation, string? betaPassword = null);
    IDepotTransport CreateDepotTransport(EntitledPlan plan, DepotRequest request);
}

internal static class ContentOperation
{
    internal sealed record MutableRecoveryOutcome(ReceiptReference? Receipt, bool RolledBack);
    internal static bool IsMutable(PrivateRequest request) => request.Operation.EndsWith("_mutable_v1", StringComparison.Ordinal);
    private static string BaseOperation(PrivateRequest request) => IsMutable(request) ? request.Operation[..^11] : request.Operation;
    internal static void Validate(PrivateRequest request, IReadOnlyList<int> protocolDescriptors, MutablePolicy? expectedMutable = null)
    {
        TypedFields.Validate(request);
        var content = request.Content ?? throw new WorkerError("content_request_missing");
        if (BaseOperation(request) is not ("private_content" or "validate_private_receipt" or "recover_private_receipt") || content.Scope is null
            || content.DlcApps is null || content.ProtectedRoots is null || content.DeadlineSeconds is 0 or > 7200 || content.ContentBudget.Value == 0
            || content.CacheQuota.Value == 0 || content.Platform is not ("linux" or "windows") || content.Architecture is not ("32" or "64")
            || string.IsNullOrEmpty(content.Language) || content.Language.Length > 64 || content.Language.Any(char.IsControl)
            || content.DlcApps.Count > 128 || content.DlcApps.Any(a => a == 0) || content.DlcApps.Distinct().Count() != content.DlcApps.Count
            || content.ProtectedRoots.Count > 256) throw new WorkerError("invalid_content_request");
        var descriptors = protocolDescriptors.Concat([content.TargetFd, content.WorkFd, content.CacheFd]).ToArray();
        if (descriptors.Any(d => d < 3) || descriptors.Distinct().Count() != descriptors.Length) throw new WorkerError("invalid_storage_descriptor");
        foreach (var value in new[] { content.Scope.Server, content.Scope.Owner, content.Scope.Job, content.Scope.Nonce, content.Scope.RequestDigest })
            if (value is null || value.Length != 64 || value.Any(c => c is not (>= 'a' and <= 'f' or >= '0' and <= '9')))
                throw new WorkerError("invalid_publication_scope");
        foreach (var path in content.ProtectedRoots) DepotAcquisition.PathName(path);
        if (IsMutable(request))
        {
            var policy = expectedMutable ?? MutablePolicy.Resolve(content.MutablePolicyId, content.MutablePolicyDigest, request.AppId);
            if (policy.Id != content.MutablePolicyId || policy.Digest != content.MutablePolicyDigest || policy.App != request.AppId)
                throw new WorkerError("mutable_policy_mismatch");
            if (content.Previous is not null && (content.Previous.Version != 2 || content.Previous.PolicyDigest != policy.Digest))
                throw new WorkerError("mutable_policy_migration_required");
        }
        else if (expectedMutable is not null || content.MutablePolicyId is not null || content.MutablePolicyDigest is not null
            || content.Previous?.Version == 2) throw new WorkerError("mutable_policy_downgrade_refused");
        if (BaseOperation(request) == "recover_private_receipt")
        {
            if (request.Username is not null || request.Password is not null || request.Guard is not null || request.BetaPassword is not null
                || content.ValidationReceipt is not null) throw new WorkerError("invalid_receipt_recovery_request");
            if (content.Previous is not null) ReceiptRecovery.CheckPrevious(content.Previous, content.Scope, request.AppId);
        }
        if (BaseOperation(request) == "validate_private_receipt" && (request.Username is not null || request.Password is not null || request.Guard is not null
            || request.BetaPassword is not null || content.ValidationReceipt is null || content.Previous is not null))
            throw new WorkerError("invalid_receipt_validation_request");
        if ((BaseOperation(request) == "validate_private_receipt" || BaseOperation(request) == "recover_private_receipt" && content.ExpectedPublisherPlan is not null)
            && (content.ExpectedPublisherPlan is null
            || content.ExpectedPublisherPlan.App != request.AppId || content.ExpectedPublisherPlan.Build.Value == 0 || content.ExpectedPublisherPlan.Depots is null
            || content.ExpectedPublisherPlan.Depots.Count is 0 or > 128
            || content.ExpectedPublisherPlan.Depots.Any(d => d is null || d.PublisherApp == 0 || d.Depot == 0 || d.Manifest.Value == 0)
            || content.ExpectedPublisherPlan.Depots.Select(d => d.Depot).Distinct().Count() != content.ExpectedPublisherPlan.Depots.Count))
            throw new WorkerError("invalid_expected_publisher_plan");
        if (IsMutable(request) && (BaseOperation(request) == "validate_private_receipt" || content.ExpectedPublisherPlan is not null)
            && content.ExpectedPublisherPlan?.MutableInventory is null)
            throw new WorkerError("mutable_inventory_expectation_missing");
    }

    internal static ReceiptReference ValidateReceipt(PrivateRequest request, IReadOnlyList<int> protocolDescriptors, MutablePolicy? expectedMutable = null)
    {
        Validate(request, protocolDescriptors, expectedMutable);
        if (IsMutable(request)) expectedMutable ??= MutablePolicy.Resolve(request.Content!.MutablePolicyId, request.Content.MutablePolicyDigest, request.AppId);
        if (BaseOperation(request) != "validate_private_receipt") throw new WorkerError("invalid_operation");
        var job = request.Content!;
        using var target = new PrivateDirectory(job.TargetFd, privateModes: false);
        using var work = new PrivateDirectory(job.WorkFd);
        if ((target.Device, target.Inode) == (work.Device, work.Inode)) throw new WorkerError("storage_roots_overlap");
        var selection = new ContentSelection(request.AppId, request.Branch, job.Platform, job.Architecture, job.Language, job.DlcApps.ToHashSet());
        target.LockExclusive();
        try
        {
            var expected = job.ExpectedPublisherPlan!;
            var plan = new EntitledPlan(expected.App, expected.Build.Value,
                expected.Depots.Select(d => new DepotRequest(d.PublisherApp, d.Depot, d.Manifest.Value, request.Branch)).ToArray(), 0);
            var receipt = ParentReceiptBoundary.Validate(work, target, job.ValidationReceipt!, job.Scope, selection, plan, job.ContentBudget.Value,
                expectedMutable: expectedMutable, expectedInventory: expected.MutableInventory);
            CheckProtected(receipt, job.ProtectedRoots);
            return job.ValidationReceipt!;
        }
        finally { target.Unlock(); }
    }

    internal static void CheckProtected(PrivateReceipt receipt, IReadOnlyList<string> requested)
    {
        var protectedPaths = requested.Concat(["saves", "mods", "config"]).ToArray();
        var publishedPaths = receipt.Files.Select(f => f.Path).Concat((receipt.Directories ?? []).Select(d => d.Path))
            .Concat((receipt.Links ?? []).SelectMany(l => new[] { l.Path, PublisherLinks.Resolve(l.Path, l.Target) }))
            .Concat(receipt.Mutable?.Defaults.Select(f => f.Path) ?? []);
        if (publishedPaths.Any(path => protectedPaths.Any(p => path.Equals(p, StringComparison.OrdinalIgnoreCase) || path.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase))))
            throw new WorkerError("receipt_protected_path_mismatch");
    }

    internal static ReceiptReference RecoverReceipt(PrivateRequest request, IReadOnlyList<int> protocolDescriptors, MutablePolicy? expectedMutable = null)
    {
        if (IsMutable(request))
        {
            var result = RecoverMutableReceipt(request, protocolDescriptors, expectedMutable);
            return result.Receipt ?? throw new WorkerError("publication_rolled_back");
        }
        Validate(request, protocolDescriptors, expectedMutable);
        if (BaseOperation(request) != "recover_private_receipt") throw new WorkerError("invalid_operation");
        var job = request.Content!;
        using var target = new PrivateDirectory(job.TargetFd, privateModes: false);
        using var work = new PrivateDirectory(job.WorkFd);
        using var cache = new PrivateDirectory(job.CacheFd);
        if (new[] { (target.Device, target.Inode), (work.Device, work.Inode), (cache.Device, cache.Inode) }.Distinct().Count() != 3)
            throw new WorkerError("storage_roots_overlap");
        var selection = new ContentSelection(request.AppId, request.Branch, job.Platform, job.Architecture, job.Language, job.DlcApps.ToHashSet());
        target.LockExclusive();
        try
        {
            var reference = ReceiptRecovery.Discover(work, job.Scope, expectedMutable);
            var expected = job.ExpectedPublisherPlan ?? reference.PublisherPlan!;
            var plan = new EntitledPlan(expected.App, expected.Build.Value,
                expected.Depots.Select(d => new DepotRequest(d.PublisherApp, d.Depot, d.Manifest.Value, request.Branch)).ToArray(), 0);
            var receipt = ParentReceiptBoundary.Validate(work, target, reference, job.Scope, selection, plan, job.ContentBudget.Value,
                expectedMutable: expectedMutable, expectedInventory: expected.MutableInventory);
            CheckProtected(receipt, job.ProtectedRoots);
            return reference;
        }
        finally { target.Unlock(); }
    }

    internal static MutableRecoveryOutcome RecoverMutableReceipt(PrivateRequest request, IReadOnlyList<int> protocolDescriptors,
        MutablePolicy? expectedMutable = null, AccessProofKind proof = AccessProofKind.PrivateAccount)
    {
        Validate(request, protocolDescriptors, expectedMutable);
        if (!IsMutable(request) || BaseOperation(request) != "recover_private_receipt") throw new WorkerError("invalid_operation");
        var job = request.Content!;
        expectedMutable ??= MutablePolicy.Resolve(job.MutablePolicyId, job.MutablePolicyDigest, request.AppId);
        using var target = new PrivateDirectory(job.TargetFd, privateModes: false);
        using var work = new PrivateDirectory(job.WorkFd);
        using var cache = new PrivateDirectory(job.CacheFd);
        if (new[] { (target.Device, target.Inode), (work.Device, work.Inode), (cache.Device, cache.Inode) }.Distinct().Count() != 3)
            throw new WorkerError("storage_roots_overlap");
        var publisher = new StagedPublication(target, work, job.Scope, job.ProtectedRoots.Concat(["saves", "mods", "config"]), proof, expectedMutable);
        publisher.Recover(); // Includes uncommitted journal rollback; never auth, acquisition or replay.
        using (var committed = work.ReadFile(publisher.Prefix + "/receipt.json"))
            if (committed is null) return new(null, true);
        var expected = job.ExpectedPublisherPlan;
        if (expected?.MutableInventory is null) throw new WorkerError("mutable_inventory_expectation_missing");
        target.LockExclusive();
        try
        {
            var reference = ReceiptRecovery.Discover(work, job.Scope, expectedMutable);
            var selection = new ContentSelection(request.AppId, request.Branch, job.Platform, job.Architecture, job.Language, job.DlcApps.ToHashSet());
            var plan = new EntitledPlan(expected.App, expected.Build.Value,
                expected.Depots.Select(d => new DepotRequest(d.PublisherApp, d.Depot, d.Manifest.Value, request.Branch)).ToArray(), 0);
            var receipt = ParentReceiptBoundary.Validate(work, target, reference, job.Scope, selection, plan, job.ContentBudget.Value, proof,
                expectedMutable, expected.MutableInventory);
            CheckProtected(receipt, job.ProtectedRoots);
            return new(reference, false);
        }
        finally { target.Unlock(); }
    }

    internal static TimeSpan ReceiptDeadline(PrivateRequest request, IReadOnlyList<int> descriptors)
    {
        Validate(request, descriptors);
        if (BaseOperation(request) is not ("validate_private_receipt" or "recover_private_receipt")) throw new WorkerError("invalid_operation");
        return TimeSpan.FromSeconds(request.Content!.DeadlineSeconds);
    }

    internal static async Task<ReceiptReference> Run(PrivateRequest request, IAuthenticator guard,
        IReadOnlyList<int> protocolDescriptors, Func<IContentSession> factory, CancellationToken cancellation, MutablePolicy? expectedMutable = null)
    {
        Validate(request, protocolDescriptors, expectedMutable);
        if (IsMutable(request)) expectedMutable ??= MutablePolicy.Resolve(request.Content!.MutablePolicyId, request.Content.MutablePolicyDigest, request.AppId);
        var job = request.Content!;
        using var target = new PrivateDirectory(job.TargetFd, privateModes: false);
        using var work = new PrivateDirectory(job.WorkFd);
        using var cache = new PrivateDirectory(job.CacheFd);
        if (new[] { (target.Device, target.Inode), (work.Device, work.Inode), (cache.Device, cache.Inode) }.Distinct().Count() != 3)
            throw new WorkerError("storage_roots_overlap");
        var selection = new ContentSelection(request.AppId, request.Branch, job.Platform, job.Architecture, job.Language, job.DlcApps.ToHashSet());
        var publisher = new StagedPublication(target, work, job.Scope, job.ProtectedRoots.Concat(["saves", "mods", "config"]), mutablePolicy: expectedMutable);
        publisher.Admit();
        PrivateReceipt? previous = null;
        if (job.Previous is not null)
        {
            if (job.Previous.Scope.Server != job.Scope.Server || job.Previous.Scope.Owner != job.Scope.Owner || job.Previous.Scope.Nonce == job.Scope.Nonce)
                throw new WorkerError("prior_receipt_scope_mismatch");
            previous = ParentReceiptBoundary.Validate(work, target, job.Previous, job.Previous.Scope, selection, expectedMutable: expectedMutable);
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
                publisher, job.ContentBudget.Value, job.RollbackReserve.Value, previous, cancellation);
            var reference = ParentReceiptBoundary.Reference(work, receipt);
            _ = ParentReceiptBoundary.Validate(work, target, reference, job.Scope, selection, plan, expectedMutable: expectedMutable);
            return reference;
        }
        finally { cache.Unlock(); }
    }
}
