// MIT. Private verified cache; fresh transport authorization always precedes reads.
using SteamKit2;

namespace Voltra.SteamPrivate;

internal sealed class PrivateChunkCache : IDepotTransport
{
    private readonly IDepotTransport transport;
    private readonly PrivateDirectory cache;
    private readonly string scope;
    private readonly ulong quota;
    private DepotRequest? authorized;
    private bool locked;
    private readonly bool externallyLocked;

    internal PrivateChunkCache(IDepotTransport transport, PrivateDirectory cache, string server, string owner, ulong quota, bool externallyLocked = false)
    {
        foreach (var value in new[] { server, owner })
            if (value.Length != 64 || value.Any(c => c is not (>= 'a' and <= 'f' or >= '0' and <= '9')))
                throw new WorkerError("invalid_cache_scope");
        this.transport = transport; this.cache = cache; this.quota = quota; scope = server + "/" + owner;
        this.externallyLocked = externallyLocked;
    }

    public async Task Authorize(DepotRequest request, CancellationToken cancellation)
    {
        if (authorized is not null) throw new WorkerError("invalid_session_state");
        await transport.Authorize(request, cancellation);
        cancellation.ThrowIfCancellationRequested();
        if (externallyLocked) { if (!cache.IsLocked) throw new WorkerError("storage_lock_missing"); }
        else cache.LockExclusive();
        locked = true;
        if (cache.StorageBytes() > quota) throw new WorkerError("private_cache_quota_exceeded");
        authorized = request;
    }
    public void ValidateAccess(DepotRequest request, CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (authorized != request || !locked) throw new WorkerError("depot_access_denied");
        transport.ValidateAccess(request, cancellation);
    }
    public Task<DepotManifest> Manifest(DepotRequest request, CancellationToken cancellation)
    {
        ValidateAccess(request, cancellation); return transport.Manifest(request, cancellation);
    }
    public async Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken cancellation)
    {
        ValidateAccess(request, cancellation);
        if (chunk.ChunkID?.Length != 20 || chunk.UncompressedLength > DepotAcquisition.MaxChunkBytes)
            throw new WorkerError("invalid_manifest_chunks");
        var prefix = scope + "/" + request.App + "/" + request.Depot + "/" + request.Manifest + "/";
        var path = prefix + Convert.ToHexString(chunk.ChunkID).ToLowerInvariant();
        using (var existing = cache.ReadFile(path))
        {
            if (existing is not null)
            {
                if (existing.Length != chunk.UncompressedLength) throw new WorkerError("private_cache_corrupt");
                var data = new byte[checked((int)existing.Length)];
                await existing.ReadExactlyAsync(data, cancellation);
                try { DepotAcquisition.VerifyChunk(chunk, data); }
                catch (WorkerError) { throw new WorkerError("private_cache_corrupt"); }
                ValidateAccess(request, cancellation);
                return data;
            }
        }
        var downloaded = await transport.Chunk(request, chunk, cancellation);
        DepotAcquisition.VerifyChunk(chunk, downloaded);
        // Reserve worst-case new directory metadata plus final file metadata.
        var used = cache.StorageBytes();
        var required = checked((ulong)downloaded.Length + 6 * 4096UL);
        if (used > quota || required > quota - used) throw new WorkerError("private_cache_quota_exceeded");
        if (cache.AvailableBytes() < required) throw new WorkerError("private_cache_disk_space_insufficient");
        var temp = prefix + "pending-" + Guid.NewGuid().ToString("N");
        try
        {
            using (var output = cache.CreateFile(temp)) { await output.WriteAsync(downloaded, cancellation); output.Flush(true); }
            cache.Move(temp, cache, path);
        }
        catch
        {
            using var pending = cache.ReadFile(temp);
            if (pending is not null) cache.Delete(temp);
            throw;
        }
        return downloaded;
    }
    public async ValueTask DisposeAsync()
    {
        authorized = null;
        try { if (locked) { if (!externallyLocked) cache.Unlock(); locked = false; } }
        finally { await transport.DisposeAsync(); }
    }
}
