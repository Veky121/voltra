// MIT. Explicit additive v2 policy. No game policy is enabled by this foundation.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SteamKit2;

namespace Voltra.SteamPrivate;

internal sealed record MutableDefaultRule(string Path, string Sha256, bool ManifestExecutable);
internal sealed record MutableReceipt(string PolicyId, string PolicyDigest, IReadOnlyList<PublicationFile> Defaults,
    IReadOnlyList<string> SeenPaths, IReadOnlyList<OperatorEntry> Observed, string PublisherInventoryDigest,
    IReadOnlyList<MutableManifestFile> PublisherFiles, IReadOnlyList<string> PublisherDirectories, IReadOnlyList<MutableManifestLink> PublisherLinks,
    string OperatorInventoryDigest);
internal sealed record MutableManifestFile(string Path, string Sha1, string Sha256, MetadataUInt64 Bytes, uint Mode,
    uint PublisherApp, uint Depot, MetadataUInt64 Manifest);
internal sealed record MutableManifestLink(string Path, string Target);
internal sealed record MutableInventoryExpectation(string Digest, MetadataUInt64 Files, MetadataUInt64 Defaults);

internal sealed class MutablePolicy
{
    internal readonly string Id, Digest;
    internal readonly uint App;
    internal readonly ulong Build;
    internal readonly IReadOnlyList<string> Roots;
    internal readonly IReadOnlyList<MutableDefaultRule> Rules;
    internal const int MaxEntries = 8192;
    internal const ulong MaxBytes = 128 * 1024 * 1024;
    internal MutablePolicy(string id, uint app, ulong build, IReadOnlyList<string> roots, IReadOnlyList<MutableDefaultRule> rules)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 128 || app == 0 || build == 0 || roots.Count is 0 or > 16 || rules.Count is 0 or > MaxEntries)
            throw new WorkerError("invalid_mutable_policy");
        Id = id; App = app; Build = build; Roots = roots; Rules = rules;
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in roots)
        {
            DepotAcquisition.PathName(root);
            if (new[] { "saves", "mods", "config", ".voltra" }.Any(p => Within(root, p) || Within(p, root))
                || !paths.Add(root) || roots.Any(other => other != root && Within(root, other)))
                throw new WorkerError("invalid_mutable_policy");
        }
        paths.Clear();
        foreach (var rule in rules)
        {
            DepotAcquisition.PathName(rule.Path);
            if (!Contains(rule.Path) || !paths.Add(rule.Path) || !rule.Path.EndsWith(".ini", StringComparison.OrdinalIgnoreCase)
                || rule.Sha256.Length != 64 || rule.Sha256.Any(c => c is not (>= '0' and <= '9' or >= 'a' and <= 'f')))
                throw new WorkerError("invalid_mutable_policy");
        }
        Digest = Hash(JsonSerializer.SerializeToUtf8Bytes(new { version = 1, id, app, build = build.ToString(),
            roots = roots.Order(StringComparer.Ordinal), rules = rules.OrderBy(r => r.Path, StringComparer.Ordinal) }, ParentReceiptBoundary.Json));
    }
    internal static bool Within(string path, string root) => path.Equals(root, StringComparison.OrdinalIgnoreCase)
        || path.StartsWith(root + "/", StringComparison.OrdinalIgnoreCase);
    internal bool Contains(string path) => Roots.Any(root => Within(path, root));
    internal bool Touches(string path) => Roots.Any(root => Within(path, root) || Within(root, path));
    internal MutableDefaultRule Rule(string path) => Rules.FirstOrDefault(r => r.Path == path)
        ?? throw new WorkerError("unreviewed_mutable_publisher_path");
    internal void CheckManifest(DepotManifest.FileData file)
    {
        if (!Contains(file.FileName)) return;
        if (file.Flags.HasFlag(EDepotFileFlag.Directory))
        {
            if (!Rules.Any(r => Within(r.Path, file.FileName))) throw new WorkerError("unreviewed_mutable_publisher_path");
            return;
        }
        var rule = Rule(file.FileName);
        if (file.Flags.HasFlag(EDepotFileFlag.Symlink) || file.Flags.HasFlag(EDepotFileFlag.Executable) != rule.ManifestExecutable)
            throw new WorkerError("mutable_manifest_flags_mismatch");
    }
    internal void CheckText(byte[] bytes, string path)
    {
        if (bytes.Length > 4 * 1024 * 1024 || Hash(bytes) != Rule(path).Sha256)
            throw new WorkerError("mutable_default_digest_mismatch");
        string text;
        try { text = TypedFields.StrictUtf8.GetString(bytes); } catch { throw new WorkerError("mutable_default_not_text"); }
        if (text.Any(c => c == '\0' || char.IsControl(c) && c is not ('\r' or '\n' or '\t'))
            || !text.Split('\n').Any(row => row.Trim().StartsWith('[') && row.Trim().EndsWith(']')))
            throw new WorkerError("mutable_default_not_ini");
    }
    internal static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    // No KF2 or fixture policy may be selected from a shipping frame yet.
    internal static MutablePolicy Resolve(string? id, string? digest, uint app) => throw new WorkerError("mutable_policy_unregistered");
}

internal sealed class MutablePublication
{
    internal readonly MutablePolicy Policy;
    private readonly PrivateDirectory target, work;
    private readonly string prefix;
    private IReadOnlyList<OperatorEntry> before = [];
    internal IReadOnlyList<PublicationFile> Defaults = [];
    internal IReadOnlyList<string> Seen = [];
    internal string InventoryDigest = "";
    internal Action<string>? Checkpoint;
    internal ulong RetainedBytes, RollbackReserve;
    private readonly Dictionary<string, MutableManifestFile> declared = new(StringComparer.Ordinal);
    private readonly HashSet<string> declaredDirectories = new(StringComparer.Ordinal);
    private readonly Dictionary<string, MutableManifestLink> declaredLinks = new(StringComparer.Ordinal);
    private IReadOnlyList<MutableManifestFile> inventory = [];
    internal MutablePublication(MutablePolicy policy, PrivateDirectory target, PrivateDirectory work, string prefix)
    { Policy = policy; this.target = target; this.work = work; this.prefix = prefix; target.MutableRoot = policy.Contains; }
    internal IReadOnlyList<OperatorEntry> Snapshot()
    {
        var rows = new List<OperatorEntry>(); ulong bytes = 0;
        foreach (var root in Policy.Roots)
        {
            var part = target.OperatorTree(root, MutablePolicy.MaxEntries - rows.Count, MutablePolicy.MaxBytes - bytes);
            foreach (var row in part) bytes = checked(bytes + row.Bytes.Value);
            rows.AddRange(part);
        }
        return rows.OrderBy(r => r.Path, StringComparer.Ordinal).ToArray();
    }
    internal void RegisterManifest(DepotRequest request, IReadOnlyList<DepotManifest.FileData> files)
    {
        foreach (var file in files)
        {
            if (file.Flags.HasFlag(EDepotFileFlag.Directory)) { declaredDirectories.Add(file.FileName); continue; }
            if (file.Flags.HasFlag(EDepotFileFlag.Symlink)) { declaredLinks.TryAdd(file.FileName, new(file.FileName, file.LinkTarget!)); continue; }
            declared.TryAdd(file.FileName, new(file.FileName, Convert.ToHexString(file.FileHash).ToLowerInvariant(), "",
                file.TotalSize, file.Flags.HasFlag(EDepotFileFlag.Executable) ? 0x1c0u : 0x180u, request.App, request.Depot, request.Manifest));
        }
    }
    internal static string InventoryHash(IReadOnlyList<MutableManifestFile> files, IReadOnlyList<string> directories, IReadOnlyList<MutableManifestLink> links)
        => MutablePolicy.Hash(JsonSerializer.SerializeToUtf8Bytes(new { files = files.OrderBy(f => f.Path, StringComparer.Ordinal),
            directories = directories.Order(StringComparer.Ordinal), links = links.OrderBy(l => l.Path, StringComparer.Ordinal) }, ParentReceiptBoundary.Json));
    internal static string OperatorHash(IReadOnlyList<OperatorEntry> rows) => MutablePolicy.Hash(JsonSerializer.SerializeToUtf8Bytes(rows, ParentReceiptBoundary.Json));
    internal IReadOnlyList<VerifiedFile> Prepare(IReadOnlyList<VerifiedFile> files, PrivateReceipt? previous, uint app, ulong build)
    {
        if (app != Policy.App || build != Policy.Build || previous is not null && (previous.Version != 2
            || previous.Mutable?.PolicyDigest != Policy.Digest || previous.Mutable.PolicyId != Policy.Id))
            throw new WorkerError("mutable_policy_migration_required");
        before = Snapshot();
        if (declared.Count != files.Count) throw new WorkerError("mutable_publisher_partition_mismatch");
        inventory = files.Select(f =>
        {
            if (!declared.TryGetValue(f.RelativePath, out var row) || row.Sha1 != f.ManifestSha1 || row.Bytes.Value != (ulong)f.Bytes || row.Mode != f.Mode)
                throw new WorkerError("mutable_publisher_partition_mismatch");
            return row with { Sha256 = f.ObservedSha256 };
        }).OrderBy(f => f.Path, StringComparer.Ordinal).ToArray();
        var oldSeen = previous?.Mutable?.SeenPaths.ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
        var defaults = new List<PublicationFile>();
        var published = files.Where(f => !Policy.Contains(f.RelativePath)).ToList();
        foreach (var file in files.Where(f => Policy.Contains(f.RelativePath)))
        {
            if (work.AvailableBytes() < checked(RetainedBytes + RollbackReserve)) throw new WorkerError("publication_disk_space_insufficient");
            var path = file.RelativePath;
            using var staged = work.ReadFile(prefix + "/stage/" + path) ?? throw new WorkerError("staging_file_missing");
            if (staged.Length > 4 * 1024 * 1024) throw new WorkerError("mutable_default_not_text");
            using var bytes = new MemoryStream(); staged.CopyTo(bytes);
            Policy.CheckText(bytes.ToArray(), path);
            if (MutablePolicy.Hash(bytes.ToArray()) != file.ObservedSha256 || Convert.ToHexString(SHA1.HashData(bytes.ToArray())).ToLowerInvariant() != file.ManifestSha1)
                throw new WorkerError("staging_hash_mismatch");
            using (var store = work.CreateFile(prefix + "/defaults/" + path)) { bytes.Position = 0; bytes.CopyTo(store); store.Flush(true); }
            work.ConfirmDurable(prefix + "/defaults/" + path);
            Checkpoint?.Invoke("default_durable");
            RetainedBytes -= checked((ulong)file.Bytes);
            defaults.Add(new(path, file.ManifestSha1, file.ObservedSha256, (ulong)file.Bytes, 0x180, work.OwnerUid, work.OwnerGid));
            if (!oldSeen.Contains(path) && !before.Any(r => r.Path.Equals(path, StringComparison.OrdinalIgnoreCase)))
                published.Add(file with { Mode = 0x180 }); // A one-time no-replace initialization, not immutable ownership.
        }
        if (defaults.Count != Policy.Rules.Count || defaults.Select(f => f.Path).ToHashSet(StringComparer.Ordinal).Count != defaults.Count)
            throw new WorkerError("mutable_default_inventory_mismatch");
        Defaults = defaults.OrderBy(r => r.Path, StringComparer.Ordinal).ToArray();
        Seen = oldSeen.Concat(defaults.Select(f => f.Path)).Distinct(StringComparer.OrdinalIgnoreCase).Order(StringComparer.Ordinal).ToArray();
        InventoryDigest = InventoryHash(inventory, declaredDirectories.ToArray(), declaredLinks.Values.ToArray());
        return published;
    }
    internal MutableReceipt Journal() => new(Policy.Id, Policy.Digest, Defaults, Seen, before, InventoryDigest, inventory,
        declaredDirectories.Order(StringComparer.Ordinal).ToArray(), declaredLinks.Values.OrderBy(l => l.Path, StringComparer.Ordinal).ToArray(), OperatorHash(before));
    internal MutableReceipt Commit(IReadOnlyList<Mutation> mutations, IReadOnlyList<DirectoryMutation> directories)
    {
        var current = Snapshot();
        foreach (var old in before)
            if (!current.Contains(old)) throw new WorkerError("operator_inventory_changed");
        foreach (var row in current.Where(r => !before.Any(old => old.Path == r.Path)))
            if (!(row.Directory && directories.Any(d => !d.Existed && d.Path == row.Path))
                && !(!row.Directory && mutations.Any(m => m.File.Path == row.Path && Policy.Contains(row.Path)
                    && row.Sha256 == m.File.Sha256 && row.Mode == m.File.Mode && row.Uid == m.File.Uid && row.Gid == m.File.Gid)))
                throw new WorkerError("operator_inventory_changed");
        return Journal() with { Observed = current, OperatorInventoryDigest = OperatorHash(current) };
    }
    internal static void Validate(PrivateReceipt receipt, PrivateDirectory target, PrivateDirectory work, string prefix, MutablePolicy policy,
        MutableInventoryExpectation? expectedInventory = null)
    {
        var data = receipt.Mutable;
        target.MutableRoot = policy.Contains;
        if (receipt.Version != 2 || receipt.App != policy.App || receipt.Build.Value != policy.Build || data is null
            || data.Defaults is null || data.SeenPaths is null || data.Observed is null || data.PublisherFiles is null
            || data.PublisherDirectories is null || data.PublisherLinks is null
            || data.PolicyId != policy.Id || data.PolicyDigest != policy.Digest || data.Defaults.Count != policy.Rules.Count
            || receipt.Files.Any(f => policy.Contains(f.Path)) || (receipt.Directories ?? []).Any(d => policy.Touches(d.Path))
            || (receipt.Links ?? []).Any(l => policy.Touches(l.Path) || policy.Touches(PublisherLinks.Resolve(l.Path, l.Target))))
            throw new WorkerError("mutable_receipt_policy_mismatch");
        static bool Hex(string? value, int length) => value is not null && value.Length == length && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');
        if (!Hex(data.PublisherInventoryDigest, 64) || InventoryHash(data.PublisherFiles, data.PublisherDirectories, data.PublisherLinks) != data.PublisherInventoryDigest
            || expectedInventory is not null && (expectedInventory.Digest != data.PublisherInventoryDigest || expectedInventory.Files.Value != (ulong)data.PublisherFiles.Count
                || expectedInventory.Defaults.Value != (ulong)data.Defaults.Count)) throw new WorkerError("mutable_publisher_partition_mismatch");
        var manifestNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in data.PublisherFiles)
        {
            DepotAcquisition.PathName(row.Path);
            if (!manifestNames.Add(row.Path) || !Hex(row.Sha1, 40) || !Hex(row.Sha256, 64) || row.Mode is not (0x180 or 0x1c0)
                || !(receipt.Depots ?? []).Any(d => d.PublisherApp == row.PublisherApp && d.Depot == row.Depot && d.Manifest == row.Manifest))
                throw new WorkerError("mutable_publisher_partition_mismatch");
            var matches = (policy.Contains(row.Path) ? data.Defaults : receipt.Files).Where(f => f.Path == row.Path
                && f.Sha1 == row.Sha1 && f.Sha256 == row.Sha256 && f.Bytes == row.Bytes).Count();
            if (matches != 1 || policy.Contains(row.Path) && row.Mode != (policy.Rule(row.Path).ManifestExecutable ? 0x1c0u : 0x180u))
                throw new WorkerError("mutable_publisher_partition_mismatch");
        }
        if (data.PublisherFiles.Count != data.Defaults.Count + receipt.Files.Count) throw new WorkerError("mutable_publisher_partition_mismatch");
        foreach (var path in data.PublisherDirectories)
        {
            DepotAcquisition.PathName(path);
            if (!manifestNames.Add(path) || data.PublisherFiles.Any(f => MutablePolicy.Within(path, f.Path)))
                throw new WorkerError("mutable_publisher_partition_mismatch");
            if (!policy.Touches(path) && !(receipt.Directories ?? []).Any(d => d.Path == path))
                throw new WorkerError("mutable_publisher_partition_mismatch");
        }
        foreach (var link in data.PublisherLinks)
            if (!manifestNames.Add(link.Path) || !(receipt.Links ?? []).Any(l => l.Path == link.Path && l.Target == link.Target))
                throw new WorkerError("mutable_publisher_partition_mismatch");
        if (data.PublisherLinks.Count != (receipt.Links?.Count ?? 0)) throw new WorkerError("mutable_publisher_partition_mismatch");
        PublisherLinks.Validate((receipt.Links ?? []), data.PublisherFiles.Select(f => f.Path), data.PublisherDirectories, receipt.Platform);
        var expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in data.Defaults)
        {
            _ = policy.Rule(row.Path);
            if (!expected.Add(prefix + "/defaults/" + row.Path) || row.Mode != 0x180 || row.Uid != work.OwnerUid || row.Gid != work.OwnerGid)
                throw new WorkerError("mutable_default_inventory_mismatch");
            using var source = work.ReadFile(prefix + "/defaults/" + row.Path) ?? throw new WorkerError("mutable_default_missing");
            if (source.Length > 4 * 1024 * 1024 || PrivateDirectory.Identity(source) != (row.Bytes.Value, row.Mode, row.Uid, row.Gid))
                throw new WorkerError("mutable_default_identity_mismatch");
            using var bytes = new MemoryStream(); source.CopyTo(bytes); var content = bytes.ToArray();
            policy.CheckText(content, row.Path);
            if (MutablePolicy.Hash(content) != row.Sha256 || Convert.ToHexString(SHA1.HashData(content)).ToLowerInvariant() != row.Sha1)
                throw new WorkerError("mutable_default_digest_mismatch");
        }
        var actual = work.OperatorTree(prefix + "/defaults", MutablePolicy.MaxEntries, MutablePolicy.MaxBytes);
        if (actual.Any(r => r.Directory ? !expected.Any(p => p.StartsWith(r.Path + "/", StringComparison.Ordinal)) : !expected.Contains(r.Path)))
            throw new WorkerError("mutable_default_inventory_mismatch");
        foreach (var row in data.Observed)
        {
            DepotAcquisition.PathName(row.Path);
            if (row.Mode > 0xfff || row.Device.Value != target.Device || row.Inode.Value == 0
                || (row.Directory ? row.Sha256 is not null || row.Bytes.Value != 0 : !Hex(row.Sha256, 64)))
                throw new WorkerError("mutable_receipt_inventory_mismatch");
            var parent = row.Path.Contains('/') ? row.Path[..row.Path.LastIndexOf('/')] : "";
            if (!policy.Roots.Contains(row.Path, StringComparer.Ordinal) && !data.Observed.Any(r => r.Path == parent && r.Directory))
                throw new WorkerError("mutable_receipt_inventory_mismatch");
        }
        foreach (var path in data.SeenPaths) DepotAcquisition.PathName(path);
        if (!Hex(data.OperatorInventoryDigest, 64) || OperatorHash(data.Observed) != data.OperatorInventoryDigest
            || !data.Observed.SequenceEqual(data.Observed.OrderBy(r => r.Path, StringComparer.Ordinal)))
            throw new WorkerError("mutable_receipt_inventory_mismatch");
        foreach (var root in policy.Roots) _ = target.OperatorTree(root, MutablePolicy.MaxEntries, MutablePolicy.MaxBytes);
        // Observed is historical preservation evidence. Legitimate later operator edits are not publisher tampering.
        if (data.Observed.Count > MutablePolicy.MaxEntries || data.Observed.Any(r => !policy.Contains(r.Path))
            || data.Observed.Select(r => r.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != data.Observed.Count
            || data.Observed.Aggregate(0UL, (sum, r) => checked(sum + r.Bytes.Value)) > MutablePolicy.MaxBytes
            || data.SeenPaths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != data.SeenPaths.Count
            || !data.SeenPaths.SequenceEqual(data.SeenPaths.Order(StringComparer.Ordinal))
            || data.SeenPaths.Any(p => !policy.Rules.Any(r => r.Path == p)) || data.Defaults.Any(f => !data.SeenPaths.Contains(f.Path, StringComparer.Ordinal)))
            throw new WorkerError("mutable_receipt_inventory_mismatch");
    }
}
