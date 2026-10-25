// MIT. Synthetic mechanical fixtures only. No private entitlement/auth claim.
// Positives compose actual coordinator + explicitly AnonymousPublic validator.
// The shipping RecoverReceipt entrypoint must reject anonymous/fixture proof.
using System.Security.Cryptography;
using System.Text.Json;

namespace Voltra.SteamPrivate;

internal static class ReceiptRecoveryTests
{
    private static readonly int[] Protocol = [200, 201, 202];
    private static readonly ContentSelection Selection = new(42, "preview", "linux", "64", "english", new HashSet<uint> { 901 });
    private static readonly EntitledPlan Plan = new(42, ulong.MaxValue, [new(42, 43, ulong.MaxValue, "preview")], 1);
    private static PublicationScope Scope(char nonce) => new(new('a', 64), new('b', 64), new(nonce, 64), new(nonce, 64), new('d', 64));
    private static string Prefix(PublicationScope scope) => scope.Server + "/" + scope.Owner + "/" + scope.Nonce;
    private static void Check(bool condition) { if (!condition) throw new InvalidOperationException("receipt recovery mechanical fixture"); }
    private static void Error(Action action, params string[] codes)
    {
        try { action(); throw new InvalidOperationException("recovery expected failure"); }
        catch (WorkerError error) { Check(codes.Contains(error.Code)); }
    }
    private static PrivateRequest Request(StorageTests.Fixture f, PublicationScope scope, ReceiptReference? previous = null)
        => new("recover_private_receipt", null, null, null, "preview", null, 42, true,
            new(scope, f.Target.Descriptor, f.Work.Descriptor, f.Cache.Descriptor, "linux", "64", "english", [901], [], 1048576UL, 4096UL, 1048576UL, 360, previous));
    private static async Task<PrivateReceipt> Publish(StorageTests.Fixture f, PublicationScope scope, byte[] bytes, PrivateReceipt? previous = null)
    {
        var publisher = new StagedPublication(f.Target, f.Work, scope, ["saves", "mods", "config"], AccessProofKind.AnonymousPublic);
        publisher.Admit();
        return await GameContentCoordinator.Run(Plan, Selection,
            depot => new GameContentTests.Transport(depot, "bin/server", bytes, emptyDirectory: true), publisher, 1048576, 4096, previous, default);
    }
    // Explicit test composition; never exposed by the shipping operation/wire.
    private static ReceiptReference Mechanical(StorageTests.Fixture f, PrivateRequest request)
    {
        ContentOperation.Validate(request, Protocol);
        f.Target.LockExclusive();
        try
        {
            var reference = ReceiptRecovery.Discover(f.Work, request.Content!.Scope);
            var expected = request.Content.ExpectedPublisherPlan ?? reference.PublisherPlan!;
            var plan = new EntitledPlan(expected.App, expected.Build.Value,
                expected.Depots.Select(d => new DepotRequest(d.PublisherApp, d.Depot, d.Manifest.Value, request.Branch)).ToArray(), 0);
            var selection = new ContentSelection(request.AppId, request.Branch, request.Content.Platform, request.Content.Architecture,
                request.Content.Language, request.Content.DlcApps.ToHashSet());
            var receipt = ParentReceiptBoundary.Validate(f.Work, f.Target, reference, request.Content.Scope, selection, plan,
                request.Content.ContentBudget.Value, AccessProofKind.AnonymousPublic);
            ContentOperation.CheckProtected(receipt, request.Content.ProtectedRoots);
            return reference;
        }
        finally { f.Target.Unlock(); }
    }
    private static string Snapshot(StorageTests.Fixture f)
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        // Enumeration exists only in this offline assertion, never recovery.
        return string.Join('\n', Directory.EnumerateFileSystemEntries(f.Root, "*", SearchOption.AllDirectories).Order().Select(path =>
        {
            var relative = Path.GetRelativePath(f.Root, path);
            var info = new FileInfo(path);
            if (info.LinkTarget is not null) return relative + ":link:" + info.LinkTarget;
            if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
            var mode = File.GetUnixFileMode(path);
            return Directory.Exists(path) ? relative + ":dir:" + mode : relative + ":" + mode + ":" + info.Length + ":"
                + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
        }));
    }
    private static void Write(StorageTests.Fixture f, PublicationScope scope, PrivateReceipt receipt)
        => File.WriteAllText(f.Root + "/work/" + Prefix(scope) + "/receipt.json", JsonSerializer.Serialize(receipt, ParentReceiptBoundary.Json));

    internal static async Task MechanicalAndProof()
    {
        using var f = new StorageTests.Fixture();
        var scope = Scope('1');
        var receipt = await Publish(f, scope, "synthetic mechanical receipt bytes"u8.ToArray());
        Check(!receipt.EntitlementVerified && !receipt.AccountEntitlementVerified && receipt.AnonymousAccessVerified);
        var before = Snapshot(f);
        var request = Request(f, scope);
        var reference = Mechanical(f, request);
        var repeated = Mechanical(f, request);
        Check(repeated.Scope == reference.Scope && repeated.Path == reference.Path && repeated.Sha256 == reference.Sha256
            && repeated.Files == reference.Files && repeated.PublisherPlan!.Depots.SequenceEqual(reference.PublisherPlan!.Depots)
            && reference.Scope == scope && reference.PublisherPlan.Build.Value == ulong.MaxValue);
        _ = ParentReceiptBoundary.Validate(f.Work, f.Target, reference, scope, Selection, Plan, expectedProof: AccessProofKind.AnonymousPublic);
        Error(() => ContentOperation.RecoverReceipt(request, Protocol), "invalid_provider_receipt");
        Check(Snapshot(f) == before);
        Write(f, scope, receipt with { Provider = "fixture-private-content-v1", AccessProof = "fixture_mechanical_only",
            EntitlementVerified = false, AccountEntitlementVerified = false, AnonymousAccessVerified = false });
        Error(() => ContentOperation.RecoverReceipt(request, Protocol), "invalid_provider_receipt");
    }

    internal static Task IncompleteAndBounded()
    {
        using var f = new StorageTests.Fixture();
        var scope = Scope('1'); var request = Request(f, scope);
        var before = Snapshot(f);
        Error(() => ContentOperation.RecoverReceipt(request, Protocol), "receipt_missing"); Check(Snapshot(f) == before);
        var publication = new StagedPublication(f.Target, f.Work, scope, [], AccessProofKind.AnonymousPublic); publication.Admit();
        using (var journal = f.Work.CreateFile(Prefix(scope) + "/journal.json")) journal.Write("{\"uncommitted\":true}"u8);
        before = Snapshot(f); Error(() => ContentOperation.RecoverReceipt(request, Protocol), "receipt_missing"); Check(Snapshot(f) == before);
        using (var file = f.Work.CreateFile(Prefix(scope) + "/receipt.json")) file.Write("{"u8);
        foreach (var text in new[] { "{", "null", "{}", "{\"version\":1,\"scope\":null}" })
        {
            File.WriteAllText(f.Root + "/work/" + Prefix(scope) + "/receipt.json", text);
            before = Snapshot(f); Error(() => ContentOperation.RecoverReceipt(request, Protocol), "invalid_provider_receipt", "receipt_scope_mismatch"); Check(Snapshot(f) == before);
        }
        using (var file = new FileStream(f.Root + "/work/" + Prefix(scope) + "/receipt.json", FileMode.Open, FileAccess.Write)) file.SetLength(ReceiptRecovery.MaxReceiptBytes + 1L);
        Error(() => ContentOperation.RecoverReceipt(request, Protocol), "receipt_inventory_too_large");
        return Task.CompletedTask;
    }

    internal static async Task TamperAndProtected()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        using var f = new StorageTests.Fixture(); var scope = Scope('1');
        var receipt = await Publish(f, scope, "mechanical target bytes"u8.ToArray()); var request = Request(f, scope);
        foreach (var altered in new[] { receipt with { Scope = scope with { RequestDigest = new('e', 64) } }, receipt with { PublicationCommitted = false },
            receipt with { NativeAcceptanceVerified = true }, receipt with { Files = null! }, receipt with { Depots = null! } })
        {
            Write(f, scope, altered); Error(() => ContentOperation.RecoverReceipt(request, Protocol), "receipt_scope_mismatch", "invalid_provider_receipt");
        }
        Write(f, scope, receipt);
        Error(() => Mechanical(f, request with { Branch = "other" }), "invalid_provider_receipt");
        Error(() => Mechanical(f, request with { Content = request.Content! with { Language = "other" } }), "invalid_provider_receipt");
        Error(() => Mechanical(f, request with { Content = request.Content! with { ExpectedPublisherPlan = new(42, 1UL, receipt.Depots!) } }), "receipt_publisher_identity_mismatch");
        Error(() => Mechanical(f, request with { Content = request.Content! with { ProtectedRoots = ["bin"] } }), "receipt_protected_path_mismatch");
        Error(() => Mechanical(f, request with { Content = request.Content! with { ProtectedRoots = ["runtime"] } }), "receipt_protected_path_mismatch");
        var target = f.Root + "/target/bin/server"; var bytes = File.ReadAllBytes(target); var mode = File.GetUnixFileMode(target);
        File.WriteAllBytes(target, bytes.Select(b => (byte)(b ^ 1)).ToArray()); Error(() => Mechanical(f, request), "receipt_file_hash_mismatch"); File.WriteAllBytes(target, bytes);
        File.SetUnixFileMode(target, UnixFileMode.UserRead | UnixFileMode.UserWrite); Error(() => Mechanical(f, request), "receipt_file_identity_mismatch"); File.SetUnixFileMode(target, mode);
        var receiptPath = f.Root + "/work/" + Prefix(scope) + "/receipt.json"; var receiptBytes = File.ReadAllBytes(receiptPath); File.Delete(receiptPath); File.CreateSymbolicLink(receiptPath, target);
        Error(() => ContentOperation.RecoverReceipt(request, Protocol), "unsafe_storage_entry"); File.Delete(receiptPath); File.WriteAllBytes(receiptPath, receiptBytes); File.SetUnixFileMode(receiptPath, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.SetUnixFileMode(receiptPath, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.OtherRead);
        Error(() => ContentOperation.RecoverReceipt(request, Protocol), "unsafe_storage_entry");
    }

    internal static async Task RequestAndLock()
    {
        using var f = new StorageTests.Fixture(); var scope = Scope('1');
        _ = await Publish(f, scope, "lock fixture"u8.ToArray()); var request = Request(f, scope);
        foreach (var invalid in new[] { request with { Username = "" }, request with { Password = "not-used" }, request with { Guard = "not-used" }, request with { BetaPassword = "not-used" },
            request with { Content = request.Content! with { ValidationReceipt = new(scope, "../arbitrary", new('f', 64), 1UL) } } })
            Error(() => ContentOperation.RecoverReceipt(invalid, Protocol), "invalid_receipt_recovery_request");
        Error(() => ContentOperation.RecoverReceipt(request with { Content = request.Content! with { Scope = scope with { Nonce = new('2', 64) } } }, Protocol), "receipt_missing");
        Error(() => ContentOperation.RecoverReceipt(request with { Content = request.Content! with { TargetFd = 200 } }, Protocol), "invalid_storage_descriptor");
        Error(() => ContentOperation.RecoverReceipt(request with { Content = request.Content! with { CacheFd = f.Target.Descriptor } }, Protocol), "invalid_storage_descriptor");
        using (var alias = new PrivateDirectory(f.Target.Descriptor))
            Error(() => ContentOperation.RecoverReceipt(request with { Content = request.Content! with { CacheFd = alias.Descriptor } }, Protocol), "storage_roots_overlap");
        f.Target.LockExclusive();
        try { Error(() => ContentOperation.RecoverReceipt(request, Protocol), "storage_busy"); }
        finally { f.Target.Unlock(); }
        f.Work.FailDirectorySync = () => true;
        try { Error(() => Mechanical(f, request), "storage_sync_failed"); }
        finally { f.Work.FailDirectorySync = null; }
    }

    internal static async Task PreviousGeneration()
    {
        using var f = new StorageTests.Fixture(); var firstScope = Scope('1');
        var prior = await Publish(f, firstScope, "old bytes now superseded"u8.ToArray()); var priorReference = ReceiptRecovery.Discover(f.Work, firstScope);
        var scope = Scope('2'); var current = await Publish(f, scope, "new committed bytes"u8.ToArray(), prior);
        var request = Request(f, scope, priorReference); ContentOperation.Validate(request, Protocol);
        Error(() => ParentReceiptBoundary.Validate(f.Work, f.Target, priorReference, firstScope, Selection, Plan,
            expectedProof: AccessProofKind.AnonymousPublic), "receipt_file_identity_mismatch", "receipt_file_hash_mismatch");
        var reference = Mechanical(f, request); Check(reference.Scope == current.Scope);
        Error(() => ContentOperation.RecoverReceipt(request, Protocol), "invalid_provider_receipt"); // Shipping still refuses anonymous proof.
        foreach (var invalid in new[] { priorReference with { Path = "../old-receipt" }, priorReference with { Scope = priorReference.Scope with { Owner = new('f', 64) } },
            priorReference with { Scope = priorReference.Scope with { Nonce = scope.Nonce } }, priorReference with { PublisherPlan = priorReference.PublisherPlan! with { App = 99 } } })
            Error(() => ContentOperation.Validate(request with { Content = request.Content! with { Previous = invalid } }, Protocol), "prior_receipt_scope_mismatch");
        // Exact Previous digest recomputation belongs to the trusted durable
        // parent request boundary; C# never invents a replacement scope digest.
    }

    internal static Task Deadline()
    {
        using var f = new StorageTests.Fixture(); var request = Request(f, Scope('1'));
        foreach (var seconds in new uint[] { 1, 360, 7200 })
        {
            var recovery = request with { Content = request.Content! with { DeadlineSeconds = seconds } };
            Check(ContentOperation.ReceiptDeadline(recovery, Protocol) == TimeSpan.FromSeconds(seconds));
            var validation = recovery with { Operation = "validate_private_receipt", Content = recovery.Content! with {
                ValidationReceipt = new(Scope('1'), Prefix(Scope('1')) + "/receipt.json", new('f', 64), 1UL),
                ExpectedPublisherPlan = new(42, ulong.MaxValue, [new(42, 43, ulong.MaxValue)]) } };
            Check(ContentOperation.ReceiptDeadline(validation, Protocol) == TimeSpan.FromSeconds(seconds));
        }
        foreach (var seconds in new uint[] { 0, 7201 }) Error(() => ContentOperation.ReceiptDeadline(request with {
            Content = request.Content! with { DeadlineSeconds = seconds } }, Protocol), "invalid_content_request");
        return Task.CompletedTask;
    }
}
