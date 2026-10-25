// MIT. Future provider boundary only; no acquisition/network implementation.
namespace Voltra.SteamPrivate;

internal sealed record DepotIdentity(uint DepotId, ulong ManifestId, string Branch, string Platform);
internal sealed record VerifiedFile(string RelativePath, string ManifestSha1, string ObservedSha256, long Bytes, uint Mode = 0x180);
internal sealed record ProviderReceipt(string Provider, uint AppId, ulong BuildId,
    IReadOnlyList<DepotIdentity> Depots, IReadOnlyList<VerifiedFile> Files,
    bool EntitlementVerified, bool PublicationCommitted, bool NativeAcceptanceVerified);

internal interface IPrivateContentProvider
{
    // Any future implementation must return publisher-derived identities after
    // real ownership checks and hash-verified publication. Never fake SteamCMD ACF.
    Task<ProviderReceipt> StageAndPublishAsync(CancellationToken cancellation);
}

internal static class PublicationPolicy
{
    public static void Validate(ProviderReceipt receipt)
    {
        if (receipt.Provider != "steamkit-depot-v1" || receipt.AppId == 0 || receipt.BuildId == 0 || receipt.Depots.Count == 0
            || receipt.Files.Count == 0 || !receipt.EntitlementVerified || !receipt.PublicationCommitted)
            throw new WorkerError("incomplete_provider_receipt");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in receipt.Files)
        {
            var path = file.RelativePath;
            if (string.IsNullOrEmpty(path) || path.StartsWith('/') || path.Contains('\\') || path.Contains(':')
                || path.Split('/').Any(segment => segment is "" or "." or "..") || path.Any(c => c < 32) || !names.Add(path)
                || !System.Text.RegularExpressions.Regex.IsMatch(file.ManifestSha1, "\\A[0-9a-f]{40}\\z")
                || !System.Text.RegularExpressions.Regex.IsMatch(file.ObservedSha256, "\\A[0-9a-f]{64}\\z") || file.Bytes < 0)
                throw new WorkerError("invalid_publication_plan");
        }
        if (receipt.Depots.Any(depot => depot.DepotId == 0 || depot.ManifestId == 0 || depot.Platform is not ("linux" or "windows")))
            throw new WorkerError("invalid_depot_identity");
    }
}
