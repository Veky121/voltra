// MIT. Actual merged staging/publication with injected SteamKit manifest bytes.
using System.Security.Cryptography;
using SteamKit2;

namespace Voltra.SteamPrivate;

internal static class GameContentTests
{
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("multi-depot fixture"); }
    private static readonly string A = new('a', 64), B = new('b', 64);
    private static PublicationScope Scope(char nonce) => new(A, B, new('c', 64), new(nonce, 64), new('d', 64));
    private static readonly ContentSelection Selection = new(42, "preview", "linux", "64", "english", new HashSet<uint> { 901 });
    private static readonly EntitledPlan Plan = new(42, ulong.MaxValue, [new(42, 100, 1, "preview"), new(900, 101, 2, "preview")], 1);
    internal sealed class Transport(DepotRequest request, string path, byte[] bytes, bool corrupt = false,
        bool disposeFailure = false, Action? disposed = null, bool emptyDirectory = false) : IDepotTransport
    {
        private bool authorized;
        public Task Authorize(DepotRequest input, CancellationToken token) { Check(input == request); token.ThrowIfCancellationRequested(); authorized = true; return Task.CompletedTask; }
        public void ValidateAccess(DepotRequest input, CancellationToken token) { Check(authorized && input == request); token.ThrowIfCancellationRequested(); }
        public Task<DepotManifest> Manifest(DepotRequest input, CancellationToken token)
        {
            ValidateAccess(input, token);
            var manifest = new DepotManifest { DepotID = request.Depot, ManifestGID = request.Manifest, TotalUncompressedSize = (ulong)bytes.Length,
                Files = [new() { FileName = path, FileHash = SHA1.HashData(bytes), TotalSize = (ulong)bytes.Length, Flags = EDepotFileFlag.Executable,
                    Chunks = [new(SHA1.HashData(bytes), SteamKit2.CDN.DepotChunk.AdlerHash(bytes), 0, (uint)bytes.Length, (uint)bytes.Length)] }] };
            if (emptyDirectory) manifest.Files.Add(new() { FileName = "runtime/empty", Flags = EDepotFileFlag.Directory });
            return Task.FromResult(manifest);
        }
        public Task<byte[]> Chunk(DepotRequest input, DepotManifest.ChunkData chunk, CancellationToken token)
        { ValidateAccess(input, token); return Task.FromResult(corrupt ? new byte[bytes.Length] : bytes); }
        public ValueTask DisposeAsync() { authorized = false; disposed?.Invoke(); if (disposeFailure) throw new IOException("injected dispose"); return ValueTask.CompletedTask; }
    }
    private static StagedPublication Publisher(StorageTests.Fixture f, char nonce)
    { var publication = new StagedPublication(f.Target, f.Work, Scope(nonce), ["saves", "config", "mods"]); publication.Admit(); return publication; }
    private static Func<DepotRequest, IDepotTransport> Factory(byte[] bytes, bool corruptSecond = false, bool duplicate = false, bool conflict = false)
        => request => new Transport(request, duplicate || conflict ? "bin/server" : request.Depot == 100 ? "bin/server" : "data/shared",
            conflict && request.Depot == 101 ? bytes.Select(b => (byte)(b ^ 1)).ToArray() : bytes, corruptSecond && request.Depot == 101);
    internal static async Task Run()
    {
        var bytes = "whole-game fixture"u8.ToArray();
        using (var f = new StorageTests.Fixture())
        {
            var receipt = await GameContentCoordinator.Run(Plan, Selection, Factory(bytes), Publisher(f, '1'), 1024 * 1024, 4096, null, default);
            Check(receipt.Depots?.Count == 2 && receipt.App == 42 && receipt.Files.Count == 2 && receipt.PublicationCommitted);
            Check(File.ReadAllBytes(f.Root + "/target/data/shared").SequenceEqual(bytes));
        }
        using (var f = new StorageTests.Fixture())
        {
            var receipt = await GameContentCoordinator.Run(Plan, Selection, Factory(bytes, duplicate: true), Publisher(f, '1'), 1024 * 1024, 4096, null, default);
            Check(receipt.Files.Count == 1 && receipt.Depots?.Count == 2);
        }
        foreach (var conflict in new[] { false, true })
        {
            using var f = new StorageTests.Fixture();
            var publisher = Publisher(f, '1');
            try { await GameContentCoordinator.Run(Plan, Selection, Factory(bytes, corruptSecond: !conflict, conflict: conflict), publisher, 1024 * 1024, 4096, null, default); throw new InvalidOperationException(); }
            catch (WorkerError error) { Check(error.Code == (conflict ? "cross_depot_file_conflict" : "chunk_hash_mismatch")); }
            Check(!File.Exists(f.Root + "/target/bin/server") && !File.Exists(f.Root + "/target/data/shared"));
            Check(!File.Exists(f.Root + "/work/" + publisher.Prefix + "/receipt.json"));
        }
        for (var fault = 1; fault <= 4; fault++)
        {
            using var f = new StorageTests.Fixture();
            var receipt = await GameContentCoordinator.Run(Plan, Selection, Factory(bytes), Publisher(f, '1'), 1024 * 1024, 4096, null, default);
            var updated = "updated whole-game fixture"u8.ToArray();
            try
            {
                await GameContentCoordinator.Run(Plan, Selection, Factory(updated), Publisher(f, '2'), 1024 * 1024, 4096, receipt, default,
                    mutation => { if (mutation == fault) throw new IOException("injected whole-game failure"); });
                throw new InvalidOperationException();
            }
            catch (WorkerError error) { Check(error.Code == "game_content_failed"); }
            Check(File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(bytes));
            Check(File.ReadAllBytes(f.Root + "/target/data/shared").SequenceEqual(bytes));
        }
        using (var f = new StorageTests.Fixture())
        {
            var receipt = await GameContentCoordinator.Run(Plan, Selection,
                request => new Transport(request, request.Depot == 100 ? "bin/server" : "data/shared", bytes, emptyDirectory: true),
                Publisher(f, '1'), 1048576, 4096, null, default);
            Check(Directory.Exists(f.Root + "/target/runtime/empty") && receipt.Directories!.Any(d => d.Path == "runtime/empty"));
            var reference = ParentReceiptBoundary.Reference(f.Work, receipt);
            ParentReceiptBoundary.Validate(f.Work, f.Target, reference, Scope('1'), Selection, Plan);
        }
        foreach (var failContent in new[] { false, true })
        {
            using var f = new StorageTests.Fixture(); var disposed = new HashSet<uint>();
            try
            {
                await GameContentCoordinator.Run(Plan, Selection,
                    request => new Transport(request, request.Depot == 100 ? "bin/server" : "data/shared", bytes,
                        corrupt: failContent && request.Depot == 101, disposeFailure: request.Depot == 100, disposed: () => disposed.Add(request.Depot)),
                    Publisher(f, '1'), 1048576, 4096, null, default);
                throw new InvalidOperationException();
            }
            catch (WorkerError error) { Check(error.Code == (failContent ? "chunk_hash_mismatch" : "content_teardown_failed")); }
            Check(disposed.SetEquals(new uint[] { 100, 101 }));
        }
    }
}
