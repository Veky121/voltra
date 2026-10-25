// MIT. Honest offline policy fixture through the shipping coordinator and durable engine.
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using SteamKit2;

namespace Voltra.SteamPrivate;

internal static class MutablePublicationTests
{
    [DllImport("libc", SetLastError = true)] private static extern int chown(string path, uint uid, uint gid);
    [DllImport("libc", SetLastError = true)] private static extern int pipe([Out] int[] descriptors);
    [DllImport("libc")] private static extern int close(int descriptor);
    private const string Config = "Game/Config/Default.ini";
    private static readonly byte[] Default = "[Server]\nValue=publisher\n"u8.ToArray();
    private static readonly ContentSelection Selection = new(42, "preview", "linux", "64", "english", new HashSet<uint>());
    private static readonly EntitledPlan Plan = new(42, 100, [new(42, 43, 44, "preview")], 0);
    private static MutablePolicy Policy(bool executable = false) => new("offline-fixture-config-v1", 42, 100,
        ["Game/Config"], [new(Config, MutablePolicy.Hash(Default), executable)]);
    private static PublicationScope Scope(char n) => new(new('a', 64), new('b', 64), new('c', 64), new(n, 64), new('d', 64));
    private static void Check(bool value) { if (!value) throw new InvalidOperationException("mutable publication fixture"); }
    private static void Error(Action action, string? expected = null)
    { try { action(); throw new InvalidOperationException("expected mutable error"); } catch (WorkerError e) { Check(expected is null || e.Code == expected); } }

    private sealed class Transport(bool executable = false, string path = Config, bool collide = false) : IDepotTransport
    {
        private bool allowed;
        public Task Authorize(DepotRequest request, CancellationToken token) { allowed = true; return Task.CompletedTask; }
        public void ValidateAccess(DepotRequest request, CancellationToken token) { Check(allowed); token.ThrowIfCancellationRequested(); }
        public Task<DepotManifest> Manifest(DepotRequest request, CancellationToken token)
        {
            ValidateAccess(request, token);
            DepotManifest.FileData File(string name, byte[] bytes, bool execute) => new() { FileName = name, FileHash = SHA1.HashData(bytes),
                TotalSize = (ulong)bytes.Length, Flags = execute ? EDepotFileFlag.Executable : 0,
                Chunks = [new(SHA1.HashData(bytes), SteamKit2.CDN.DepotChunk.AdlerHash(bytes), 0, (uint)bytes.Length, (uint)bytes.Length)] };
            var rows = new List<DepotManifest.FileData> { File("bin/server", "immutable publisher executable fixture"u8.ToArray(), true), File(path, Default, executable) };
            if (collide) rows.Add(File(path.ToLowerInvariant(), Default, executable));
            return Task.FromResult(new DepotManifest { DepotID = request.Depot, ManifestGID = request.Manifest, Files = rows,
                TotalUncompressedSize = (ulong)rows.Sum(r => (long)r.TotalSize) });
        }
        public Task<byte[]> Chunk(DepotRequest request, DepotManifest.ChunkData chunk, CancellationToken token)
        { ValidateAccess(request, token); return Task.FromResult(chunk.ChunkID.SequenceEqual(SHA1.HashData(Default)) ? Default : "immutable publisher executable fixture"u8.ToArray()); }
        public ValueTask DisposeAsync() { allowed = false; return ValueTask.CompletedTask; }
    }
    private static StagedPublication Publisher(StorageTests.Fixture f, char n, MutablePolicy? p = null) =>
        new(f.Target, f.Work, Scope(n), ["saves", "mods", "config"], AccessProofKind.OfflineFixture, p ?? Policy());
    private static Task<PrivateReceipt> Publish(StorageTests.Fixture f, char n, PrivateReceipt? old = null,
        Action<int>? fault = null, MutablePolicy? policy = null, Func<DepotRequest, IDepotTransport>? transport = null)
    {
        var publisher = Publisher(f, n, policy); publisher.Admit();
        return GameContentCoordinator.Run(Plan, Selection, transport ?? (_ => new Transport()), publisher, 1048576, 4096, old, default, fault);
    }
    private static PrivateReceipt Validate(StorageTests.Fixture f, PrivateReceipt receipt, MutablePolicy? policy = null)
    {
        var reference = ParentReceiptBoundary.Reference(f.Work, receipt);
        return ParentReceiptBoundary.Validate(f.Work, f.Target, reference, receipt.Scope, Selection, Plan,
            expectedProof: AccessProofKind.OfflineFixture, expectedMutable: policy ?? Policy());
    }

    internal static async Task Retention()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        using var f = new StorageTests.Fixture();
        var directory = f.Root + "/target/Game/Config"; Directory.CreateDirectory(directory);
        var existing = directory + "/unknown.mod"; File.WriteAllBytes(existing, "operator-owned bytes"u8.ToArray());
        File.SetUnixFileMode(existing, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead | UnixFileMode.OtherRead);
        if (Environment.GetEnvironmentVariable("VOLTRA_MUTABLE_CHOWN_FIXTURE") == "1")
        {
            var effective = File.ReadAllLines("/proc/self/status").Single(l => l.StartsWith("CapEff:", StringComparison.Ordinal)).Split(':')[1].Trim();
            Check(Convert.ToUInt64(effective, 16) == 1); // CAP_CHOWN only, no other effective capability.
            Check(chown(existing, 1000, 1000) == 0);
        }
        var before = f.Target.OperatorTree("Game/Config", 100, 1048576);
        var first = await Publish(f, '1');
        Check(first.Version == 2 && first.Mutable!.Defaults.Count == 1 && first.Files.All(r => r.Path != Config));
        Check(first.Provider == "fixture-private-content-v2" && !first.AccountEntitlementVerified && !first.AnonymousAccessVerified && !first.EntitlementVerified);
        Check(before.All(r => f.Target.OperatorTree("Game/Config", 100, 1048576).Contains(r)));
        _ = Validate(f, first);
        // The real runtime/operator may edit publisher defaults and add arbitrary unknown config.
        File.WriteAllText(f.Root + "/target/" + Config, "[Server]\nValue=operator\n");
        File.WriteAllText(directory + "/extra.ini", "[Mods]\nUnknown=keep\n");
        var snapshot = f.Target.OperatorTree("Game/Config", 100, 1048576);
        _ = Validate(f, first); // Historical preservation is not a perpetual publisher hash claim.
        var second = await Publish(f, '2', first); _ = Validate(f, second);
        Check(snapshot.SequenceEqual(f.Target.OperatorTree("Game/Config", 100, 1048576)));
        File.Delete(f.Root + "/target/" + Config);
        var third = await Publish(f, '3', second); _ = Validate(f, third);
        Check(!File.Exists(f.Root + "/target/" + Config)); // Preserve intentional deletion.
        var reference = ReceiptRecovery.Discover(f.Work, third.Scope, Policy());
        Check(reference.Version == 2 && reference.PolicyDigest == Policy().Digest);
        Error(() => ReceiptRecovery.Discover(f.Work, third.Scope));
        Error(() => ParentReceiptBoundary.Validate(f.Work, f.Target, reference, third.Scope, Selection, Plan, expectedMutable: Policy())); // Production rejects fixture provider.
        File.AppendAllText(f.Root + "/target/bin/server", "operator edit");
        Error(() => Validate(f, third), "receipt_file_identity_mismatch");
    }

    internal static async Task Attacks()
    {
        foreach (var kind in new[] { "unknown", "flags", "casefold", "symlink", "link-alias" })
        {
            using var f = new StorageTests.Fixture();
            if (kind == "symlink")
            { Directory.CreateDirectory(f.Root + "/target/Game/Config"); File.CreateSymbolicLink(f.Root + "/target/Game/Config/out.ini", "/etc/passwd"); }
            try
            {
                if (kind == "link-alias")
                {
                    var pub = Publisher(f, '1'); pub.Admit(); pub.StageLinks([new("alias", "Game", 0x1ff, 0, 0)]);
                }
                else await Publish(f, '1', transport: _ => new Transport(kind == "flags", kind == "unknown" ? "Game/Config/Unreviewed.ini" : Config, kind == "casefold"));
                throw new InvalidOperationException("mutable attack accepted");
            }
            catch (WorkerError) { }
            Check(!File.Exists(f.Root + "/target/bin/server"));
        }
        // An explicitly reviewed executable-flag INI remains data, pinned and text-validated.
        using (var f = new StorageTests.Fixture())
        { var receipt = await Publish(f, '1', policy: Policy(true), transport: _ => new Transport(true)); _ = Validate(f, receipt, Policy(true)); }
        using (var f = new StorageTests.Fixture())
        {
            var receipt = await Publish(f, '1');
            File.AppendAllText(f.Root + "/work/" + receipt.Scope.Server + "/" + receipt.Scope.Owner + "/" + receipt.Scope.Nonce + "/defaults/" + Config, "tamper");
            Error(() => Validate(f, receipt));
            Error(() => ParentReceiptBoundary.Validate(f.Work, f.Target, ParentReceiptBoundary.Reference(f.Work, receipt) with { Version = 1 }, receipt.Scope,
                Selection, Plan, expectedProof: AccessProofKind.OfflineFixture, expectedMutable: Policy()));
        }
        // Strict INI and exact policy digest do not allow arbitrary binaries, even with a .ini suffix.
        var bad = new MutablePolicy("offline-binary-negative", 42, 100, ["Game/Config"], [new(Config, MutablePolicy.Hash("MZ\0binary"u8.ToArray()), false)]);
        Error(() => bad.CheckText("MZ\0binary"u8.ToArray(), Config), "mutable_default_not_ini");
        var job = new ContentJobRequest(Scope('1'), 6, 7, 8, "linux", "64", "english", [], [], 10000, 4096, 10000, 20,
            MutablePolicyId: Policy().Id, MutablePolicyDigest: Policy().Digest);
        Error(() => ContentOperation.Validate(new("private_content_mutable_v1", null, null, null, "preview", null, 42, true, job), [3, 4, 5]), "mutable_policy_unregistered");
        Error(() => ContentOperation.Validate(new("private_content", null, null, null, "preview", null, 42, true, job), [3, 4, 5]), "mutable_policy_downgrade_refused");
    }

    internal static async Task Rollback()
    {
        for (var point = 1; point <= 3; point++)
        {
            using var f = new StorageTests.Fixture();
            var directory = f.Root + "/target/Game/Config"; Directory.CreateDirectory(directory);
            File.WriteAllText(directory + "/unknown.ini", "operator");
            var before = f.Target.OperatorTree("Game/Config", 100, 1048576);
            try { await Publish(f, '1', fault: n => { if (n == point) throw new WorkerError("mutable_fixture_interruption"); }); }
            catch (WorkerError error) { Check(error.Code == "mutable_fixture_interruption"); }
            Publisher(f, '1').Recover(); Publisher(f, '1').Recover();
            Check(before.SequenceEqual(f.Target.OperatorTree("Game/Config", 100, 1048576)));
            Check(!File.Exists(f.Root + "/target/bin/server") && !File.Exists(f.Root + "/target/" + Config));
        }
    }

    internal static async Task PartitionTamper()
    {
        foreach (var kind in new[] { "omit_file", "omit_default", "forged_digest", "omit_plan", "seen_duplicate", "seen_extra", "observed_hash", "observed_orphan", "extra_default_dir" })
        {
            using var f = new StorageTests.Fixture();
            var receipt = await Publish(f, '1'); var data = receipt.Mutable!;
            var original = ParentReceiptBoundary.Reference(f.Work, receipt);
            var changed = kind switch
            {
                "omit_file" => receipt with { Files = [] },
                "omit_default" => receipt with { Mutable = data with { Defaults = [] } },
                "forged_digest" => receipt with { Mutable = data with { PublisherInventoryDigest = new('a', 64) } },
                "omit_plan" => receipt with { Mutable = data with { PublisherFiles = data.PublisherFiles.Take(1).ToArray(),
                    PublisherInventoryDigest = MutablePublication.InventoryHash(data.PublisherFiles.Take(1).ToArray(), data.PublisherDirectories, data.PublisherLinks) } },
                "seen_duplicate" => receipt with { Mutable = data with { SeenPaths = [Config, Config] } },
                "seen_extra" => receipt with { Mutable = data with { SeenPaths = [Config, "Game/Config/Future.ini"] } },
                "observed_hash" => receipt with { Mutable = data with { Observed = data.Observed.Select(r => r.Directory ? r : r with { Sha256 = new('z', 64) }).ToArray() } },
                "observed_orphan" => receipt with { Mutable = data with { Observed = data.Observed.Where(r => r.Path != "Game/Config").ToArray() } },
                _ => receipt
            };
            if (kind == "extra_default_dir") Directory.CreateDirectory(f.Root + "/work/" + receipt.Scope.Server + "/" + receipt.Scope.Owner + "/" + receipt.Scope.Nonce + "/defaults/unlisted");
            var path = f.Root + "/work/" + original.Path;
            File.WriteAllBytes(path, JsonSerializer.SerializeToUtf8Bytes(changed, ParentReceiptBoundary.Json));
            var forged = original with { Sha256 = MutablePolicy.Hash(File.ReadAllBytes(path)), Files = (ulong)changed.Files.Count };
            Error(() => ParentReceiptBoundary.Validate(f.Work, f.Target, forged, receipt.Scope, Selection, Plan,
                expectedProof: AccessProofKind.OfflineFixture, expectedMutable: Policy(), expectedInventory: original.MutableInventory));
        }
    }

    internal static async Task<int> CrashChild(string root, string point)
    {
        root = Path.GetFullPath(root);
        if (!root.StartsWith(Path.Combine(Path.GetTempPath(), "voltra-content-fixture-"), StringComparison.Ordinal)
            || !File.Exists(Path.Combine(root, "mutable-child-authorized"))) return 2;
        using var f = new StorageTests.Fixture(root);
        PrivateReceipt? previous = null;
        if (point.StartsWith("update_", StringComparison.Ordinal))
        {
            point = point[7..];
            var reference = ReceiptRecovery.Discover(f.Work, Scope('0'), Policy());
            previous = ParentReceiptBoundary.Validate(f.Work, f.Target, reference, Scope('0'), Selection, Plan,
                expectedProof: AccessProofKind.OfflineFixture, expectedMutable: Policy());
        }
        if (point.StartsWith("newdir_", StringComparison.Ordinal)) point = point[7..];
        var publisher = Publisher(f, '1'); publisher.Admit();
        publisher.Mutable!.Checkpoint = name => { if (point == name) Environment.Exit(87); };
        _ = await GameContentCoordinator.Run(Plan, Selection, _ => new Transport(), publisher, 1048576, 4096, previous, default,
            n => { if (point == "mutation_" + n) Environment.Exit(87); },
            name => { if (point == name) Environment.Exit(87); });
        return 3; // Every requested child must actually stop at its checkpoint.
    }

    internal static async Task ProcessCrashes()
    {
        foreach (var point in new[] { "default_durable", "journal_before_write", "journal_after_write", "journal_after_flush", "journal_after_rename_before_sync", "journal_after_rename",
            "mutation_1", "mutation_2", "mutation_3", "before_write", "after_rename_before_sync", "after_rename", "update_before_backup", "update_after_backup", "update_mutation_2" })
        {
            using var f = new StorageTests.Fixture();
            Directory.CreateDirectory(f.Root + "/target/Game/Config");
            File.WriteAllText(f.Root + "/target/Game/Config/operator.ini", "[Mods]\nKeep=true\n");
            File.WriteAllText(f.Root + "/mutable-child-authorized", "offline fixture only");
            var updating = point.StartsWith("update_", StringComparison.Ordinal);
            if (updating) _ = await Publish(f, '0');
            var snapshot = f.Target.OperatorTree("Game/Config", 100, 1048576);
            var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add(typeof(MutablePublicationTests).Assembly.Location);
            start.ArgumentList.Add("--self-test-mutable-crash"); start.ArgumentList.Add(f.Root); start.ArgumentList.Add(point);
            using var child = Process.Start(start) ?? throw new InvalidOperationException("fixture child start");
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            await child.WaitForExitAsync(timeout.Token); Check(child.ExitCode == 87);
            if (point is "default_durable" or "journal_before_write" or "journal_after_write" or "journal_after_flush")
            {
                Error(() => Publisher(f, '1').Recover(), "publication_journal_missing");
                Check(!File.Exists(f.Root + "/target/bin/server") && snapshot.SequenceEqual(f.Target.OperatorTree("Game/Config", 100, 1048576)));
                continue;
            }
            var recoveryRequest = RecoveryRequest(f);
            if (point is "after_rename_before_sync" or "after_rename")
            {
                var reference = ReceiptRecovery.Discover(f.Work, Scope('1'), Policy());
                recoveryRequest = recoveryRequest with { Content = recoveryRequest.Content! with { ExpectedPublisherPlan = reference.PublisherPlan } };
            }
            var outcome = ContentOperation.RecoverMutableReceipt(recoveryRequest, [200, 201, 202], Policy(), AccessProofKind.OfflineFixture);
            _ = ContentOperation.RecoverMutableReceipt(recoveryRequest, [200, 201, 202], Policy(), AccessProofKind.OfflineFixture);
            var committed = point is "after_rename_before_sync" or "after_rename";
            Check(outcome.RolledBack == !committed && File.Exists(f.Root + "/target/bin/server") == (committed || updating));
            Check(snapshot.All(r => f.Target.OperatorTree("Game/Config", 100, 1048576).Contains(r)));
            if (committed)
            {
                var reference = ReceiptRecovery.Discover(f.Work, Scope('1'), Policy());
                _ = ParentReceiptBoundary.Validate(f.Work, f.Target, reference, Scope('1'), Selection, Plan,
                    expectedProof: AccessProofKind.OfflineFixture, expectedMutable: Policy());
            }
        }
    }

    private static PrivateRequest RecoveryRequest(StorageTests.Fixture f) => new("recover_private_receipt_mutable_v1", null, null, null, "preview", null, 42, true,
        new(Scope('1'), f.Target.Descriptor, f.Work.Descriptor, f.Cache.Descriptor, "linux", "64", "english", [], [], 1048576, 4096, 1048576, 30,
            MutablePolicyId: Policy().Id, MutablePolicyDigest: Policy().Digest));

    private static async Task Crash(StorageTests.Fixture f, string point)
    {
        File.WriteAllText(f.Root + "/mutable-child-authorized", "offline fixture only");
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in new[] { typeof(MutablePublicationTests).Assembly.Location, "--self-test-mutable-crash", f.Root, point }) start.ArgumentList.Add(arg);
        using var child = Process.Start(start) ?? throw new InvalidOperationException("fixture child start");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8)); await child.WaitForExitAsync(timeout.Token); Check(child.ExitCode == 87);
    }

    internal static async Task ConservativeRaces()
    {
        if (!OperatingSystem.IsLinux()) throw new WorkerError("descriptor_storage_unsupported");
        foreach (var kind in new[] { "create_before_init", "replace_after_init", "chmod_after_init", "directory_replace", "directory_chmod" })
        {
            using var f = new StorageTests.Fixture();
            var newDirectory = kind.StartsWith("directory_", StringComparison.Ordinal);
            if (!newDirectory) Directory.CreateDirectory(f.Root + "/target/Game/Config");
            await Crash(f, newDirectory ? "newdir_mutation_3" : kind == "create_before_init" ? "before_initialize" : "after_initialize");
            var path = f.Root + "/target/" + Config;
            if (newDirectory)
            {
                var directory = f.Root + "/target/Game/Config";
                if (kind == "directory_replace") { Directory.Delete(directory); Directory.CreateDirectory(directory); }
                File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute);
            }
            else
            {
                if (kind == "replace_after_init") File.Delete(path);
                if (kind != "chmod_after_init") { File.WriteAllBytes(path, Default); File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite); }
                else File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.GroupRead);
            }
            var before = f.Target.OperatorTree("Game/Config", 100, 1048576);
            Error(() => ContentOperation.RecoverMutableReceipt(RecoveryRequest(f), [200, 201, 202], Policy(), AccessProofKind.OfflineFixture));
            Check(before.SequenceEqual(f.Target.OperatorTree("Game/Config", 100, 1048576)));
        }
        // Existing foreign-owned/setgid/group-writable directories are observations, never normalized.
        using (var f = new StorageTests.Fixture())
        {
            var directory = f.Root + "/target/Game/Config"; Directory.CreateDirectory(directory);
            File.SetUnixFileMode(directory, UnixFileMode.SetGroup | UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute
                | UnixFileMode.GroupRead | UnixFileMode.GroupWrite | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
            if (Environment.GetEnvironmentVariable("VOLTRA_MUTABLE_CHOWN_FIXTURE") == "1") Check(chown(directory, 1000, 0) == 0);
            File.WriteAllText(directory + "/unknown.ini", "[Operator]\nKeep=true\n");
            var before = f.Target.OperatorTree("Game/Config", 100, 1048576);
            var receipt = await Publish(f, '1'); _ = Validate(f, receipt);
            Check(before.All(r => f.Target.OperatorTree("Game/Config", 100, 1048576).Contains(r)));
        }
        using (var f = new StorageTests.Fixture())
        {
            Directory.CreateDirectory(f.Root + "/target/Game/config");
            try { _ = await Publish(f, '1'); throw new InvalidOperationException("case alias accepted"); }
            catch (WorkerError e) { Check(e.Code == "operator_casefold_collision"); }
            Check(!Directory.Exists(f.Root + "/target/Game/Config") && !File.Exists(f.Root + "/target/bin/server"));
        }
    }

    internal static async Task StorageAndEntry()
    {
        using (var f = new StorageTests.Fixture())
        {
            // Enough for old single staging copy, not the simultaneous retained-default copy.
            f.Work.AvailableBytesOverride = () => 4096UL + (ulong)Default.Length + (ulong)"immutable publisher executable fixture"u8.Length;
            try { _ = await Publish(f, '1'); throw new InvalidOperationException("default storage reserve omitted"); }
            catch (WorkerError e) { Check(e.Code == "publication_disk_space_insufficient"); }
            Check(!File.Exists(f.Root + "/target/bin/server"));
        }
        using (var f = new StorageTests.Fixture())
        {
            var checks = 0; f.Work.AvailableBytesOverride = () => ++checks == 1 ? 1000000UL : 0UL;
            try { _ = await Publish(f, '1'); throw new InvalidOperationException("incremental reserve omitted"); }
            catch (WorkerError e) { Check(e.Code == "publication_disk_space_insufficient"); }
            Check(!File.Exists(f.Root + "/target/bin/server"));
        }
        using (var f = new StorageTests.Fixture())
        {
            var receipt = await Publish(f, '1'); var reference = ParentReceiptBoundary.Reference(f.Work, receipt);
            var job = RecoveryRequest(f).Content! with { ValidationReceipt = reference, ExpectedPublisherPlan = new(42, 100, receipt.Depots!) };
            var request = RecoveryRequest(f) with { Operation = "validate_private_receipt_mutable_v1", Content = job };
            Error(() => ContentOperation.Validate(request, [200, 201, 202], Policy()), "mutable_inventory_expectation_missing");
        }
        foreach (var operation in new[] { "private_content_mutable_v1", "validate_private_receipt_mutable_v1", "recover_private_receipt_mutable_v1" })
        {
            using var f = new StorageTests.Fixture();
            var incoming = new int[2]; var outgoing = new int[2]; var replies = new int[2];
            Check(pipe(incoming) == 0 && pipe(outgoing) == 0 && pipe(replies) == 0);
            try
            {
                using var parent = new FdMessages(outgoing[0], incoming[1]);
                var child = Program.Main(["--request-fd", incoming[0].ToString(), "--event-fd", outgoing[1].ToString(), "--reply-fd", replies[0].ToString()]);
                await parent.SendAsync(RecoveryRequest(f) with { Operation = operation }, CancellationToken.None);
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                var terminal = await parent.ReceiveAsync<JsonElement>(timeout.Token);
                Check(await child == 3 && terminal.GetProperty("code").GetString() == "mutable_policy_unregistered");
                Check(!Directory.EnumerateFileSystemEntries(f.Root + "/work").Any());
            }
            finally { foreach (var fd in incoming.Concat(outgoing).Concat(replies)) _ = close(fd); }
        }
    }
}
