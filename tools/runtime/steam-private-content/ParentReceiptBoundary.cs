// MIT. Parent-callable independent receipt and actual-file verification.
using System.Security.Cryptography;
using System.Text.Json;

namespace Voltra.SteamPrivate;

internal sealed record ExpectedPublisherPlan(uint App, MetadataUInt64 Build, IReadOnlyList<ReceiptDepot> Depots,
    MutableInventoryExpectation? MutableInventory = null);
internal sealed record ReceiptReference(PublicationScope Scope, string Path, string Sha256, MetadataUInt64 Files, ExpectedPublisherPlan? PublisherPlan = null,
    int Version = 1, string? PolicyDigest = null, MutableInventoryExpectation? MutableInventory = null);

internal static class ParentReceiptBoundary
{
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    internal static ReceiptReference Reference(PrivateDirectory work, PrivateReceipt receipt)
    {
        var path = receipt.Scope.Server + "/" + receipt.Scope.Owner + "/" + receipt.Scope.Nonce + "/receipt.json";
        using var file = work.ReadFile(path) ?? throw new WorkerError("receipt_missing");
        var inventory = receipt.Mutable is null ? null : new MutableInventoryExpectation(receipt.Mutable.PublisherInventoryDigest,
            (ulong)receipt.Mutable.PublisherFiles.Count, (ulong)receipt.Mutable.Defaults.Count);
        return new(receipt.Scope, path, Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant(), (ulong)receipt.Files.Count,
            new(receipt.App, receipt.Build, receipt.Depots ?? [], inventory), receipt.Version, receipt.Mutable?.PolicyDigest, inventory);
    }

    internal static PrivateReceipt Validate(PrivateDirectory work, PrivateDirectory target, ReceiptReference reference,
        PublicationScope expectedScope, ContentSelection selection, EntitledPlan? plan = null, ulong byteBudget = ulong.MaxValue,
        AccessProofKind expectedProof = AccessProofKind.PrivateAccount, MutablePolicy? expectedMutable = null,
        MutableInventoryExpectation? expectedInventory = null)
    {
        var expectedPath = expectedScope.Server + "/" + expectedScope.Owner + "/" + expectedScope.Nonce + "/receipt.json";
        if (reference.Scope != expectedScope || reference.Path != expectedPath || reference.Sha256.Length != 64) throw new WorkerError("receipt_scope_mismatch");
        using var source = work.ReadFile(expectedPath) ?? throw new WorkerError("receipt_missing");
        if (source.Length > 16 * 1024 * 1024) throw new WorkerError("receipt_inventory_too_large");
        if (Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant() != reference.Sha256) throw new WorkerError("receipt_digest_mismatch");
        source.Position = 0;
        PrivateReceipt receipt;
        try { receipt = JsonSerializer.Deserialize<PrivateReceipt>(source, Json) ?? throw new WorkerError("invalid_provider_receipt"); }
        catch (JsonException) { throw new WorkerError("invalid_provider_receipt"); }
        if (receipt.Version != (expectedMutable is null ? 1 : 2) || reference.Version != receipt.Version
            || (expectedMutable is null ? receipt.Mutable is not null || reference.PolicyDigest is not null : reference.PolicyDigest != expectedMutable.Digest)
            || !AccessProof.Valid(receipt, expectedProof) || receipt.Scope != expectedScope || receipt.App != selection.App
            || receipt.Branch != selection.Branch || receipt.Platform != selection.Platform || receipt.Architecture != selection.Architecture
            || receipt.Language != selection.Language || !receipt.PublicationCommitted || receipt.NativeAcceptanceVerified
            || receipt.Files.Count == 0 && (receipt.Directories?.Count ?? 0) == 0 && (receipt.Links?.Count ?? 0) == 0 && (receipt.Mutable?.Defaults.Count ?? 0) == 0
            || (ulong)receipt.Files.Count != reference.Files.Value || receipt.Build.Value == 0
            || receipt.Depots is null || receipt.Depots.Count is 0 or > 128
            || receipt.Depots.Any(d => d.PublisherApp == 0 || d.Depot == 0 || d.Manifest.Value == 0)
            || receipt.Depots.Select(d => d.Depot).Distinct().Count() != receipt.Depots.Count
            || !receipt.Depots.Any(d => d.Depot == receipt.Depot && d.Manifest == receipt.Manifest))
            throw new WorkerError("invalid_provider_receipt");
        if (plan is not null && (plan.App != receipt.App || plan.Build != receipt.Build.Value
            || !plan.Depots.Select(d => (d.App, d.Depot, d.Manifest)).ToHashSet().SetEquals(receipt.Depots.Select(d => (d.PublisherApp, d.Depot, d.Manifest.Value)))))
            throw new WorkerError("receipt_publisher_identity_mismatch");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        ulong total = 0;
        foreach (var entry in receipt.Files)
        {
            if (entry.Bytes.Value > byteBudget - total) throw new WorkerError("receipt_content_budget_exceeded");
            total += entry.Bytes.Value;
            DepotAcquisition.PathName(entry.Path);
            if (!names.Add(entry.Path) || entry.Mode is not (0x180 or 0x1c0 or 0x1a4 or 0x1ed)
                || !System.Text.RegularExpressions.Regex.IsMatch(entry.Sha1, "\\A[0-9a-f]{40}\\z")
                || !System.Text.RegularExpressions.Regex.IsMatch(entry.Sha256, "\\A[0-9a-f]{64}\\z")) throw new WorkerError("invalid_provider_receipt");
            using var file = target.ReadFile(entry.Path) ?? throw new WorkerError("receipt_file_missing");
            var identity = PrivateDirectory.Identity(file);
            if (identity != (entry.Bytes.Value, entry.Mode, entry.Uid, entry.Gid)) throw new WorkerError("receipt_file_identity_mismatch");
            if (Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant() != entry.Sha256) throw new WorkerError("receipt_file_hash_mismatch");
            file.Position = 0;
            if (Convert.ToHexString(SHA1.HashData(file)).ToLowerInvariant() != entry.Sha1) throw new WorkerError("receipt_file_hash_mismatch");
        }
        foreach (var directory in receipt.Directories ?? [])
        {
            DepotAcquisition.PathName(directory.Path);
            if (!names.Add(directory.Path) || directory.Mode != 0x1c0 || !target.DirectoryExists(directory.Path)
                || target.DirectoryIdentity(directory.Path) != (directory.Mode, directory.Uid, directory.Gid))
                throw new WorkerError("receipt_directory_identity_mismatch");
        }
        PublisherLinks.Validate(receipt.Links ?? [], receipt.Files.Select(f => f.Path), (receipt.Directories ?? []).Select(d => d.Path), receipt.Platform);
        foreach (var link in receipt.Links ?? [])
        {
            if (!names.Add(link.Path) || link.Mode != 0x1ff || target.ReadLink(link.Path) != link)
                throw new WorkerError("receipt_link_identity_mismatch");
        }
        if (expectedMutable is not null) MutablePublication.Validate(receipt, target, work,
            expectedScope.Server + "/" + expectedScope.Owner + "/" + expectedScope.Nonce, expectedMutable,
            expectedInventory ?? reference.MutableInventory ?? throw new WorkerError("mutable_inventory_expectation_missing"));
        if (expectedMutable is not null && (reference.MutableInventory is null || reference.PublisherPlan?.MutableInventory != reference.MutableInventory
            || expectedInventory is not null && reference.MutableInventory != expectedInventory))
            throw new WorkerError("mutable_publisher_partition_mismatch");
        work.ConfirmDurable(expectedPath);
        return receipt;
    }
}
