// MIT. Original durable publication coordinator, separate from transport/admission.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Voltra.SteamPrivate;

internal sealed record PublicationScope(string Server, string Owner, string Job, string Nonce, string RequestDigest);
internal sealed record PublicationFile(string Path, string Sha1, string Sha256, MetadataUInt64 Bytes, uint Mode, uint Uid = 0, uint Gid = 0);
internal sealed record ReceiptDepot(uint PublisherApp, uint Depot, MetadataUInt64 Manifest);
internal sealed record PublicationDirectory(string Path, uint Mode, uint Uid, uint Gid);
internal sealed record PrivateReceipt(int Version, string Provider, PublicationScope Scope, uint App, MetadataUInt64 Build,
    uint Depot, MetadataUInt64 Manifest, string Branch, string Platform, string Architecture, string Language,
    IReadOnlyList<PublicationFile> Files, bool EntitlementVerified, bool PublicationCommitted, bool NativeAcceptanceVerified,
    IReadOnlyList<ReceiptDepot>? Depots = null, IReadOnlyList<PublicationDirectory>? Directories = null, IReadOnlyList<PublicationLink>? Links = null,
    string AccessProof = "private_account", bool AccountEntitlementVerified = false, bool AnonymousAccessVerified = false,
    MutableReceipt? Mutable = null);
internal sealed record Mutation(PublicationFile File, string? OldHash, PublicationFile? Prior = null, StorageEntryIdentity? Created = null);
internal sealed record DirectoryMutation(string Path, bool Existed, bool Owned, string? Stage = null, StorageEntryIdentity? Created = null);
internal sealed record LinkMutation(PublicationLink Link, PublicationLink? Prior);
internal sealed record PublicationJournal(PublicationScope Scope, string Prefix, IReadOnlyList<Mutation> Mutations, IReadOnlyList<DirectoryMutation> Directories,
    IReadOnlyList<LinkMutation>? Links = null, MutableReceipt? Mutable = null, int Version = 1);

internal sealed class StagedPublication
{
    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower };
    private readonly PrivateDirectory target, work;
    private readonly PublicationScope scope;
    internal readonly string Prefix;
    private bool admitted;
    private readonly HashSet<string> protectedRoots;
    private readonly AccessProofKind proof;
    internal readonly MutablePublication? Mutable;

    internal StagedPublication(PrivateDirectory target, PrivateDirectory work, PublicationScope scope, IEnumerable<string> protectedRoots,
        AccessProofKind proof = AccessProofKind.PrivateAccount, MutablePolicy? mutablePolicy = null)
    {
        this.target = target; this.work = work; this.scope = scope;
        this.proof = proof;
        if (target.Device != work.Device) throw new WorkerError("publication_filesystem_mismatch");
        foreach (var value in new[] { scope.Server, scope.Owner, scope.Job, scope.Nonce, scope.RequestDigest })
            if (value.Length != 64 || value.Any(c => c is not (>= 'a' and <= 'f' or >= '0' and <= '9')))
                throw new WorkerError("invalid_publication_scope");
        // Scope plus nonce is the admission key. A different digest cannot reuse it.
        Prefix = scope.Server + "/" + scope.Owner + "/" + scope.Nonce;
        this.protectedRoots = protectedRoots.Select(DepotAcquisition.PathName).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (mutablePolicy is not null) Mutable = new(mutablePolicy, target, work, Prefix);
    }

    internal void Admit()
    {
        using var admission = work.CreateFile(Prefix + "/admission.json");
        JsonSerializer.Serialize(admission, scope, Json); admission.Flush(true); admitted = true;
    }

    internal Task<Stream> CreateStage(SteamKit2.DepotManifest.FileData file)
    {
        if (!admitted) throw new WorkerError("publication_not_admitted");
        CheckPath(file.FileName);
        return Task.FromResult<Stream>(work.CreateFile(Prefix + "/stage/" + file.FileName));
    }

    internal void StageLinks(IReadOnlyList<PublicationLink> links)
    {
        if (!admitted) throw new WorkerError("publication_not_admitted");
        foreach (var link in links)
        {
            if (Mutable is not null && (Mutable.Policy.Touches(link.Path) || Mutable.Policy.Touches(PublisherLinks.Resolve(link.Path, link.Target))))
                throw new WorkerError("mutable_link_unsupported");
            CheckPath(link.Path); CheckPath(PublisherLinks.Resolve(link.Path, link.Target));
            work.CreateLink(Prefix + "/stage-links/" + link.Path, link.Target);
        }
    }

    private void CheckPath(string path, bool directory = false)
    {
        DepotAcquisition.PathName(path);
        if (protectedRoots.Any(p => path.Equals(p, StringComparison.OrdinalIgnoreCase) || path.StartsWith(p + "/", StringComparison.OrdinalIgnoreCase)))
            throw new WorkerError("protected_publication_path");
        if (!directory && Mutable?.Policy.Contains(path) == true) _ = Mutable.Policy.Rule(path);
    }

    private static string? Hash(PrivateDirectory directory, string path, (uint Uid, uint Gid)? expectedOwner = null)
    {
        using var file = directory.ReadFile(path, relaxedFileMode: path.Contains("/backup/", StringComparison.Ordinal), expectedOwner: expectedOwner);
        return file is null ? null : Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant();
    }

    private static bool MatchesIdentity(PrivateDirectory directory, string path, PublicationFile expected, bool backup = false)
    {
        using var file = directory.ReadFile(path, relaxedFileMode: backup, expectedOwner: backup ? (expected.Uid, expected.Gid) : null);
        if (file is null || PrivateDirectory.Identity(file) != (expected.Bytes.Value, expected.Mode, expected.Uid, expected.Gid)) return false;
        var hash = Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant();
        return hash == expected.Sha256 && PrivateDirectory.Identity(file) == (expected.Bytes.Value, expected.Mode, expected.Uid, expected.Gid);
    }

    private static PublicationLink? LinkAt(PrivateDirectory directory, string storedPath, string logicalPath, (uint Uid, uint Gid)? expectedOwner = null)
    {
        var link = directory.ReadLink(storedPath, expectedOwner);
        return link is null ? null : link with { Path = logicalPath };
    }

    internal void PreflightStorage(IReadOnlyList<SteamKit2.DepotManifest.FileData> plan, ulong rollbackReserve)
    {
        ulong required = rollbackReserve;
        ulong defaults = 0;
        foreach (var file in plan)
        {
            CheckPath(file.FileName);
            try
            {
                required = checked(required + file.TotalSize);
                if (Mutable?.Policy.Contains(file.FileName) == true) defaults = checked(defaults + file.TotalSize);
            }
            catch (OverflowException) { throw new WorkerError("content_budget_exceeded"); }
        }
        if (Mutable is not null)
        { required = checked(required + defaults); Mutable.RetainedBytes = defaults; Mutable.RollbackReserve = rollbackReserve; }
        if (work.AvailableBytes() < required) throw new WorkerError("publication_disk_space_insufficient");
    }

    private void WriteJson<T>(string path, T value, Action<string>? checkpoint = null)
    {
        var pending = path + ".pending";
        using (var stream = work.CreateFile(pending))
        {
            checkpoint?.Invoke("before_write");
            JsonSerializer.Serialize(stream, value, Json);
            checkpoint?.Invoke("after_write");
            stream.Flush(true);
            checkpoint?.Invoke("after_flush");
        }
        checkpoint?.Invoke("before_rename");
        work.Move(pending, work, path, () => checkpoint?.Invoke("after_rename_before_sync"));
        checkpoint?.Invoke("after_rename");
    }

    private T ReadJson<T>(string path)
    {
        using var stream = work.ReadFile(path) ?? throw new WorkerError("publication_journal_missing");
        if (stream.Length > 16 * 1024 * 1024) throw new WorkerError("publication_journal_too_large");
        try { return JsonSerializer.Deserialize<T>(stream, Json) ?? throw new WorkerError("invalid_publication_journal"); }
        catch (JsonException) { throw new WorkerError("invalid_publication_journal"); }
    }

    internal PrivateReceipt Publish(DepotRequest request, ulong build, string platform, string architecture, string language,
        IReadOnlyList<VerifiedFile> verified, PrivateReceipt? previous, Action<int>? afterMutation = null, Action<string>? receiptCheckpoint = null,
        IReadOnlyList<DepotRequest>? allDepots = null, uint? requestedApp = null, IReadOnlyList<string>? directories = null,
        IReadOnlyList<PublicationLink>? links = null)
    {
        target.LockExclusive();
        try { return PublishLocked(request, build, platform, architecture, language, verified, previous, afterMutation, receiptCheckpoint, allDepots, requestedApp, directories, links); }
        finally { target.Unlock(); }
    }

    private PrivateReceipt PublishLocked(DepotRequest request, ulong build, string platform, string architecture, string language,
        IReadOnlyList<VerifiedFile> verified, PrivateReceipt? previous, Action<int>? afterMutation, Action<string>? receiptCheckpoint,
        IReadOnlyList<DepotRequest>? allDepots, uint? requestedApp, IReadOnlyList<string>? directories, IReadOnlyList<PublicationLink>? links)
    {
        if (!admitted || verified.Count == 0 && (directories?.Count ?? 0) == 0 && (links?.Count ?? 0) == 0) throw new WorkerError("publication_not_admitted");
        if (Mutable is null && previous?.Version == 2) throw new WorkerError("mutable_policy_downgrade_refused");
        if (Mutable is not null) verified = Mutable.Prepare(verified, previous, requestedApp ?? request.App, build);
        receiptCheckpoint?.Invoke("under_lock_before_preflight");
        PublisherLinks.Validate(links ?? [], verified.Select(f => f.RelativePath), directories ?? [], platform);
        if (previous is not null && (previous.Version != (Mutable is null ? 1 : 2) || !Voltra.SteamPrivate.AccessProof.Valid(previous, proof) || !previous.PublicationCommitted
            || previous.Scope.Server != scope.Server || previous.Scope.Owner != scope.Owner || previous.App != (requestedApp ?? request.App)))
            throw new WorkerError("prior_receipt_scope_mismatch");
        var old = previous?.Files.ToDictionary(f => f.Path, StringComparer.OrdinalIgnoreCase)
            ?? new Dictionary<string, PublicationFile>(StringComparer.OrdinalIgnoreCase);
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var mutations = new List<Mutation>();
        foreach (var file in verified)
        {
            CheckPath(file.RelativePath);
            if (!names.Add(file.RelativePath) || file.Bytes < 0) throw new WorkerError("invalid_publication_plan");
            var observed = Hash(target, file.RelativePath);
            if (observed is not null && (!old.TryGetValue(file.RelativePath, out var owned) || owned.Sha256 != observed))
                throw new WorkerError("operator_file_conflict");
            if (old.TryGetValue(file.RelativePath, out var expected) && !MatchesIdentity(target, file.RelativePath, expected))
                throw new WorkerError("operator_file_identity_conflict");
            if (Hash(work, Prefix + "/stage/" + file.RelativePath) != file.ObservedSha256) throw new WorkerError("staging_hash_mismatch");
            // New content starts private. A caller may preserve an existing
            // receipt's reviewed mode, but must not infer it from arbitrary files.
            var mode = old.TryGetValue(file.RelativePath, out var prior) ? prior.Mode : file.Mode;
            if (mode is not (0x180 or 0x1c0 or 0x1a4 or 0x1ed)) throw new WorkerError("invalid_publication_mode");
            var created = Mutable?.Policy.Contains(file.RelativePath) == true
                ? work.EntryIdentity(Prefix + "/stage/" + file.RelativePath, false)! with { Mode = mode, Uid = target.OwnerUid, Gid = target.OwnerGid } : null;
            mutations.Add(new(new(file.RelativePath, file.ManifestSha1, file.ObservedSha256, (ulong)file.Bytes, mode, target.OwnerUid, target.OwnerGid), observed, expected, created));
        }
        var directoryNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in (directories ?? []).Concat(verified.Select(f => f.RelativePath)).Concat((links ?? []).Select(l => l.Path)))
        {
            CheckPath(path, directories?.Contains(path, StringComparer.Ordinal) == true);
            var parts = path.Split('/');
            var count = directories?.Contains(path, StringComparer.Ordinal) == true ? parts.Length : parts.Length - 1;
            for (var i = 1; i <= count; i++) directoryNames.Add(string.Join('/', parts[..i]));
        }
        var previousDirectories = previous?.Directories?.Select(d => d.Path).ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
        foreach (var directory in previous?.Directories ?? [])
            if (!target.DirectoryExists(directory.Path) || target.DirectoryIdentity(directory.Path) != (directory.Mode, directory.Uid, directory.Gid))
                throw new WorkerError("operator_directory_identity_conflict");
        var directoryPlan = directoryNames.OrderBy(p => p.Count(c => c == '/')).ThenBy(p => p, StringComparer.Ordinal)
            .Select(p => { var exists = target.DirectoryExists(p); return new DirectoryMutation(p, exists, !exists || previousDirectories.Contains(p)); }).ToArray();
        if (Mutable is not null)
            for (var index = 0; index < directoryPlan.Length; index++)
                if (!directoryPlan[index].Existed)
                {
                    var stage = Prefix + "/directory-stage/" + index;
                    directoryPlan[index] = directoryPlan[index] with { Stage = stage, Created = target.StageDirectory(work, stage) };
                }
        PublisherLinks.Validate(links ?? [], verified.Select(f => f.RelativePath), directoryPlan.Where(d => d.Owned).Select(d => d.Path), platform);
        var priorLinks = previous?.Links?.ToDictionary(l => l.Path, StringComparer.OrdinalIgnoreCase) ?? [];
        var linkPlan = new List<LinkMutation>();
        foreach (var link in links ?? [])
        {
            CheckPath(link.Path); CheckPath(PublisherLinks.Resolve(link.Path, link.Target));
            var current = target.ReadLink(link.Path);
            priorLinks.TryGetValue(link.Path, out var prior);
            if (current is not null && (prior is null || current != prior) || prior is not null && current != prior)
                throw new WorkerError("operator_link_identity_conflict");
            var staged = work.ReadLink(Prefix + "/stage-links/" + link.Path);
            var expectedLink = link with { Mode = 0x1ff, Uid = target.OwnerUid, Gid = target.OwnerGid };
            if (staged is null || staged.Target != link.Target || staged.Mode != 0x1ff || staged.Uid != work.OwnerUid || staged.Gid != work.OwnerGid)
                throw new WorkerError("staging_link_identity_mismatch");
            linkPlan.Add(new(expectedLink, prior));
        }
        var journal = new PublicationJournal(scope, Prefix, mutations, directoryPlan, linkPlan, Mutable?.Journal(), Mutable is null ? 1 : 2);
        WriteJson(Prefix + "/journal.json", journal, Mutable is null ? null : step => Mutable.Checkpoint?.Invoke("journal_" + step)); // Entire undo plan durable before any rename.
        var mutation = 0;
        try
        {
            foreach (var directory in directoryPlan.Where(d => !d.Existed))
            {
                if (Mutable is not null) target.PublishStagedDirectory(work, directory.Stage!, directory.Path, directory.Created!);
                else target.CreateDirectory(directory.Path, work, Prefix + "/directory-" + Guid.NewGuid().ToString("N"));
                afterMutation?.Invoke(++mutation);
            }
            foreach (var row in mutations)
            {
                var path = row.File.Path;
                if (row.OldHash is not null)
                {
                    Mutable?.Checkpoint?.Invoke("before_backup");
                    target.Move(path, work, Prefix + "/backup/" + path);
                    Mutable?.Checkpoint?.Invoke("after_backup");
                    afterMutation?.Invoke(++mutation);
                    if (Hash(work, Prefix + "/backup/" + path, (target.OwnerUid, target.OwnerGid)) != row.OldHash) throw new WorkerError("operator_file_conflict");
                    if (row.Prior is not null && !MatchesIdentity(work, Prefix + "/backup/" + path, row.Prior, true))
                        throw new WorkerError("operator_file_identity_conflict");
                }
                else if (Hash(target, path) is not null) throw new WorkerError("operator_file_conflict");
                if (Mutable?.Policy.Contains(path) == true) Mutable.Checkpoint?.Invoke("before_initialize");
                work.Move(Prefix + "/stage/" + path, target, path);
                afterMutation?.Invoke(++mutation);
                using (var published = target.ReadFile(path) ?? throw new WorkerError("publication_file_missing"))
                    PrivateDirectory.SetMode(published, row.File.Mode);
                if (Hash(target, path) != row.File.Sha256) throw new WorkerError("publication_hash_mismatch");
                if (Mutable?.Policy.Contains(path) == true) Mutable.Checkpoint?.Invoke("after_initialize");
            }
            foreach (var row in linkPlan)
            {
                var path = row.Link.Path;
                if (row.Prior is not null)
                {
                    target.Move(path, work, Prefix + "/backup-links/" + path);
                    afterMutation?.Invoke(++mutation);
                    if (LinkAt(work, Prefix + "/backup-links/" + path, path, (target.OwnerUid, target.OwnerGid)) != row.Prior) throw new WorkerError("operator_link_identity_conflict");
                }
                work.Move(Prefix + "/stage-links/" + path, target, path);
                afterMutation?.Invoke(++mutation);
                if (target.ReadLink(path) != row.Link) throw new WorkerError("publication_link_identity_mismatch");
            }
            var mutableReceipt = Mutable?.Commit(mutations, directoryPlan);
            var receipt = new PrivateReceipt(Mutable is null ? 1 : 2, Voltra.SteamPrivate.AccessProof.Provider(proof), scope, requestedApp ?? request.App, build, request.Depot, request.Manifest,
                request.Branch, platform, architecture, language, mutations.Where(m => Mutable?.Policy.Contains(m.File.Path) != true).Select(m => m.File).ToArray(), proof == AccessProofKind.PrivateAccount, true, false,
                (allDepots ?? [request]).Select(d => new ReceiptDepot(d.App, d.Depot, d.Manifest)).ToArray(),
                directoryPlan.Where(d => d.Owned && Mutable?.Policy.Touches(d.Path) != true).Select(d => new PublicationDirectory(d.Path, 0x1c0, target.OwnerUid, target.OwnerGid)).ToArray(),
                linkPlan.Select(l => l.Link).ToArray(), Voltra.SteamPrivate.AccessProof.Name(proof), proof == AccessProofKind.PrivateAccount, proof == AccessProofKind.AnonymousPublic, mutableReceipt);
            WriteJson(Prefix + "/receipt.json", receipt, receiptCheckpoint);
            return receipt;
        }
        catch
        {
            // A fully validated atomically published receipt is the commit point.
            // An interruption after it must not undo already committed content.
            var committed = CommittedReceipt();
            if (committed is not null) return committed;
            try { RecoverLocked(); }
            catch { throw new WorkerError("publication_rollback_failed"); }
            throw;
        }
    }

    internal void Recover()
    {
        target.LockExclusive();
        try { RecoverLocked(); }
        finally { target.Unlock(); }
    }

    private PrivateReceipt? CommittedReceipt()
    {
        using (var stream = work.ReadFile(Prefix + "/receipt.json"))
            if (stream is null) return null;
        var receipt = ReadJson<PrivateReceipt>(Prefix + "/receipt.json");
        if (receipt.Scope != scope || !Voltra.SteamPrivate.AccessProof.Valid(receipt, proof) || receipt.Version != (Mutable is null ? 1 : 2)
            || !receipt.PublicationCommitted || receipt.NativeAcceptanceVerified
            || receipt.Files.Count == 0 && (receipt.Directories?.Count ?? 0) == 0 && (receipt.Links?.Count ?? 0) == 0)
            throw new WorkerError("invalid_committed_receipt");
        foreach (var file in receipt.Files)
        {
            CheckPath(file.Path);
            if (!MatchesIdentity(target, file.Path, file)) throw new WorkerError("committed_receipt_content_mismatch");
        }
        foreach (var directory in receipt.Directories ?? [])
            if (!target.DirectoryExists(directory.Path) || target.DirectoryIdentity(directory.Path) != (directory.Mode, directory.Uid, directory.Gid))
                throw new WorkerError("committed_receipt_content_mismatch");
        foreach (var link in receipt.Links ?? [])
            if (target.ReadLink(link.Path) != link) throw new WorkerError("committed_receipt_link_mismatch");
        if (Mutable is not null)
        {
            var journal = ReadJson<PublicationJournal>(Prefix + "/journal.json");
            if (journal.Mutable is null) throw new WorkerError("mutable_inventory_expectation_missing");
            MutablePublication.Validate(receipt, target, work, Prefix, Mutable.Policy,
                new(journal.Mutable.PublisherInventoryDigest, (ulong)journal.Mutable.PublisherFiles.Count, (ulong)journal.Mutable.Defaults.Count));
        }
        try { work.ConfirmDurable(Prefix + "/receipt.json"); }
        catch { throw new WorkerError("publication_commit_uncertain"); }
        return receipt;
    }

    private void RecoverLocked()
    {
        var admission = ReadJson<PublicationScope>(Prefix + "/admission.json");
        if (admission != scope) throw new WorkerError("publication_scope_mismatch");
        if (CommittedReceipt() is not null) return;
        var journal = ReadJson<PublicationJournal>(Prefix + "/journal.json");
        if (journal.Scope != scope || journal.Prefix != Prefix) throw new WorkerError("publication_scope_mismatch");
        if (journal.Version != (Mutable is null ? 1 : 2) || (journal.Mutable is null) != (Mutable is null)
            || journal.Mutable is not null && journal.Mutable.PolicyDigest != Mutable!.Policy.Digest)
            throw new WorkerError("mutable_policy_migration_required");
        foreach (var row in (journal.Links ?? []).Reverse())
        {
            CheckPath(row.Link.Path);
            var path = row.Link.Path;
            var current = target.ReadLink(path);
            var backupPath = Prefix + "/backup-links/" + path;
            var backup = LinkAt(work, backupPath, path, (target.OwnerUid, target.OwnerGid));
            if (backup is not null)
            {
                if (backup != row.Prior) throw new WorkerError("publication_rollback_link_conflict");
                if (current is not null)
                {
                    if (current != row.Link) throw new WorkerError("publication_rollback_link_conflict");
                    target.Delete(path);
                }
                work.Move(backupPath, target, path, expectedOwner: (target.OwnerUid, target.OwnerGid));
            }
            else if (row.Prior is null)
            {
                if (current is not null)
                {
                    if (current != row.Link) throw new WorkerError("publication_rollback_link_conflict");
                    target.Delete(path);
                }
            }
            else if (current != row.Prior) throw new WorkerError("publication_rollback_link_conflict");
        }
        foreach (var row in journal.Mutations.Reverse())
        {
            CheckPath(row.File.Path);
            var path = row.File.Path;
            var current = Hash(target, path);
            var backupPath = Prefix + "/backup/" + path;
            var backup = Hash(work, backupPath, (target.OwnerUid, target.OwnerGid));
            if (backup is not null)
            {
                if (backup != row.OldHash) throw new WorkerError("publication_rollback_conflict");
                if (row.Prior is not null && !MatchesIdentity(work, backupPath, row.Prior, true)) throw new WorkerError("publication_rollback_conflict");
                if (current is not null)
                {
                    if (current != row.File.Sha256) throw new WorkerError("publication_rollback_conflict");
                    target.Delete(path);
                }
                work.Move(backupPath, target, path, expectedOwner: (target.OwnerUid, target.OwnerGid));
            }
            else if (row.OldHash is null)
            {
                if (current is not null)
                {
                    if (current != row.File.Sha256) throw new WorkerError("publication_rollback_conflict");
                    if (Mutable?.Policy.Contains(path) == true && !MatchesIdentity(target, path, row.File))
                        throw new WorkerError("publication_rollback_conflict");
                    if (Mutable?.Policy.Contains(path) == true && (row.Created is null || target.EntryIdentity(path, false) != row.Created))
                        throw new WorkerError("publication_rollback_conflict");
                    target.Delete(path);
                }
            }
            else if (current != row.OldHash) throw new WorkerError("publication_rollback_conflict");
        }
        foreach (var directory in journal.Directories.Reverse().Where(d => !d.Existed))
        {
            if (Mutable is not null)
            {
                var actual = target.EntryIdentity(directory.Path, true);
                if (actual is null) continue;
                if (directory.Created is null || actual != directory.Created) throw new WorkerError("publication_rollback_directory_conflict");
            }
            target.DeleteEmptyDirectory(directory.Path);
        }
        // Idempotent recovery can be repeated; admission is retained to prevent replay.
    }
}
