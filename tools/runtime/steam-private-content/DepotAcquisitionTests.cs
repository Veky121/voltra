// MIT. Injected offline data exercises the actual acquisition coordinator.
using System.Security.Cryptography;
using SteamKit2;

namespace Voltra.SteamPrivate;

internal static class DepotAcquisitionTests
{
    private static readonly DepotRequest Request = new(42, 43, ulong.MaxValue, "preview");
    private static readonly byte[] Bytes = "publisher fixture bytes"u8.ToArray();
    private static void Check(bool condition) { if (!condition) throw new InvalidOperationException("content fixture"); }
    private static uint Adler(byte[] data)
    {
        return SteamKit2.CDN.DepotChunk.AdlerHash(data);
    }
    private static DepotManifest Fixture() => new()
    {
        DepotID = 43, ManifestGID = ulong.MaxValue, TotalUncompressedSize = (ulong)Bytes.Length,
        Files = [new() { FileName = "bin/server", FileHash = SHA1.HashData(Bytes), TotalSize = (ulong)Bytes.Length,
            Chunks = [new(SHA1.HashData(Bytes), Adler(Bytes), 0, (uint)Bytes.Length, (uint)Bytes.Length)] }]
    };
    private sealed class Transport : IDepotTransport
    {
        internal DepotManifest Data = Fixture();
        internal byte[] Payload = Bytes;
        internal bool Denied, Authorized;
        internal int Reads;
        public Task Authorize(DepotRequest request, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            if (Denied) throw new WorkerError("depot_access_denied");
            Authorized = true; return Task.CompletedTask;
        }
        public Task<DepotManifest> Manifest(DepotRequest request, CancellationToken token)
        { Check(Authorized); return Task.FromResult(Data); }
        public Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken token)
        { Check(Authorized); Reads++; return Task.FromResult(Payload); }
        public void ValidateAccess(DepotRequest request, CancellationToken token) { token.ThrowIfCancellationRequested(); if (Denied) throw new WorkerError("depot_access_denied"); Check(Authorized); }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
    private static async Task Reject(Transport transport, string code, ulong budget = 1024)
    {
        var opened = 0;
        try
        {
            await DepotAcquisition.Stage(Request, transport, budget, _ => { opened++; return Task.FromResult<Stream>(new MemoryStream()); }, default);
            throw new InvalidOperationException("expected rejection");
        }
        catch (WorkerError error) { Check(error.Code == code); }
        if (code is not ("chunk_hash_mismatch" or "chunk_length_mismatch" or "file_hash_mismatch")) Check(opened == 0 && transport.Reads == 0);
    }
    public static async Task Run()
    {
        var transport = new Transport();
        var result = await DepotAcquisition.Stage(Request, transport, 1024, _ => Task.FromResult<Stream>(new MemoryStream()), default);
        Check(result.Count == 1 && result[0].Bytes == Bytes.Length && result[0].ObservedSha256 == Convert.ToHexString(SHA256.HashData(Bytes)).ToLowerInvariant());
        transport = new(); transport.Data.Files![0].Flags = EDepotFileFlag.Executable;
        result = await DepotAcquisition.Stage(Request, transport, 1024, _ => Task.FromResult<Stream>(new MemoryStream()), default);
        Check(result[0].Mode == 0x1c0);
        await Reject(new() { Denied = true }, "depot_access_denied");
        await Reject(new(), "content_budget_exceeded", 1);
        foreach (var path in new[] { "../secret", "/secret", "C:/secret", "a\\b", "a//b", "a/./b", "a/../b", "x\nname", "a. ", "a." })
        {
            transport = new(); transport.Data.Files![0].FileName = path;
            await Reject(transport, "invalid_manifest_path");
        }
        transport = new(); transport.Data.ManifestGID = 1; await Reject(transport, "manifest_identity_mismatch");
        transport = new(); transport.Data.FilenamesEncrypted = true; await Reject(transport, "manifest_identity_mismatch");
        transport = new(); transport.Data.Files!.Add(new() { FileName = "BIN/SERVER" }); await Reject(transport, "manifest_path_collision");
        transport = new(); transport.Data.Files![0].Flags = EDepotFileFlag.Symlink; await Reject(transport, "invalid_manifest_link");
        transport = new(); transport.Data.Files![0].Chunks[0].Offset = 1; await Reject(transport, "invalid_manifest_chunks");
        transport = new(); transport.Data.Files![0].Chunks.Add(transport.Data.Files[0].Chunks[0]); await Reject(transport, "invalid_manifest_chunks");
        transport = new(); transport.Data.Files![0].Chunks.Clear(); await Reject(transport, "invalid_manifest_chunks");
        transport = new(); transport.Data.TotalUncompressedSize++; await Reject(transport, "manifest_size_mismatch");
        await Reject(new() { Payload = Bytes[..^1] }, "chunk_length_mismatch");
        transport = new() { Payload = Bytes.Select(b => (byte)(b ^ 1)).ToArray() }; await Reject(transport, "chunk_hash_mismatch");
        transport = new(); transport.Data.Files![0].Chunks[0].Checksum++; await Reject(transport, "chunk_hash_mismatch");
        transport = new(); transport.Data.Files![0].FileHash = new byte[20]; await Reject(transport, "file_hash_mismatch");
        using var cancel = new CancellationTokenSource(); cancel.Cancel();
        try { await DepotAcquisition.Stage(Request, new Transport(), 1024, _ => throw new InvalidOperationException(), cancel.Token); throw new InvalidOperationException(); }
        catch (OperationCanceledException) { }
    }
}
