// MIT. Actual Linux links, merged SteamKit manifests, journal rollback and receipts.
using System.Security.Cryptography;
using SteamKit2;

namespace Voltra.SteamPrivate;

internal static class PublisherLinkTests
{
    private static void Check(bool ok) { if (!ok) throw new InvalidOperationException("link fixture"); }
    private static readonly DepotRequest Request = new(42, 43, 1, "preview");
    private static readonly EntitledPlan Plan = new(42, 7, [Request], 1);
    private static readonly ContentSelection Selection = new(42, "preview", "linux", "64", "english", new HashSet<uint>());
    private static PublicationScope Scope(char nonce) => new(new('a', 64), new('b', 64), new('c', 64), new(nonce, 64), new('d', 64));
    private sealed class Transport(byte[] bytes, string currentTarget, Action<DepotManifest>? change = null) : IDepotTransport
    {
        public Task Authorize(DepotRequest request, CancellationToken token) => Task.CompletedTask;
        public void ValidateAccess(DepotRequest request, CancellationToken token) => token.ThrowIfCancellationRequested();
        public Task<DepotManifest> Manifest(DepotRequest request, CancellationToken token)
        {
            DepotManifest.FileData File(string path) => new() { FileName = path, Flags = EDepotFileFlag.Executable, FileHash = SHA1.HashData(bytes), TotalSize = (ulong)bytes.Length,
                Chunks = [new(SHA1.HashData(bytes), SteamKit2.CDN.DepotChunk.AdlerHash(bytes), 0, (uint)bytes.Length, (uint)bytes.Length)] };
            DepotManifest.FileData Link(string path, string target) => new() { FileName = path, Flags = EDepotFileFlag.Symlink, LinkTarget = target };
            var manifest = new DepotManifest { DepotID = 43, ManifestGID = 1, TotalUncompressedSize = (ulong)bytes.Length * 2,
                Files = [File("bin/server"), File("bin/server-next"), new() { FileName = "runtime/empty", Flags = EDepotFileFlag.Directory },
                    Link("bin/current", currentTarget), Link("bin/chain", "current"), Link("lib/server", "../bin/server"), Link("runtime-current", "runtime")] };
            change?.Invoke(manifest); return Task.FromResult(manifest);
        }
        public Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken token) => Task.FromResult(bytes);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
    private static StagedPublication Publisher(StorageTests.Fixture f, char nonce)
    { var p = new StagedPublication(f.Target, f.Work, Scope(nonce), ["saves", "mods", "config"]); p.Admit(); return p; }
    internal static async Task Run()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        var old = "old symlink fixture bytes"u8.ToArray(); var updated = "new symlink fixture bytes"u8.ToArray();
        using (var f = new StorageTests.Fixture())
        {
            var receipt = await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(old, "server"), Publisher(f, '1'), 1048576, 4096, null, default);
            Check(receipt.Links?.Count == 4 && new FileInfo(f.Root + "/target/bin/current").LinkTarget == "server");
            Check(File.ReadAllBytes(f.Root + "/target/bin/chain").SequenceEqual(old)); // Fixture proves native Linux semantics.
            ParentReceiptBoundary.Validate(f.Work, f.Target, ParentReceiptBoundary.Reference(f.Work, receipt), Scope('1'), Selection, Plan);
            var second = await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(updated, "server-next"), Publisher(f, '2'), 1048576, 4096, receipt, default);
            Check(new FileInfo(f.Root + "/target/bin/current").LinkTarget == "server-next");
            ParentReceiptBoundary.Validate(f.Work, f.Target, ParentReceiptBoundary.Reference(f.Work, second), Scope('2'), Selection, Plan);
        }
        for (var fault = 5; fault <= 12; fault++)
        {
            using var f = new StorageTests.Fixture();
            var prior = await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(old, "server"), Publisher(f, '1'), 1048576, 4096, null, default);
            var publisher = Publisher(f, '2');
            try
            {
                await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(updated, "server-next"), publisher, 1048576, 4096, prior, default,
                    mutation => { if (mutation == fault) throw new IOException("injected link mutation failure"); });
                throw new InvalidOperationException("fault not reached");
            }
            catch (WorkerError error) { Check(error.Code == "game_content_failed"); }
            Check(new FileInfo(f.Root + "/target/bin/current").LinkTarget == "server");
            Check(File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(old));
            publisher.Recover();
        }
        foreach (var target in new[] { "/tmp/outside", "../../outside", "C:/outside", "some\\where", "missing", "current", "chain" })
        {
            using var f = new StorageTests.Fixture();
            try { await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(old, target), Publisher(f, '1'), 1048576, 4096, null, default); throw new InvalidOperationException(); }
            catch (WorkerError error) { Check(error.Code is "invalid_publisher_link_target" or "publisher_link_escape" or "publisher_link_unknown_target" or "publisher_link_cycle"); }
            Check(!Directory.Exists(f.Root + "/target/bin"));
        }
        using (var f = new StorageTests.Fixture())
        {
            try { await GameContentCoordinator.Run(Plan, Selection with { Platform = "windows" }, _ => new Transport(old, "server"), Publisher(f, '1'), 1048576, 4096, null, default); throw new InvalidOperationException(); }
            catch (WorkerError error) { Check(error.Code == "publisher_links_platform_unsupported"); }
        }
        using (var f = new StorageTests.Fixture())
        {
            var prior = await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(old, "server"), Publisher(f, '1'), 1048576, 4096, null, default);
            File.Delete(f.Root + "/target/bin/current");
            File.CreateSymbolicLink(f.Root + "/target/bin/current", "server-next");
            var publisher = Publisher(f, '2');
            try { await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(updated, "server-next"), publisher, 1048576, 4096, prior, default); throw new InvalidOperationException(); }
            catch (WorkerError error) { Check(error.Code == "operator_link_identity_conflict"); }
            Check(new FileInfo(f.Root + "/target/bin/current").LinkTarget == "server-next");
            Check(File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(old));
            Check(!File.Exists(f.Root + "/work/" + publisher.Prefix + "/journal.json"));
        }
        using (var f = new StorageTests.Fixture())
        {
            var prior = await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(old, "server"), Publisher(f, '1'), 1048576, 4096, null, default);
            var publisher = Publisher(f, '2');
            try
            {
                await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(updated, "server-next"), publisher, 1048576, 4096, prior, default,
                    mutation => { if (mutation == 5) throw new IOException("interrupt before link replace"); });
            }
            catch (WorkerError error) { Check(error.Code == "game_content_failed"); }
            // Reconstruct loss of the process after link backup/replacement.
            f.Target.Move("bin/current", f.Work, publisher.Prefix + "/backup-links/bin/current");
            f.Work.Move(publisher.Prefix + "/stage-links/bin/current", f.Target, "bin/current");
            new StagedPublication(f.Target, f.Work, Scope('2'), ["config", "saves", "mods"]).Recover();
            Check(new FileInfo(f.Root + "/target/bin/current").LinkTarget == "server");
        }
    }

    internal static Task OperatorIdentity()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        foreach (var directory in new[] { false, true })
        {
            using var f = new StorageTests.Fixture(); var bytes = "operator metadata fixture"u8.ToArray();
            var first = Publisher(f, '1');
            using (var staged = first.CreateStage(new() { FileName = "bin/server" }).GetAwaiter().GetResult()) staged.Write(bytes);
            var file = new VerifiedFile("bin/server", Convert.ToHexString(SHA1.HashData(bytes)).ToLowerInvariant(), Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), bytes.Length);
            var prior = first.Publish(Request, 7, "linux", "64", "english", [file], null);
            var next = Publisher(f, '2');
            using (var staged = next.CreateStage(new() { FileName = "bin/server" }).GetAwaiter().GetResult()) staged.Write(bytes);
            var changedPath = f.Root + (directory ? "/target/bin" : "/target/bin/server");
            var mode = directory ? UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute
                : UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute;
            try
            {
                next.Publish(Request, 7, "linux", "64", "english", [file], prior,
                    receiptCheckpoint: step => { if (step == "under_lock_before_preflight" && OperatingSystem.IsLinux()) File.SetUnixFileMode(changedPath, mode); });
                throw new InvalidOperationException();
            }
            catch (WorkerError error) { Check(error.Code == (directory ? "operator_directory_identity_conflict" : "operator_file_identity_conflict")); }
            Check(File.GetUnixFileMode(changedPath) == mode && File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(bytes));
            Check(!File.Exists(f.Root + "/work/" + next.Prefix + "/journal.json"));
        }
        return Task.CompletedTask;
    }
}
