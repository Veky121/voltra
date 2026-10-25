// MIT. Actual Linux file descriptors, rename journal and injected offline bytes.
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using SteamKit2;

namespace Voltra.SteamPrivate;

internal static class StorageTests
{
    [DllImport("libc", SetLastError = true)] private static extern int open(string path, int flags);
    [DllImport("libc")] private static extern int close(int fd);
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("storage fixture"); }
    private static readonly string A = new('a', 64), B = new('b', 64);
    private static PublicationScope Scope(char nonce) => new(A, B, new('c', 64), new(nonce, 64), new('d', 64));
    private static readonly DepotRequest Request = new(42, 43, ulong.MaxValue, "preview");
    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static VerifiedFile Verified(byte[] bytes) => new("bin/server", Convert.ToHexString(SHA1.HashData(bytes)).ToLowerInvariant(), Sha(bytes), bytes.Length);
    internal sealed class Fixture : IDisposable
    {
        internal readonly string Root = Path.Combine(Path.GetTempPath(), "voltra-content-fixture-" + Guid.NewGuid().ToString("N"));
        internal readonly PrivateDirectory Target, Work, Cache;
        private readonly bool ownsRoot;
        internal Fixture(string? existingRoot = null)
        {
            if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
            ownsRoot = existingRoot is null;
            if (existingRoot is not null) Root = existingRoot;
            Directory.CreateDirectory(Root, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            Target = Open("target", false); Work = Open("work", true); Cache = Open("cache", true);
        }
        private PrivateDirectory Open(string name, bool privateModes)
        {
            if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
            var path = Path.Combine(Root, name);
            Directory.CreateDirectory(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            var fd = open(path, 0xb0000);
            if (fd < 0) throw new InvalidOperationException("fixture fd");
            try { return new(fd, privateModes); } finally { _ = close(fd); }
        }
        public void Dispose() { Cache.Dispose(); Work.Dispose(); Target.Dispose(); if (ownsRoot) Directory.Delete(Root, recursive: true); }
    }
    private static StagedPublication Stage(Fixture f, char nonce, byte[] bytes)
    {
        var publisher = new StagedPublication(f.Target, f.Work, Scope(nonce), ["config", "saves", "mods"]);
        publisher.Admit();
        using var stream = publisher.CreateStage(new() { FileName = "bin/server" }).GetAwaiter().GetResult();
        stream.Write(bytes); stream.Flush();
        return publisher;
    }
    private static void Error(Action action, string code)
    {
        try { action(); throw new InvalidOperationException("expected fixed error"); }
        catch (WorkerError error) { Check(error.Code == code); }
    }
    internal static Task Publication()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        using var f = new Fixture();
        byte[] oldBytes = "original owned content"u8.ToArray(), newBytes = "updated owned content"u8.ToArray();
        var first = Stage(f, '1', oldBytes);
        var receipt = first.Publish(Request, ulong.MaxValue, "linux", "64", "english", [Verified(oldBytes)], null);
        Check(receipt.PublicationCommitted && !receipt.NativeAcceptanceVerified);
        Check(File.GetUnixFileMode(f.Root + "/target/bin/server") == (UnixFileMode.UserRead | UnixFileMode.UserWrite));
        Error(() => first.Admit(), "storage_create_conflict");
        f.Target.LockExclusive();
        try
        {
            var contender = Stage(f, '6', newBytes);
            Error(() => contender.Publish(Request, 1, "linux", "64", "english", [Verified(newBytes)], receipt), "storage_busy");
        }
        finally { f.Target.Unlock(); }
        for (var fault = 1; fault <= 2; fault++)
        {
            var publisher = Stage(f, (char)('1' + fault), newBytes);
            try
            {
                publisher.Publish(Request, ulong.MaxValue, "linux", "64", "english", [Verified(newBytes)], receipt,
                    mutation => { if (mutation == fault) throw new IOException("injected publication interruption"); });
                throw new InvalidOperationException("fault was not reached");
            }
            catch (IOException) { }
            Check(File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(oldBytes));
            publisher.Recover(); // Recovery is repeatable after restoration.
        }
        // Reconstruct an interrupted transaction from the durable intent, without
        // retaining an in-memory publisher or progress callback.
        var interrupted = new StagedPublication(f.Target, f.Work, Scope('2'), ["config", "saves", "mods"]);
        f.Target.Move("bin/server", f.Work, interrupted.Prefix + "/backup/bin/server");
        f.Work.Move(interrupted.Prefix + "/stage/bin/server", f.Target, "bin/server");
        interrupted.Recover();
        Check(File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(oldBytes));
        var wrong = new StagedPublication(f.Target, f.Work, Scope('2') with { RequestDigest = new('e', 64) }, []);
        Error(wrong.Recover, "publication_scope_mismatch");
        var conflict = Stage(f, '4', newBytes);
        File.WriteAllBytes(f.Root + "/target/bin/server", "operator modified"u8.ToArray());
        Error(() => conflict.Publish(Request, 1, "linux", "64", "english", [Verified(newBytes)], receipt), "operator_file_conflict");
        File.WriteAllBytes(f.Root + "/target/bin/server", oldBytes);
        var blocked = Stage(f, '5', newBytes);
        Error(() => blocked.Publish(Request, 1, "linux", "64", "english", [Verified(newBytes)], receipt,
            mutation => { if (mutation == 2) { File.WriteAllBytes(f.Root + "/target/bin/server", "racing operator"u8.ToArray()); throw new IOException(); } }), "publication_rollback_failed");
        Check(File.ReadAllText(f.Root + "/target/bin/server") == "racing operator");
        return Task.CompletedTask;
    }

    internal static Task CommitBoundaries()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        foreach (var checkpoint in new[] { "before_write", "after_write", "after_flush", "before_rename", "after_rename" })
        {
            using var f = new Fixture();
            var bytes = "executable fixture"u8.ToArray();
            var publisher = Stage(f, '1', bytes);
            var committed = false;
            try
            {
                var receipt = publisher.Publish(Request, ulong.MaxValue, "linux", "64", "english", [Verified(bytes) with { Mode = 0x1c0 }], null,
                    receiptCheckpoint: step => { if (step == checkpoint) throw new IOException("receipt interruption"); });
                committed = receipt.PublicationCommitted;
            }
            catch (IOException) { }
            if (checkpoint == "after_rename")
            {
                Check(committed && File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(bytes));
                Check(File.GetUnixFileMode(f.Root + "/target/bin/server") == (UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute));
                publisher.Recover(); // Fully committed receipt validates and stays committed.
            }
            else
            {
                Check(!committed && !File.Exists(f.Root + "/target/bin/server"));
                Check(!File.Exists(f.Root + "/work/" + publisher.Prefix + "/receipt.json"));
                publisher.Recover();
            }
        }
        using (var f = new Fixture())
        {
            var bytes = "commit uncertain fixture"u8.ToArray();
            var publisher = Stage(f, '1', bytes);
            Error(() => publisher.Publish(Request, 1, "linux", "64", "english", [Verified(bytes)], null,
                receiptCheckpoint: step => { if (step == "after_rename_before_sync") f.Work.FailDirectorySync = () => true; }), "publication_commit_uncertain");
            Check(File.ReadAllBytes(f.Root + "/target/bin/server").SequenceEqual(bytes));
            f.Work.FailDirectorySync = null;
            publisher.Recover(); // Fresh fsync confirms the uncertain commit durably.
        }
        return Task.CompletedTask;
    }

    internal static Task Confinement()
    {
        using var f = new Fixture();
        File.WriteAllText(f.Root + "/outside", "operator");
        File.CreateSymbolicLink(f.Root + "/work/file-link", f.Root + "/outside");
        Error(() => f.Work.ReadFile("file-link"), "unsafe_storage_entry");
        Error(() => f.Work.CreateFile("file-link"), "storage_create_conflict");
        Directory.CreateSymbolicLink(f.Root + "/work/parent-link", f.Root);
        Error(() => f.Work.CreateFile("parent-link/escaped"), "unsafe_storage_parent");
        var publisher = new StagedPublication(f.Target, f.Work, Scope('1'), ["config"]);
        publisher.Admit();
        Error(() => publisher.CreateStage(new() { FileName = "config/operator.ini" }).GetAwaiter().GetResult(), "protected_publication_path");
        var journal = f.Root + "/work/" + publisher.Prefix + "/journal.json";
        File.CreateSymbolicLink(journal, f.Root + "/outside");
        Error(publisher.Recover, "unsafe_storage_entry");
        Check(File.ReadAllText(f.Root + "/outside") == "operator" && !File.Exists(f.Root + "/escaped"));
        return Task.CompletedTask;
    }

    private sealed class Transport : IDepotTransport
    {
        internal bool Deny;
        internal int Reads;
        public Task Authorize(DepotRequest request, CancellationToken token)
        { token.ThrowIfCancellationRequested(); if (Deny) throw new WorkerError("depot_access_denied"); return Task.CompletedTask; }
        public Task<DepotManifest> Manifest(DepotRequest request, CancellationToken token) => throw new NotSupportedException();
        public Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken token)
        { Reads++; return Task.FromResult("cache bytes"u8.ToArray()); }
        public void ValidateAccess(DepotRequest request, CancellationToken token) { token.ThrowIfCancellationRequested(); if (Deny) throw new WorkerError("entitlement_changed"); }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
    internal static async Task Cache()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        using var f = new Fixture();
        var bytes = "cache bytes"u8.ToArray();
        var chunk = new DepotManifest.ChunkData(SHA1.HashData(bytes), SteamKit2.CDN.DepotChunk.AdlerHash(bytes), 0, (uint)bytes.Length, (uint)bytes.Length);
        var transport = new Transport();
        await using (var cache = new PrivateChunkCache(transport, f.Cache, A, B, 1024 * 1024))
        {
            try { await cache.Chunk(Request, chunk, default); throw new InvalidOperationException(); } catch (WorkerError e) { Check(e.Code == "depot_access_denied"); }
            await cache.Authorize(Request, default);
            Check((await cache.Chunk(Request, chunk, default)).SequenceEqual(bytes));
            Check((await cache.Chunk(Request, chunk, default)).SequenceEqual(bytes) && transport.Reads == 1);
            transport.Deny = true;
            try { await cache.Chunk(Request, chunk, default); throw new InvalidOperationException(); } catch (WorkerError e) { Check(e.Code == "entitlement_changed"); }
        }
        var denied = new Transport { Deny = true };
        await using (var cache = new PrivateChunkCache(denied, f.Cache, A, B, 1024 * 1024))
        {
            try { await cache.Authorize(Request, default); throw new InvalidOperationException(); } catch (WorkerError e) { Check(e.Code == "depot_access_denied"); }
            Check(denied.Reads == 0);
        }
        var other = new Transport();
        await using (var cache = new PrivateChunkCache(other, f.Cache, A, new('f', 64), 1024 * 1024))
        { await cache.Authorize(Request, default); await cache.Chunk(Request, chunk, default); Check(other.Reads == 1); }
        var path = f.Root + "/cache/" + A + "/" + B + "/42/43/" + ulong.MaxValue + "/" + Convert.ToHexString(chunk.ChunkID!).ToLowerInvariant();
        Check(File.GetUnixFileMode(path) == (UnixFileMode.UserRead | UnixFileMode.UserWrite));
        File.WriteAllBytes(path, new byte[bytes.Length]);
        await using (var cache = new PrivateChunkCache(new Transport(), f.Cache, A, B, 1024 * 1024))
        {
            await cache.Authorize(Request, default);
            try { await cache.Chunk(Request, chunk, default); throw new InvalidOperationException(); } catch (WorkerError e) { Check(e.Code == "private_cache_corrupt"); }
        }
        await using (var cache = new PrivateChunkCache(new Transport(), f.Cache, A, B, 1))
        { try { await cache.Authorize(Request, default); throw new InvalidOperationException(); } catch (WorkerError e) { Check(e.Code == "private_cache_quota_exceeded"); } }
        File.CreateSymbolicLink(f.Root + "/cache/link", f.Root + "/outside");
        Error(() => f.Cache.StorageBytes(), "unsafe_storage_entry");
    }
}
