// MIT. Original orchestration against SteamKit2 3.5 APIs. No DepotDownloader source.
using System.Security.Cryptography;
using SteamKit2;
using SteamKit2.CDN;

namespace Voltra.SteamPrivate;

internal sealed record DepotRequest(uint App, uint Depot, ulong Manifest, string Branch);

internal interface IDepotTransport : IAsyncDisposable
{
    Task Authorize(DepotRequest request, CancellationToken cancellation);
    Task<DepotManifest> Manifest(DepotRequest request, CancellationToken cancellation);
    Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken cancellation);
    void ValidateAccess(DepotRequest request, CancellationToken cancellation);
}

// Construct only from an authenticated SteamClient after license/PICS selection.
// This adapter does not infer entitlement from metadata or a cache hit. A current
// publisher depot key and manifest request code are both mandatory for each run.
internal sealed class SteamKitDepotTransport : IDepotTransport
{
    private readonly SteamApps apps;
    private readonly SteamContent content;
    private readonly Client cdn;
    private byte[]? key;
    private ulong code;
    private Server? server;
    private CdnAuthorization? authorization;
    private DepotRequest? authorized;
    private readonly DepotRequest selected;
    private readonly Func<bool> entitlementCurrent;

    public SteamKitDepotTransport(SteamClient client, DepotRequest selected, Func<bool> entitlementCurrent)
    {
        if (!client.IsConnected || client.SteamID is null || client.SteamID.AccountType != EAccountType.Individual)
            throw new WorkerError("authenticated_session_required");
        apps = client.GetHandler<SteamApps>() ?? throw new WorkerError("session_unavailable");
        content = client.GetHandler<SteamContent>() ?? throw new WorkerError("session_unavailable");
        cdn = new Client(client);
        this.selected = selected; this.entitlementCurrent = entitlementCurrent;
    }

    public async Task Authorize(DepotRequest request, CancellationToken cancellation)
    {
        if (authorized is not null) throw new WorkerError("invalid_session_state");
        if (request.App == 0 || request.Depot == 0 || request.Manifest == 0 || string.IsNullOrEmpty(request.Branch))
            throw new WorkerError("invalid_depot_identity");
        cancellation.ThrowIfCancellationRequested();
        if (request != selected || !entitlementCurrent()) throw new WorkerError("entitlement_changed");
        var reply = await apps.GetDepotDecryptionKey(request.Depot, request.App).ToTask().WaitAsync(cancellation);
        if (reply.Result != EResult.OK || reply.DepotID != request.Depot || reply.DepotKey.Length != 32)
        {
            CryptographicOperations.ZeroMemory(reply.DepotKey);
            throw new WorkerError("depot_access_denied");
        }
        key = reply.DepotKey;
        code = await content.GetManifestRequestCode(request.Depot, request.App, request.Manifest, request.Branch).WaitAsync(cancellation);
        if (code == 0) throw new WorkerError("manifest_access_denied");
        var servers = await content.GetServersForSteamPipe(maxNumServers: 20).WaitAsync(cancellation);
        server = servers.FirstOrDefault(s => OfficialCdnPolicy.Eligible(s, request.App))
            ?? throw new WorkerError("secure_cdn_unavailable");
        // Account licensing, current snapshot, key and request code above remain
        // mandatory. The CDN token itself is optional in the actual SDK API.
        // A successful empty reply permits the SDK's optional absence. If a
        // scoped token is supplied, bind it to the exact URL VHost and use it.
        // Denied/expired replies and HTTP401/403 stop, with no downgrade/retry.
        var token = await content.GetCDNAuthToken(request.App, request.Depot, server.VHost!).WaitAsync(cancellation);
        authorization = CdnAuthorization.FromReply(request, server, token.Result, token.Token, token.Expiration, DateTime.UtcNow);
        if (!entitlementCurrent()) throw new WorkerError("entitlement_changed");
        authorized = request;
    }

    public void ValidateAccess(DepotRequest request, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!entitlementCurrent()) throw new WorkerError("entitlement_changed");
        if (authorized != request || key is null || server is null || code == 0 || authorization is null) throw new WorkerError("depot_access_denied");
    }

    public async Task<DepotManifest> Manifest(DepotRequest request, CancellationToken cancellation)
    {
        ValidateAccess(request, cancellation);
        // SteamKit has bounded internal HTTP timeouts but no CancellationToken
        // overload. Do not abandon an active HTTP task and dispose its key/buffer.
        var manifest = await OfficialCdnPolicy.Manifest(cdn, request, server!, key!, code, entitlementCurrent, cancellation, authorization!);
        ValidateAccess(request, cancellation);
        return manifest;
    }

    public async Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken cancellation)
    {
        ValidateAccess(request, cancellation);
        var data = await OfficialCdnPolicy.Chunk(cdn, request, server!, key!, code, chunk, entitlementCurrent, cancellation, authorization!);
        ValidateAccess(request, cancellation);
        return data;
    }

    public ValueTask DisposeAsync()
    {
        cdn.Dispose();
        if (key is not null) CryptographicOperations.ZeroMemory(key);
        key = null; authorization = null; authorized = null; code = 0;
        return ValueTask.CompletedTask;
    }
}

internal static class DepotAcquisition
{
    internal const uint MaxChunkBytes = 16 * 1024 * 1024;

    internal static string PathName(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Contains('\\') || path.Contains(':') || path.Any(char.IsControl)
            || path.Split('/').Any(p => p is "" or "." or ".." || p.EndsWith('.') || p.EndsWith(' ')))
            throw new WorkerError("invalid_manifest_path");
        return path;
    }

    internal static IReadOnlyList<DepotManifest.FileData> Preflight(DepotRequest request, DepotManifest manifest, ulong budget)
    {
        if (manifest.DepotID != request.Depot || manifest.ManifestGID != request.Manifest || manifest.FilenamesEncrypted || manifest.Files is null)
            throw new WorkerError("manifest_identity_mismatch");
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var files = new List<DepotManifest.FileData>();
        ulong total = 0;
        foreach (var file in manifest.Files)
        {
            PathName(file.FileName);
            if (!names.Add(file.FileName)) throw new WorkerError("manifest_path_collision");
            if (!string.IsNullOrEmpty(file.LinkTarget) || file.Flags.HasFlag(EDepotFileFlag.Symlink))
            {
                if (!file.Flags.HasFlag(EDepotFileFlag.Symlink) || file.Flags.HasFlag(EDepotFileFlag.Directory) || file.Chunks.Count != 0
                    || file.TotalSize > 4096 || file.TotalSize > budget - total) throw new WorkerError("invalid_manifest_link");
                PublisherLinks.Resolve(file.FileName, file.LinkTarget ?? "");
                total += file.TotalSize;
                continue;
            }
            if (file.Flags.HasFlag(EDepotFileFlag.Directory))
            {
                if (file.TotalSize != 0 || file.Chunks.Count != 0) throw new WorkerError("invalid_manifest_directory");
                continue;
            }
            if (file.TotalSize > long.MaxValue || file.FileHash.Length != 20) throw new WorkerError("invalid_manifest_file");
            if (file.TotalSize > budget - total) throw new WorkerError("content_budget_exceeded");
            total += file.TotalSize;
            ulong end = 0;
            foreach (var chunk in file.Chunks.OrderBy(c => c.Offset))
            {
                if (chunk.ChunkID?.Length != 20 || chunk.UncompressedLength == 0 || chunk.UncompressedLength > MaxChunkBytes
                    || chunk.CompressedLength == 0 || chunk.CompressedLength > MaxChunkBytes || chunk.Offset != end
                    || chunk.UncompressedLength > file.TotalSize - end)
                    throw new WorkerError("invalid_manifest_chunks");
                end += chunk.UncompressedLength;
            }
            if (end != file.TotalSize) throw new WorkerError("invalid_manifest_chunks");
            files.Add(file);
        }
        // A regular file cannot be the parent of any other manifest entry.
        foreach (var file in files)
            if (names.Any(n => n.StartsWith(file.FileName + "/", StringComparison.OrdinalIgnoreCase)))
                throw new WorkerError("manifest_path_collision");
        if (total != manifest.TotalUncompressedSize) throw new WorkerError("manifest_size_mismatch");
        return files;
    }

    internal static void VerifyChunk(DepotManifest.ChunkData chunk, byte[] data)
    {
        if (data.Length != chunk.UncompressedLength) throw new WorkerError("chunk_length_mismatch");
        if (DepotChunk.AdlerHash(data) != chunk.Checksum || !CryptographicOperations.FixedTimeEquals(SHA1.HashData(data), chunk.ChunkID!))
            throw new WorkerError("chunk_hash_mismatch");
    }

    // Output streams belong to a descriptor-confined staging owner. This method
    // never opens a manifest-derived filesystem path or publishes a receipt.
    public static async Task<IReadOnlyList<VerifiedFile>> Stage(DepotRequest request, IDepotTransport transport,
        ulong budget, Func<DepotManifest.FileData, Task<Stream>> createStage, CancellationToken cancellation,
        Action<IReadOnlyList<DepotManifest.FileData>>? preflightStorage = null)
    {
        try
        {
            await transport.Authorize(request, cancellation);
            var manifest = await transport.Manifest(request, cancellation);
            var plan = Preflight(request, manifest, budget);
            if (manifest.Files!.Any(f => f.Flags.HasFlag(EDepotFileFlag.Symlink))) throw new WorkerError("merged_link_coordinator_required");
            preflightStorage?.Invoke(plan);
            return await StageFiles(request, transport, plan, createStage, cancellation);
        }
        catch (WorkerError) { throw; }
        catch (OperationCanceledException) { throw; }
        catch { throw new WorkerError("content_acquisition_failed"); }
    }

    internal static async Task<IReadOnlyList<VerifiedFile>> StageFiles(DepotRequest request, IDepotTransport transport,
        IReadOnlyList<DepotManifest.FileData> plan, Func<DepotManifest.FileData, Task<Stream>> createStage, CancellationToken cancellation)
    {
        try
        {
            var verified = new List<VerifiedFile>();
            foreach (var file in plan)
            {
                cancellation.ThrowIfCancellationRequested();
                await using var output = await createStage(file);
                if (!output.CanWrite || !output.CanSeek || output.Position != 0 || output.Length != 0) throw new WorkerError("invalid_staging_stream");
                using var sha1 = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
                using var sha256 = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                foreach (var chunk in file.Chunks.OrderBy(c => c.Offset))
                {
                    cancellation.ThrowIfCancellationRequested();
                    var data = await transport.Chunk(request, chunk, cancellation);
                    VerifyChunk(chunk, data);
                    await output.WriteAsync(data, cancellation);
                    sha1.AppendData(data); sha256.AppendData(data);
                }
                if ((ulong)output.Length != file.TotalSize || !CryptographicOperations.FixedTimeEquals(sha1.GetHashAndReset(), file.FileHash))
                    throw new WorkerError("file_hash_mismatch");
                await output.FlushAsync(cancellation);
                if (output is FileStream disk) disk.Flush(flushToDisk: true);
                verified.Add(new(file.FileName, Convert.ToHexString(file.FileHash).ToLowerInvariant(),
                    Convert.ToHexString(sha256.GetHashAndReset()).ToLowerInvariant(), checked((long)file.TotalSize),
                    file.Flags.HasFlag(EDepotFileFlag.Executable) ? 0x1c0u : 0x180u));
            }
            transport.ValidateAccess(request, cancellation);
            return verified;
        }
        catch (WorkerError) { throw; }
        catch (OperationCanceledException) { throw; }
        catch { throw new WorkerError("content_acquisition_failed"); }
    }
}
