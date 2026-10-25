// MIT. Exact-scope committed-receipt discovery only; never publication replay.
using System.Security.Cryptography;
using System.Text.Json;

namespace Voltra.SteamPrivate;

internal static class ReceiptRecovery
{
    internal const int MaxReceiptBytes = 16 * 1024 * 1024;
    private static bool Hex(string? value) => value is { Length: 64 } && value.All(c => c is >= 'a' and <= 'f' or >= '0' and <= '9');

    internal static void CheckPrevious(ReceiptReference previous, PublicationScope scope, uint app)
    {
        var old = previous.Scope;
        var plan = previous.PublisherPlan;
        if (old is null || !new[] { old.Server, old.Owner, old.Job, old.Nonce, old.RequestDigest, previous.Sha256 }.All(Hex)
            || old.Server != scope.Server || old.Owner != scope.Owner || old.Nonce == scope.Nonce || old.Job == scope.Job
            || previous.Path != old.Server + "/" + old.Owner + "/" + old.Nonce + "/receipt.json"
            || plan is null || plan.App != app || plan.Build.Value == 0 || plan.Depots is null || plan.Depots.Count is 0 or > 128
            || plan.Depots.Any(d => d is null || d.PublisherApp == 0 || d.Depot == 0 || d.Manifest.Value == 0)
            || plan.Depots.Select(d => d.Depot).Distinct().Count() != plan.Depots.Count)
            throw new WorkerError("prior_receipt_scope_mismatch");
        // Parent recomputes the original request digest including Previous.
        // Its superseded target files must not be validated after an update.
    }

    internal static ReceiptReference Discover(PrivateDirectory work, PublicationScope originalScope, MutablePolicy? expectedMutable = null)
    {
        if (originalScope is null || !new[] { originalScope.Server, originalScope.Owner, originalScope.Job,
            originalScope.Nonce, originalScope.RequestDigest }.All(Hex)) throw new WorkerError("invalid_publication_scope");
        var path = originalScope.Server + "/" + originalScope.Owner + "/" + originalScope.Nonce + "/receipt.json";
        using var source = work.ReadFile(path) ?? throw new WorkerError("receipt_missing");
        if (source.Length > MaxReceiptBytes) throw new WorkerError("receipt_inventory_too_large");
        using var bytes = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int count;
        while ((count = source.Read(buffer)) != 0)
        {
            if (bytes.Length + count > MaxReceiptBytes) throw new WorkerError("receipt_inventory_too_large");
            bytes.Write(buffer, 0, count);
        }
        PrivateReceipt receipt;
        try { receipt = JsonSerializer.Deserialize<PrivateReceipt>(bytes.GetBuffer().AsSpan(0, checked((int)bytes.Length)), ParentReceiptBoundary.Json)
                ?? throw new WorkerError("invalid_provider_receipt"); }
        catch (JsonException) { throw new WorkerError("invalid_provider_receipt"); }
        if (receipt.Scope != originalScope) throw new WorkerError("receipt_scope_mismatch");
        if (receipt.Version != (expectedMutable is null ? 1 : 2)
            || (expectedMutable is null ? receipt.Mutable is not null : receipt.Mutable?.PolicyDigest != expectedMutable.Digest)
            || !receipt.PublicationCommitted || receipt.NativeAcceptanceVerified || receipt.App == 0
            || receipt.Build.Value == 0 || receipt.Files is null || receipt.Files.Any(f => f is null)
            || receipt.Depots is null || receipt.Depots.Count is 0 or > 128 || receipt.Depots.Any(d => d is null
                || d.PublisherApp == 0 || d.Depot == 0 || d.Manifest.Value == 0)
            || receipt.Depots.Select(d => d.Depot).Distinct().Count() != receipt.Depots.Count
            || receipt.Directories?.Any(d => d is null) == true || receipt.Links?.Any(l => l is null) == true
            || receipt.Files.Count == 0 && (receipt.Directories?.Count ?? 0) == 0 && (receipt.Links?.Count ?? 0) == 0)
            throw new WorkerError("invalid_provider_receipt");
        // A root-owned private receipt is persisted worker evidence, not a
        // cryptographic seal against privileged self-consistent rewrites.
        var inventory = receipt.Mutable is null ? null : new MutableInventoryExpectation(receipt.Mutable.PublisherInventoryDigest,
            (ulong)receipt.Mutable.PublisherFiles.Count, (ulong)receipt.Mutable.Defaults.Count);
        return new(originalScope, path, Convert.ToHexString(SHA256.HashData(bytes.GetBuffer().AsSpan(0, checked((int)bytes.Length)))).ToLowerInvariant(),
            (ulong)receipt.Files.Count, new(receipt.App, receipt.Build, receipt.Depots, inventory), receipt.Version, receipt.Mutable?.PolicyDigest, inventory);
    }
}
