// MIT. Whitelisted anonymous PICS metadata; never ownership/content evidence.
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using SteamKit2;

namespace Voltra.SteamPrivate;

internal sealed record BranchIdentity(string Name, MetadataUInt64? BuildId, bool PasswordRequired);
internal sealed record ManifestIdentity(string Branch, MetadataUInt64 ManifestId, MetadataUInt64? DiskBytes, MetadataUInt64? DownloadBytes);
internal sealed record DepotMetadata(uint DepotId, uint? FromAppId, string[] Platforms, int? Architecture,
    bool EncryptedManifestsPresent, ManifestIdentity[] Manifests);
internal sealed record AppMetadata(uint AppId, string State, bool MissingAccessToken, bool OnlyPublic,
    uint? ChangeNumber, string[] Platforms, BranchIdentity[] Branches, DepotMetadata[] Depots)
{
    public bool EntitlementVerified => false;
    public bool ContentDownloaded => false;
}

internal interface IAnonymousMetadataSession : IAsyncDisposable
{
    Task Connect(CancellationToken token);
    Task LogOnAnonymous(CancellationToken token);
    Task<AppMetadata> ReadAppMetadata(uint appId, CancellationToken token);
}

internal static class MetadataOperation
{
    public static async Task<AppMetadata> Run(PrivateRequest request, Func<IAnonymousMetadataSession> factory, CancellationToken token)
    {
        TypedFields.Validate(request);
        if (request.Operation != "anonymous_metadata") throw new WorkerError("invalid_operation");
        if (request.Username is not null || request.Password is not null || request.Guard is not null || request.BetaPassword is not null)
            throw new WorkerError("metadata_credentials_not_allowed");
        token.ThrowIfCancellationRequested();
        await using var session = factory();
        try
        {
            await session.Connect(token); await session.LogOnAnonymous(token);
            var result = await session.ReadAppMetadata(request.AppId, token);
            token.ThrowIfCancellationRequested();
            if (result.AppId != request.AppId) throw new WorkerError("invalid_metadata");
            return result;
        }
        catch (WorkerError) { throw; }
        catch (OperationCanceledException) { throw; }
        catch { throw new WorkerError("metadata_failed"); }
    }
}

internal static class MetadataProjection
{
    public static AppMetadata Empty(uint appId, string state) => new(appId, state, false, false, null, [], [], []);
    private static readonly Regex Name = new("\\A[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\\z");
    private static ulong? Number(string? value) => MetadataUInt64.ParseCanonical(value);
    private static uint? App(string? value) { var number = Number(value); return number is > 0 and <= int.MaxValue ? (uint)number : null; }
    private static string[] Platforms(string? value) => (value ?? "").Split(',').Where(p => p is "linux" or "windows" or "macos").Distinct(StringComparer.Ordinal).Order().ToArray();
    public static AppMetadata Project(uint requested, SteamApps.PICSProductInfoCallback.PICSProductInfo info)
    {
        if (info.ID != requested) throw new WorkerError("invalid_metadata");
        var root = info.KeyValues;
        var reported = App(root["appid"].Value);
        if (reported is not null && reported != requested) throw new WorkerError("invalid_metadata");
        var branches = new List<BranchIdentity>(); var depots = new List<DepotMetadata>(); var totalManifests = 0;
        var branchNames = new HashSet<string>(StringComparer.Ordinal); var depotIds = new HashSet<uint>();
        var partial = false;
        if (root["depots"].Children.Count > 144 || root["depots"]["branches"].Children.Count > 64)
            throw new WorkerError("metadata_too_large");
        foreach (var branch in root["depots"]["branches"].Children)
        {
            if (branch.Name is null || !Name.IsMatch(branch.Name)) { partial = true; continue; }
            if (branches.Count >= 64) throw new WorkerError("metadata_too_large");
            if (!branchNames.Add(branch.Name)) throw new WorkerError("invalid_metadata");
            if (branch["buildid"].Value is not null && Number(branch["buildid"].Value) is null) partial = true;
            branches.Add(new(branch.Name, Number(branch["buildid"].Value), branch["pwdrequired"].Value == "1"));
        }
        foreach (var depot in root["depots"].Children)
        {
            var id = App(depot.Name); if (id is null) continue;
            if (!depotIds.Add(id.Value)) throw new WorkerError("invalid_metadata");
            if (depots.Count >= 128) throw new WorkerError("metadata_too_large");
            var manifests = new List<ManifestIdentity>(); var manifestNames = new HashSet<string>(StringComparer.Ordinal);
            if (depot["manifests"].Children.Count > 128) throw new WorkerError("metadata_too_large");
            foreach (var manifest in depot["manifests"].Children)
            {
                if (manifest.Name is null || !Name.IsMatch(manifest.Name)) { partial = true; continue; }
                if (!manifestNames.Add(manifest.Name)) throw new WorkerError("invalid_metadata");
                var gid = Number(manifest["gid"].Value ?? manifest.Value);
                if (gid is null or 0) { partial = true; continue; }
                if (++totalManifests > 128) throw new WorkerError("metadata_too_large");
                if (manifest["size"].Value is not null && Number(manifest["size"].Value) is null
                    || manifest["download"].Value is not null && Number(manifest["download"].Value) is null) partial = true;
                manifests.Add(new(manifest.Name, gid.Value, Number(manifest["size"].Value), Number(manifest["download"].Value)));
            }
            var architecture = depot["config"]["osarch"].Value;
            depots.Add(new(id.Value, App(depot["depotfromapp"].Value), Platforms(depot["config"]["oslist"].Value),
                architecture == "64" ? 64 : architecture == "32" ? 32 : null,
                depot["encryptedmanifests"].Children.Count != 0, manifests.ToArray()));
        }
        var state = info.MissingToken ? "missing_access" : branches.Count == 0 && depots.Count == 0 ? info.UseHttp ? "http_metadata_required" : "empty" : partial ? "partial" : "available";
        var snapshot = new AppMetadata(requested, state, info.MissingToken, info.OnlyPublic, info.ChangeNumber,
            Platforms(root["common"]["oslist"].Value), branches.ToArray(), depots.ToArray());
        // Leave room for the terminal envelope within the 64KiB private channel.
        if (JsonSerializer.SerializeToUtf8Bytes(snapshot).Length > 48 * 1024) throw new WorkerError("metadata_too_large");
        return snapshot;
    }
}
